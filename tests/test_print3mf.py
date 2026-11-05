import itertools
import xml.etree.ElementTree as ET
import zipfile

import pytest

from keycaps import build, layouts, print3mf

NS = {"m": print3mf.CORE}


@pytest.fixture(scope="module")
def plates(tmp_path_factory):
    keys = layouts.layout("us", "60")
    cache = {}
    for k in keys:
        item = (build.geom_key(k), k.spec)
        if item not in cache:
            cache[item] = build.make_legend(*item)
    out = tmp_path_factory.mktemp("p")
    return keys, print3mf.export_plates(str(out), keys, cache, build.geom_key)


def parse(path):
    with zipfile.ZipFile(path) as z:
        return ET.fromstring(z.read("3D/3dmodel.model"))


def test_pack_rules():
    sizes = [(17.4, 17.5)] * 300 + [(120, 17.5), (17.4, 37)]
    plate_of, pos = print3mf.pack(sizes)
    assert max(plate_of) >= 1
    for i, ((w, h), (x, y)) in enumerate(zip(sizes, pos)):
        assert print3mf.X_MIN <= x and x + w <= print3mf.X_MAX + 1e-9
        assert print3mf.Y_MIN <= y and y + h <= print3mf.Y_MAX + 1e-9
    for i, j in itertools.combinations(range(len(sizes)), 2):
        if plate_of[i] != plate_of[j]:
            continue
        (xi, yi), (xj, yj) = pos[i], pos[j]
        dx = max(xj - (xi + sizes[i][0]), xi - (xj + sizes[j][0]))
        dy = max(yj - (yi + sizes[i][1]), yi - (yj + sizes[j][1]))
        assert max(dx, dy) >= print3mf.GAP - 1e-9


def test_materials_components_counts(plates):
    keys, paths = plates
    n_items, blank = 0, 0
    for p in paths:
        root = parse(p)
        objs = {o.get("id"): o for o in root.findall("m:resources/m:object", NS)}
        for it in root.findall("m:build/m:item", NS):
            n_items += 1
            o = objs[it.get("objectid")]
            assert o.get("name") == it.get("partnumber")
            comps = o.findall("m:components/m:component", NS)
            assert len(comps) in (1, 2)
            blank += len(comps) == 1
    assert n_items == len(keys)
    assert blank == sum(k.spec is None for k in keys)


def test_bounds(plates):
    _, paths = plates
    for p in paths:
        root = parse(p)
        objs = {o.get("id"): o for o in root.findall("m:resources/m:object", NS)}
        for it in root.findall("m:build/m:item", NS):
            t = [float(v) for v in it.get("transform").split()]
            dx, dy = t[9], t[10]
            xs, ys = [], []
            for c in objs[it.get("objectid")].findall("m:components/m:component", NS):
                for v in objs[c.get("objectid")].findall("m:mesh/m:vertices/m:vertex", NS):
                    xs.append(float(v.get("x")) + dx)
                    ys.append(float(v.get("y")) + dy)
            assert print3mf.X_MIN - 1e-3 <= min(xs) and max(xs) <= print3mf.X_MAX + 1e-3
            assert print3mf.Y_MIN - 1e-3 <= min(ys) and max(ys) <= print3mf.Y_MAX + 1e-3


def test_bambu_part_extruders(plates):
    """Bambu Studio liest den Filament je Teil aus model_settings.config: Cap -> 1, Legend -> 2."""
    keys, paths = plates
    n_obj, legends = 0, 0
    for p in paths:
        root = parse(p)
        with zipfile.ZipFile(p) as z:
            cfg = ET.fromstring(z.read("Metadata/model_settings.config"))
        objs = {o.get("id"): o for o in root.findall("m:resources/m:object", NS)}
        for it in root.findall("m:build/m:item", NS):
            n_obj += 1
            o = objs[it.get("objectid")]
            c = next(c for c in cfg.findall("object") if c.get("id") == o.get("id"))
            assert c.find("metadata[@key='name']").get("value") == o.get("name")
            comp_ids = [x.get("objectid") for x in o.findall("m:components/m:component", NS)]
            parts = c.findall("part")
            assert [q.get("id") for q in parts] == comp_ids
            ext = [q.find("metadata[@key='extruder']").get("value") for q in parts]
            assert ext == ["1"] or ext == ["1", "2"]
            legends += len(ext) == 2
    assert n_obj == len(keys)
    assert legends == sum(k.spec is not None for k in keys)
