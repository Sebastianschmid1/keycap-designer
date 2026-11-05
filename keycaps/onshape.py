"""Onshape-Import: je Layout ein STEP als Tab in einem neuen Dokument `keycaps`.

    python -m keycaps.onshape create
    python -m keycaps.onshape upload <lang>_<form> | --all
    python -m keycaps.onshape status

Nur additiv: Dokument anlegen, hochladen, Status lesen. Bewusst keine Lösch-,
Überschreib- oder Update-Operation (nur GET/POST). IDs stehen in der State-Datei,
bevor ein Upload startet; ein Retry legt nichts doppelt an. Zugangsdaten
(ONESHAPE / ONESHAPESECRET) kommen aus .env oder der Umgebung und werden nie ausgegeben.
"""
import argparse
import base64
import email.utils
import hashlib
import hmac
import json
import os
import re
import secrets
import shlex
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from . import layouts

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "reference/onshape-state.json"
OUT = ROOT / "out"
HOST = "https://cad.onshape.com"
DOC_NAME = "keycaps"


def load_credentials(env_path=ROOT / ".env"):
    values = {}
    if Path(env_path).exists():
        for line in Path(env_path).read_text().splitlines():
            m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
            if m:
                parts = shlex.split(m[2], comments=True)
                values[m[1]] = parts[0] if parts else ""
    key = values.get("ONESHAPE") or os.environ.get("ONESHAPE")
    secret = values.get("ONESHAPESECRET") or os.environ.get("ONESHAPESECRET")
    if not key or not secret:
        raise SystemExit("ONESHAPE / ONESHAPESECRET fehlen in .env")
    return key, secret


def canonical_string(method, nonce, date, content_type, path, query):
    return "\n".join([method, nonce, date, content_type, path, query, ""]).lower()


def sign(secret, method, nonce, date, content_type, path, query):
    canon = canonical_string(method, nonce, date, content_type, path, query)
    return base64.b64encode(hmac.new(secret.encode(), canon.encode(), hashlib.sha256).digest()).decode()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_request(method, path, body=None, content_type="application/json"):
    """Echter, signierter Aufruf. Nur /api/-Pfade, nur GET/POST, keine Redirects."""
    if not path.startswith("/api/") or "#" in path:
        raise ValueError("Nur Onshape-API-Pfade erlaubt")
    if method not in {"GET", "POST"}:
        raise ValueError("Nur Lesen und additives Anlegen (GET/POST) erlaubt")
    key, secret = load_credentials()
    url = urllib.parse.urlsplit(HOST + path)
    date, nonce = email.utils.formatdate(usegmt=True), secrets.token_hex(16)
    sig = sign(secret, method, nonce, date, content_type, url.path, url.query)
    req = urllib.request.Request(url.geturl(), data=body, method=method, headers={
        "Date": date, "On-Nonce": nonce, "Content-Type": content_type,
        "Accept": "application/json", "Authorization": f"On {key}:HmacSHA256:{sig}"})
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=300) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Onshape lieferte HTTP {e.code} für {url.path}") from None


def multipart(fields, filename, data, boundary=None):
    """(body, content_type) für einen Multipart-Upload mit Feldern und einer Datei."""
    boundary = boundary or "KeycapBoundary" + uuid.uuid4().hex
    chunks = [f'--{boundary}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode()
              for n, v in fields]
    chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                  f"Content-Type: application/octet-stream\r\n\r\n".encode())
    chunks += [data, f"\r\n--{boundary}--\r\n".encode()]
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def load_state(path):
    return json.loads(Path(path).read_text()) if Path(path).exists() else {}


def save_state(path, state):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(state, indent=2, ensure_ascii=False))


def create(http=http_request, state_path=STATE):
    state = load_state(state_path)
    if state.get("document_id"):
        print("Dokument existiert bereits im State; nichts angelegt")
        return state
    # Free-Account: Onshape erlaubt nur öffentliche Dokumente (privat -> HTTP 409).
    res = json.loads(http("POST", "/api/documents",
                          json.dumps({"name": DOC_NAME, "isPublic": True}).encode()))
    state = {"document_id": res["id"], "workspace_id": res["defaultWorkspace"]["id"],
             "name": res["name"], "layouts": {}}
    save_state(state_path, state)
    print(f"Dokument '{state['name']}' angelegt; IDs gespeichert")
    return state


def upload(names, http=http_request, state_path=STATE, out_dir=OUT):
    state = load_state(state_path)
    if not state.get("document_id"):
        raise SystemExit("Erst `create` ausführen")
    state.setdefault("layouts", {})
    path = f"/api/translations/d/{state['document_id']}/w/{state['workspace_id']}"
    for name in names:
        if name in state["layouts"]:
            print(f"{name}: übersprungen (schon im State)")
            continue
        step = Path(out_dir) / f"{name}.step"
        if not step.exists():
            raise SystemExit(f"{step} fehlt")
        body, ctype = multipart([("formatName", ""), ("flattenAssemblies", "true"), ("translate", "true")],
                                step.name, step.read_bytes())
        res = json.loads(http("POST", path, body, ctype))
        state["layouts"][name] = {"translation_id": res["id"], "state": res.get("requestState")}
        save_state(state_path, state)
        print(f"{name}: Import gestartet ({res.get('requestState')})")
    return state


def status(http=http_request, state_path=STATE):
    state = load_state(state_path)
    if not state.get("document_id"):
        raise SystemExit("Kein Dokument im State")
    elements = None
    for name, entry in state.get("layouts", {}).items():
        if entry.get("element_id"):
            continue
        res = json.loads(http("GET", "/api/translations/" + entry["translation_id"]))
        entry["state"] = res.get("requestState")
        ids = res.get("resultElementIds") or []
        if entry["state"] == "DONE" and ids:
            if elements is None:
                elements = json.loads(http(
                    "GET", f"/api/documents/d/{state['document_id']}/w/{state['workspace_id']}/elements"))
            entry["element_id"] = ids[0]
            entry["element_name"] = next((e["name"] for e in elements if e["id"] == ids[0]), None)
        save_state(state_path, state)
        print(f"{name}: {entry['state']} {entry.get('element_name') or ''}")
    return state


def main(argv=None, http=http_request, state_path=STATE, out_dir=OUT):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("create")
    up = sub.add_parser("upload")
    up.add_argument("layout", nargs="?", help="<lang>_<form>")
    up.add_argument("--all", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "create":
        create(http, state_path)
    elif a.cmd == "status":
        status(http, state_path)
    else:
        valid = [f"{lg}_{f}" for lg in layouts.LANGS for f in layouts.FORMS]
        names = valid if a.all else [a.layout]
        if not a.all and a.layout not in valid:
            ap.error("Layout als <lang>_<form> oder --all angeben")
        upload(names, http, state_path, out_dir)


if __name__ == "__main__":
    main()
