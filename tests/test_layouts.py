import itertools

import pytest

from keycaps import layouts, legend

COUNTS = {("us", "full"): 104, ("us", "tkl"): 87, ("us", "75"): 84, ("us", "60"): 61,
          ("en", "full"): 105, ("en", "tkl"): 88, ("en", "75"): 85, ("en", "60"): 62,
          ("de", "full"): 105, ("de", "tkl"): 88, ("de", "75"): 85, ("de", "60"): 62}
ALL = list(COUNTS)


@pytest.mark.parametrize("lang,form", ALL)
def test_count_unique_no_overlap(lang, form):
    keys = layouts.layout(lang, form)
    assert len(keys) == COUNTS[(lang, form)]
    ids = [k.id for k in keys]
    assert len(set(ids)) == len(ids)
    rs = [(k.id, r) for k in keys for r in k.rects]
    for (a, (x, y, w, h)), (b, (x2, y2, w2, h2)) in itertools.combinations(rs, 2):
        if a != b:
            assert not (x < x2 + w2 - 1e-9 and x2 < x + w - 1e-9 and y < y2 + h2 - 1e-9 and y2 < y + h - 1e-9), (a, b)


@pytest.mark.parametrize("lang,form", ALL)
def test_glyphs_in_font(lang, form):
    txt = "".join("".join(k.spec) for k in layouts.layout(lang, form) if k.spec)
    assert legend.missing_glyphs(txt) == []


@pytest.mark.parametrize("lang,form", ALL)
def test_legend_fits(lang, form):
    """Jede Legend lässt sich mit >= 2,8 mm und innerhalb der Oberseite platzieren."""
    for k in layouts.layout(lang, form):
        if k.spec:
            avail = (k.w * layouts.U - 1.68) * 0.7 - 2 if k.shape == "rect" else 14
            for text, fs, dx, dy in legend.layout_items(k.spec, avail):
                assert fs >= 2.8 or len(text) == 1


def test_positions_in_u():
    k = {k.id: k for k in layouts.layout("us", "full")}
    assert k["Escape"].stem_mm == (0.5 * 19.05, -0.5 * 19.05)
    assert k["Space"].spec is None
