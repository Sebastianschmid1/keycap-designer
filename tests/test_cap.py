import cadquery as cq
import pytest

from keycaps import cap, build, layouts, legend

REF = "reference/ref_cap_1u.step"


def test_1u_vs_reference():
    ref = cq.importers.importStep(REF).val()
    rb = ref.BoundingBox()
    ref = ref.translate(cq.Vector(0, 0, -rb.zmin))
    c = cap.build_cap("rect", 1.0, 1.0)[1]
    assert c.isValid() and len(c.Solids()) == 1
    a, b = c.BoundingBox(), ref.BoundingBox()
    for n in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax"):
        assert abs(getattr(a, n) - getattr(b, n)) < 0.3, n
    assert abs(c.Volume() / ref.Volume() - 1) < 0.05
    # Stem: Ø5,5 und Kreuz 4,0 x 1,5
    assert any(f.geomType() == "CYLINDER" and abs(f.Area() - 67.4) < 1.0 for f in c.Faces())
    probe = lambda x, y: c.isInside(cq.Vector(x, y, 2.0))
    assert not probe(1.9, 0) and not probe(0, 1.9)       # Kreuz-Arme (Loch, 4,0 lang)
    assert probe(1.4, 1.4) and probe(2.4, 1.0)           # Material ausserhalb des Kreuzes, innerhalb Ø5,5
    assert not probe(2.9, 0.0)                           # ausserhalb des Stems (Hohlraum)


def test_stab_offsets():
    for gk, pts in [(("rect", 2.0, 1.0), [(11.938, 0), (-11.938, 0)]), (("rect", 6.25, 1.0), [(50.0, 0), (-50.0, 0)]),
                    (("rect", 1.0, 2.0), [(0, 11.938), (0, -11.938)]), (("iso", 1.25, 2.0), [(0, 11.938), (0, -11.938)])]:
        assert cap.stem_positions(*gk)[1:] == pts
    assert cap.stem_positions("rect", 1.5, 1.0) == [(0.0, 0.0)]
    c = cap.build_cap("rect", 2.0, 1.0)[1]
    assert not c.isInside(cq.Vector(11.938, 1.9, 2.0)) and c.isInside(cq.Vector(11.938 + 1.4, 1.4, 2.0))


@pytest.mark.parametrize("gk,spec", [
    (("rect", 1.0, 1.0), ("A", "", "")), (("rect", 1.0, 1.0), ("2", '"', "²")), (("rect", 1.0, 1.0), ("Bild↓", "", "")),
    (("rect", 1.0, 1.0), ("↵", "", "")), (("rect", 2.0, 1.0), ("Backspace", "", "")), (("rect", 1.0, 2.0), ("+", "", "")),
    (("iso", 1.25, 2.0), ("↵", "", "")), (("rect", 6.25, 1.0), None), (("rect", 1.0, 1.0), ("Q", "", "@")),
])
def test_legend_split(gk, spec):
    full = cap.build_cap(*gk)[1]
    body, leg = build.make_legend(gk, spec)
    assert body.isValid()
    if spec is None:
        assert leg is None
        return
    assert leg.isValid() and leg.Volume() > 0
    assert body.intersect(leg).Volume() < 0.01
    assert abs((body.Volume() + leg.Volume()) / full.Volume() - 1) < 0.005
    assert leg.BoundingBox().zmax <= full.BoundingBox().zmax + 0.01
    # >= 1 mm innerhalb der Oberseite
    xmin, xmax, ymin, ymax = cap.build_cap(*gk)[2]
    lb = leg.BoundingBox()
    assert lb.xmin >= xmin + 1 - 1e-6 and lb.xmax <= xmax - 1 + 1e-6 and lb.ymin >= ymin + 1 - 1e-6 and lb.ymax <= ymax - 1 + 1e-6


def test_assembly_names_and_colors():
    keys = layouts.layout("us", "60")[:3] + [k for k in layouts.layout("us", "60") if k.id == "Space"]
    cache = {(build.geom_key(k), k.spec): build.make_legend(build.geom_key(k), k.spec) for k in keys}
    asm = build.assemble("t", keys, cache)
    names = [c.name for c in asm.children]
    assert names == [n for k in keys for n in ([f"{k.id}_cap", f"{k.id}_legend"] if k.spec else [f"{k.id}_cap"])]
    cols = {c.name: c.color.toTuple() for c in asm.children}
    assert all(abs(v - 0.85) < 1e-4 for v in cols[names[0]][:3]) and all(v < 1e-4 for v in cols[names[1]][:3])
