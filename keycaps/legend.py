"""Legend-Text: Platzierung/Skalierung und Text-Prisma (DejaVu Sans Bold).

Legend-Spezifikation (hashbar): (main, shift, altgr)
  main   – Haupt-Legend (Grundzeichen bzw. Name); bei shift != '' die untere Zeile
  shift  – obere Zeile (Dual-Legend) oder ''
  altgr  – kleine Legend unten rechts oder ''
"""
from functools import lru_cache

import cadquery as cq
from fontTools.ttLib import TTFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FS_SINGLE = 4.5       # Buchstaben/Ziffern/Symbole
FS_DUAL = 3.2         # Dual- und AltGr-Legends
FS_WORD_MAX, FS_MIN = 3.6, 2.8
MARGIN = 1.0          # Mindestabstand zur Kante der Oberseite
ROW_DY = 2.5          # Zeilenabstand von der Mitte bei Dual-Legends
Z_START, Z_LEN = 3.0, 12.0   # Prisma durchstößt die Oberseite

_CMAP = None
_UPEM = 2048
_HMTX = None


def _font():
    global _CMAP, _UPEM, _HMTX
    if _CMAP is None:
        f = TTFont(FONT)
        _CMAP, _UPEM, _HMTX = f.getBestCmap(), f["head"].unitsPerEm, f["hmtx"]
    return _CMAP


def missing_glyphs(text):
    cmap = _font()
    return sorted({c for c in text if ord(c) not in cmap})


def advance_em(text):
    """Textbreite in em (Summe der Advance-Breiten, ohne Kerning)."""
    cmap = _font()
    return sum(_HMTX[cmap[ord(c)]][0] for c in text) / _UPEM


def _is_symbol(text):
    return len(text) == 1 and ord(text) >= 0x2000     # Pfeile/Symbole: per Bounding Box zentrieren


def layout_items(spec, avail_w):
    """-> [(text, fontsize, dx, dy)] relativ zur Legend-Mitte; avail_w = nutzbare Breite."""
    main, shift, altgr = spec
    items = []
    if not shift:
        x = -1.3 if altgr else 0.0
        if len(main) == 1:
            fs = FS_SINGLE
        else:
            fs = min(FS_WORD_MAX, avail_w / advance_em(main))
            if fs < FS_MIN:
                raise ValueError(f"Legend '{main}' passt nicht (fs {fs:.2f} < {FS_MIN})")
        items.append((main, fs, x, 0.0))
    else:
        x = -1.8 if altgr else 0.0
        items.append((shift, FS_DUAL, x, ROW_DY))
        items.append((main, FS_DUAL, x, -ROW_DY))
    if altgr:
        items.append((altgr, FS_DUAL, 3.4, -ROW_DY))
    return items


@lru_cache(maxsize=None)
def _glyphs(text, fs):
    """Text als dünnes Solid um den Ursprung (font-basiert zentriert, bzw. Bounding-Box-zentriert für Symbole)."""
    s = cq.Workplane("XY").text(text, fs, Z_LEN, fontPath=FONT, kind="bold", halign="center", valign="center").val()
    if _is_symbol(text):
        bb = s.BoundingBox()
        s = s.translate(cq.Vector(-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, 0))
    return s


def build_prism(spec, center, avail_w):
    """Compound aller Zeichen als Prisma (z 3 … 15) um den Anker `center`=(cx, cy)."""
    solids = []
    for text, fs, dx, dy in layout_items(spec, avail_w):
        g = _glyphs(text, fs).translate(cq.Vector(center[0] + dx, center[1] + dy, Z_START))
        solids.extend(g.Solids())
    return cq.Compound.makeCompound(solids)
