"""Mesh-Daten fürs Browser-Frontend: `python -m keycaps.webdata [--out web/data]`.

Baut alle 12 Layouts (Cache geteilt), tesselliert jede eindeutige (Geometrie, Spec)-Kombination einmal
und schreibt `index.json` + `meshes.bin`.

meshes.bin: je Teil (Cap / Legend) hintereinander, little endian, jeweils auf 4 Byte aufgefüllt:
  Positionen  uint16 x3 je Vertex, relativ zur Mesh-bbox (min -> 0, max -> 65535; Fehler <= extent/131070,
              bei 120 mm also < 0,001 mm; Cap und Legend teilen sich dieselbe bbox -> gleiche Quantisierung)
  Dreiecke    uint16 x3 je Dreieck (uint32, falls das Teil mehr als 65535 Vertices hat)
index.json: {u, meshes: [{bbox: [x0,y0,z0,x1,y1,z1], cap: {v, t, off}, legend: {...}|null}],
             layouts: {"<lang>_<form>": {bbox: [xmin, ymin, xmax, ymax] mm, keys: [{id, mesh, stem, x, y, w, h,
             shape, kind, label}]}}}
"""
import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from . import build, layouts, print3mf

OUT = os.path.join("web", "data")

_FN = {"Escape"} | {f"F{i}" for i in range(1, 13)}
_NAV = {"PrintScreen", "ScrollLock", "Pause", "Insert", "Delete", "Home", "End", "PageUp", "PageDown",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"}
_MOD = {"Tab", "CapsLock", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight",
        "AltLeft", "AltRight", "ContextMenu", "Enter", "Backspace", "Space", "Fn"}


def kind_of(kid):
    """Klasse einer Taste für spätere Muster: alpha | mod | fn | nav | num."""
    if kid.startswith("Numpad") or kid == "NumLock":
        return "num"
    if kid in _FN:
        return "fn"
    if kid in _NAV:
        return "nav"
    if kid in _MOD:
        return "mod"
    return "alpha"


def _pad4(b):
    return b + b"\0" * (-len(b) % 4)


def _part(verts, faces, lo, hi):
    """(Bytes, Beschreibung ohne off) eines quantisierten Teils."""
    q = np.rint((verts - lo) / (hi - lo) * 65535).astype("<u2")
    it = "<u2" if len(verts) <= 65535 else "<u4"
    data = _pad4(q.tobytes()) + _pad4(faces.astype(it).tobytes())
    return data, {"v": len(verts), "t": len(faces)}


def build_data(layout_keys, cache):
    """layout_keys: {name: [Key]}; cache wie build.build_parts. -> (index dict, meshes.bin Bytes)."""
    blob, meshes, ids = bytearray(), [], {}
    for keys in layout_keys.values():
        for k in keys:
            ck = (build.geom_key(k), k.spec)
            if ck in ids:
                continue
            m = print3mf.key_mesh(cache[ck])
            allv = m["cap"][0] if m["legend"] is None else np.vstack([m["cap"][0], m["legend"][0]])
            lo, hi = allv.min(axis=0), allv.max(axis=0)
            entry = {"bbox": [float(c) for c in (*lo, *hi)]}
            for name in ("cap", "legend"):
                if m[name] is None:
                    entry[name] = None
                    continue
                data, desc = _part(*m[name], lo, hi)
                desc["off"] = len(blob)
                blob += data
                entry[name] = desc
            ids[ck] = len(meshes)
            meshes.append(entry)
    out = {}
    for name, keys in layout_keys.items():
        items, box = [], [1e9, 1e9, -1e9, -1e9]
        for k in keys:
            mi = ids[(build.geom_key(k), k.spec)]
            sx, sy = k.stem_mm
            b = meshes[mi]["bbox"]
            box = [min(box[0], sx + b[0]), min(box[1], sy + b[1]), max(box[2], sx + b[3]), max(box[3], sy + b[4])]
            items.append({"id": k.id, "mesh": mi, "stem": [round(sx, 6), round(sy, 6)], "x": k.x, "y": k.y,
                          "w": k.w, "h": k.h, "shape": k.shape, "kind": kind_of(k.id),
                          "label": k.spec[0] if k.spec else ""})
        out[name] = {"bbox": [round(c, 3) for c in box], "keys": items}
    return {"u": layouts.U, "meshes": meshes, "layouts": out}, bytes(blob)


def write(outdir, index, blob):
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "meshes.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(outdir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--workers", type=int, default=os.cpu_count())
    a = ap.parse_args(argv)
    t0, cache = time.time(), {}
    layout_keys = {f"{lg}_{f}": layouts.layout(lg, f) for lg in layouts.LANGS for f in layouts.FORMS}
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for name, keys in layout_keys.items():
            build.build_parts(keys, pool, cache)
            print(f"{name}: gebaut ({time.time() - t0:.0f} s)", flush=True)
    index, blob = build_data(layout_keys, cache)
    write(a.out, index, blob)
    size = sum(os.path.getsize(os.path.join(a.out, n)) for n in os.listdir(a.out))
    print(f"{len(index['meshes'])} Meshes, {size / 1e6:.1f} MB in {a.out}, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
