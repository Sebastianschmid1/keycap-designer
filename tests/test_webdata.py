import json
import os

import numpy as np
import pytest
import trimesh

from keycaps import build, layouts, print3mf, webdata


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    """Kleine Auswahl: Buchstabe, Leertaste (ohne Legend), ISO-Enter, Numpad-Plus, Esc, Pfeil + US-Enter."""
    want = {"KeyA", "Space", "Enter", "NumpadAdd", "Escape", "ArrowUp"}
    de = [k for k in layouts.layout("de", "full") if k.id in want]
    us = [k for k in layouts.layout("us", "60") if k.id == "Enter"]
    assert len(de) == 6 and len(us) == 1
    cache = {}
    for k in de + us:
        item = (build.geom_key(k), k.spec)
        if item not in cache:
            cache[item] = build.make_legend(*item)
    index, blob = webdata.build_data({"de_full": de, "us_60": us}, cache)
    out = tmp_path_factory.mktemp("web")
    webdata.write(str(out), index, blob)
    return {"de_full": de, "us_60": us}, cache, index, blob, str(out)


def decode(blob, part, bbox):
    """Python-Gegenstück zu web/lib/mesh.js::decodePart."""
    pad = lambda n: n + (-n % 4)
    v, t, off = part["v"], part["t"], part["off"]
    q = np.frombuffer(blob, "<u2", v * 3, off).reshape(-1, 3)
    it = "<u2" if v <= 65535 else "<u4"
    f = np.frombuffer(blob, it, t * 3, off + pad(v * 6)).reshape(-1, 3)
    lo, hi = np.array(bbox[:3]), np.array(bbox[3:])
    return lo + q * (hi - lo) / 65535, f


def test_counts_and_precision_match_mesh_of(data):
    layout_keys, cache, index, blob, _ = data
    seen = set()
    for name, keys in layout_keys.items():
        for k, item in zip(keys, index["layouts"][name]["keys"]):
            assert k.id == item["id"]
            entry = index["meshes"][item["mesh"]]
            ref = print3mf.key_mesh(cache[(build.geom_key(k), k.spec)])
            for part in ("cap", "legend"):
                if ref[part] is None:
                    assert entry[part] is None
                    continue
                rv, rf = ref[part]
                assert (entry[part]["v"], entry[part]["t"]) == (len(rv), len(rf))
                v, f = decode(blob, entry[part], entry["bbox"])
                # Die OCC-Tessellierung ist von vorherigen Aufrufen abhängig (Dreiecke können leicht
                # variieren), deshalb: gleiche Zahlen, gleiche Vertices, gültige und geschlossene Topologie.
                assert np.abs(v - rv).max() <= 0.002
                assert f.max() < len(v)
                assert trimesh.Trimesh(v, f, process=True).is_watertight
            seen.add(item["mesh"])
    assert len(seen) == len(index["meshes"])


def test_index_content(data):
    layout_keys, _, index, blob, out = data
    assert index["u"] == layouts.U
    de = index["layouts"]["de_full"]
    by_id = {k["id"]: k for k in de["keys"]}
    assert by_id["Space"]["kind"] == "mod" and index["meshes"][by_id["Space"]["mesh"]]["legend"] is None
    assert by_id["NumpadAdd"]["kind"] == "num" and by_id["Escape"]["kind"] == "fn"
    assert by_id["ArrowUp"]["kind"] == "nav" and by_id["KeyA"]["kind"] == "alpha"
    assert by_id["Enter"]["shape"] == "iso" and by_id["KeyA"]["label"] == "A"
    k = next(k for k in layout_keys["de_full"] if k.id == "KeyA")
    assert by_id["KeyA"]["stem"] == [round(k.stem_mm[0], 6), round(k.stem_mm[1], 6)]
    x0, y0, x1, y1 = de["bbox"]
    assert x0 < by_id["KeyA"]["stem"][0] < x1 and y0 < by_id["KeyA"]["stem"][1] < y1
    assert os.path.getsize(os.path.join(out, "meshes.bin")) == len(blob)
    assert json.load(open(os.path.join(out, "index.json"), encoding="utf-8")) == index


def test_kind_covers_all_layout_keys():
    kinds = {webdata.kind_of(k.id) for lg in layouts.LANGS for f in layouts.FORMS for k in layouts.layout(lg, f)}
    assert kinds == {"alpha", "mod", "fn", "nav", "num"}


def test_shipped_data_size_budget():
    d = os.path.join("web", "data")
    if not os.path.isdir(d):
        pytest.skip("web/data nicht erzeugt")
    assert sum(os.path.getsize(os.path.join(d, n)) for n in os.listdir(d)) <= 25e6
