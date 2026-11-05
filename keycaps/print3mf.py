"""Zweifarb-3MF-Druckplatten (Core 3MF, Bambu X2D) aus den Cap-/Legend-Körpern.

Je Taste ein Objekt `<keyid>` mit Komponenten (Cap, Legend). Bambu Studio ignoriert basematerials/pindex
und liest den Filament je Teil aus Metadata/model_settings.config: Cap -> extruder 1, Legend -> extruder 2.
Druckorientierung wie modelliert (Stem unten). Meshes werden je (Geometrie, Spec) geteilt.
"""
import xml.etree.ElementTree as ET
import zipfile

import numpy as np

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types"
MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"

TOL = 0.02          # lineare Tessellierungstoleranz in mm
ANG_TOL = 0.2       # rad
# Bett X2D 256 x 256 mm, 3 mm Rand; der zweite Extruder erreicht nur X >= 20,5 mm -> 23,5 mm Footprint-Rand.
X_MIN, X_MAX, Y_MIN, Y_MAX = 23.5, 253.0, 3.0, 253.0
GAP = 3.0


def mesh_of(shape):
    """(vertices Nx3, faces Mx3) mit verschweißten Eckpunkten."""
    verts, tris = shape.tessellate(TOL, ANG_TOL)
    v = np.array([(p.x, p.y, p.z) for p in verts], dtype=float)
    uniq, inv = np.unique(np.round(v, 6), axis=0, return_inverse=True)
    f = inv.reshape(-1)[np.array(tris, dtype=int)]
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    return uniq, f


def key_mesh(parts):
    """parts = (cap_body, legend|None) -> dict(cap, legend|None, bbox (xmin, ymin, xmax, ymax))."""
    cap = mesh_of(parts[0])
    leg = mesh_of(parts[1]) if parts[1] is not None else None
    allv = cap[0] if leg is None else np.vstack([cap[0], leg[0]])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    return dict(cap=cap, legend=leg, bbox=(lo[0], lo[1], hi[0], hi[1]))


def pack(sizes):
    """Shelf-Packing. sizes: Liste (w, h) -> (Liste Plattenindex, Liste (x, y) linke untere Ecke).

    Footprints liegen in [X_MIN, X_MAX] x [Y_MIN, Y_MAX], Abstand >= GAP.
    """
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    plate_of, pos = [0] * len(sizes), [None] * len(sizes)
    plate, x, y, shelf_h = 0, X_MIN, Y_MIN, 0.0
    for i in order:
        w, h = sizes[i]
        if w > X_MAX - X_MIN or h > Y_MAX - Y_MIN:
            raise ValueError(f"Taste {w:.1f} x {h:.1f} mm passt nicht auf das Bett")
        if x + w > X_MAX + 1e-9:
            x, y, shelf_h = X_MIN, y + shelf_h + GAP, 0.0
        if y + h > Y_MAX + 1e-9:
            plate, x, y, shelf_h = plate + 1, X_MIN, Y_MIN, 0.0
        plate_of[i], pos[i] = plate, (x, y)
        x += w + GAP
        shelf_h = max(shelf_h, h)
    return plate_of, pos


def _mesh_object(res, oid, name, mesh):
    obj = ET.SubElement(res, "object", id=str(oid), type="model", name=name)
    m = ET.SubElement(obj, "mesh")
    vs = ET.SubElement(m, "vertices")
    for v in mesh[0]:
        ET.SubElement(vs, "vertex", x=format(v[0], ".6f"), y=format(v[1], ".6f"), z=format(v[2], ".6f"))
    ts = ET.SubElement(m, "triangles")
    for f in mesh[1]:
        ET.SubElement(ts, "triangle", v1=str(f[0]), v2=str(f[1]), v3=str(f[2]))


def write_plate(path, items):
    """items: Liste (keyid, mesh_id, mesh dict, (px, py)); px/py = linke untere Ecke des Footprints."""
    model = ET.Element("model", {"xmlns": CORE, "unit": "millimeter"})
    res, build = ET.SubElement(model, "resources"), ET.SubElement(model, "build")
    settings = ET.Element("config")
    shared, next_id = {}, 1
    for _, mid, mesh, _ in items:
        if mid in shared:
            continue
        ids = [next_id]
        _mesh_object(res, next_id, f"mesh{mid}_cap", mesh["cap"])
        next_id += 1
        if mesh["legend"] is not None:
            ids.append(next_id)
            _mesh_object(res, next_id, f"mesh{mid}_legend", mesh["legend"])
            next_id += 1
        shared[mid] = ids
    for keyid, mid, mesh, (px, py) in items:
        obj = ET.SubElement(res, "object", id=str(next_id), type="model", name=keyid)
        comps = ET.SubElement(obj, "components")
        cfg = ET.SubElement(settings, "object", id=str(next_id))
        ET.SubElement(cfg, "metadata", key="name", value=keyid)
        for cid, ext in zip(shared[mid], (1, 2)):
            ET.SubElement(comps, "component", objectid=str(cid))
            part = ET.SubElement(cfg, "part", id=str(cid), subtype="normal_part")
            ET.SubElement(part, "metadata", key="name", value=f"{keyid}_{'cap' if ext == 1 else 'legend'}")
            ET.SubElement(part, "metadata", key="extruder", value=str(ext))
        dx, dy = px - mesh["bbox"][0], py - mesh["bbox"][1]
        ET.SubElement(build, "item", objectid=str(next_id), partnumber=keyid,
                      transform=f"1 0 0 0 1 0 0 0 1 {dx:.6f} {dy:.6f} 0")
        next_id += 1
    types = ET.Element("Types", xmlns=CONTENT)
    for ext, mime in (("rels", "application/vnd.openxmlformats-package.relationships+xml"),
                      ("model", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml")):
        ET.SubElement(types, "Default", Extension=ext, ContentType=mime)
    rels = ET.Element("Relationships", xmlns=REL)
    ET.SubElement(rels, "Relationship", Id="rel0", Type=MODEL_REL, Target="/3D/3dmodel.model")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, root in (("[Content_Types].xml", types), ("_rels/.rels", rels), ("3D/3dmodel.model", model),
                           ("Metadata/model_settings.config", settings)):
            z.writestr(name, ET.tostring(root, encoding="utf-8", xml_declaration=True))


def export_plates(outdir, keys, cache, geom_key):
    """Schreibt plate_<n>.3mf (n ab 1) nach outdir; gibt die Dateipfade zurück."""
    import os
    os.makedirs(outdir, exist_ok=True)
    meshes, ids = {}, {}
    for k in keys:
        ck = (geom_key(k), k.spec)
        if ck not in meshes:
            meshes[ck] = key_mesh(cache[ck])
            ids[ck] = len(ids)
    sizes = [(m["bbox"][2] - m["bbox"][0], m["bbox"][3] - m["bbox"][1])
             for m in (meshes[(geom_key(k), k.spec)] for k in keys)]
    plate_of, pos = pack(sizes)
    paths = []
    for n in range(max(plate_of) + 1):
        items = []
        for i, k in enumerate(keys):
            if plate_of[i] == n:
                ck = (geom_key(k), k.spec)
                items.append((k.id, ids[ck], meshes[ck], pos[i]))
        p = os.path.join(outdir, f"plate_{n + 1}.3mf")
        write_plate(p, items)
        paths.append(p)
    return paths
