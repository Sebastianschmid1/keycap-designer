import json

import pytest

from keycaps import onshape


def test_hmac_fixed():
    canon = onshape.canonical_string("POST", "AbC123", "Thu, 05 Nov 2026 10:00:00 GMT",
                                     "application/json", "/api/documents", "")
    assert canon == "post\nabc123\nthu, 05 nov 2026 10:00:00 gmt\napplication/json\n/api/documents\n\n"
    sig = onshape.sign("geheim", "POST", "AbC123", "Thu, 05 Nov 2026 10:00:00 GMT",
                       "application/json", "/api/documents", "")
    import base64, hashlib, hmac
    assert sig == base64.b64encode(hmac.new(b"geheim", canon.encode(), hashlib.sha256).digest()).decode()
    assert sig == onshape.sign("geheim", "post", "abc123", "thu, 05 nov 2026 10:00:00 gmt",
                               "application/json", "/api/documents", "")


def test_real_request_rejects_other_methods():
    with pytest.raises(ValueError):
        onshape.http_request("DELETE", "/api/documents/x")
    with pytest.raises(ValueError):
        onshape.http_request("GET", "https://evil/x")


def test_multipart():
    body, ctype = onshape.multipart([("flattenAssemblies", "true")], "a.step", b"DATA", boundary="B")
    assert ctype == "multipart/form-data; boundary=B"
    assert b'name="flattenAssemblies"\r\n\r\ntrue\r\n' in body
    assert b'name="file"; filename="a.step"' in body and b"DATA" in body
    assert body.endswith(b"--B--\r\n")


class Fake:
    def __init__(self):
        self.calls = []

    def __call__(self, method, path, body=None, ctype="application/json"):
        self.calls.append((method, path, body, ctype))
        if path == "/api/documents":
            return json.dumps({"id": "D1", "name": "keycaps", "defaultWorkspace": {"id": "W1"}}).encode()
        if path.startswith("/api/translations/d/"):
            return json.dumps({"id": "T-" + str(len(self.calls)), "requestState": "ACTIVE"}).encode()
        if path.startswith("/api/translations/"):
            return json.dumps({"requestState": "DONE", "resultElementIds": ["E1"]}).encode()
        if path.endswith("/elements"):
            return json.dumps([{"id": "E1", "name": "de_60.step"}]).encode()
        raise AssertionError(path)


def test_create_upload_status_idempotent(tmp_path):
    st, out, http = tmp_path / "s.json", tmp_path / "out", Fake()
    out.mkdir()
    (out / "de_60.step").write_bytes(b"STEPDATA")
    onshape.create(http, st)
    onshape.create(http, st)
    assert len(http.calls) == 1
    assert json.loads(http.calls[0][2]) == {"name": "keycaps", "isPublic": True}
    onshape.upload(["de_60"], http, st, out)
    onshape.upload(["de_60"], http, st, out)
    up = [c for c in http.calls if c[1].startswith("/api/translations/d/")]
    assert len(up) == 1 and up[0][1] == "/api/translations/d/D1/w/W1" and up[0][0] == "POST"
    assert b"STEPDATA" in up[0][2] and b'name="flattenAssemblies"\r\n\r\ntrue' in up[0][2]
    assert json.loads(st.read_text())["layouts"]["de_60"]["translation_id"]
    onshape.status(http, st)
    s = json.loads(st.read_text())["layouts"]["de_60"]
    assert s["element_id"] == "E1" and s["element_name"] == "de_60.step"
    n = len(http.calls)
    onshape.status(http, st)
    assert len(http.calls) == n


def test_upload_requires_create(tmp_path):
    with pytest.raises(SystemExit):
        onshape.upload(["de_60"], Fake(), tmp_path / "s.json", tmp_path)
