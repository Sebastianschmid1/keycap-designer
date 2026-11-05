"""Cap-Geometrie: Körper (Loft + Mulde + Hohlraum + Stems) und Legend-Slab.

Lokales Koordinatensystem: Ursprung = Stem-Mitte, z = 0 = Unterkante der Cap,
x nach rechts, y nach hinten (CAD-Konvention; im Layout läuft y nach unten).
Alle Maße in mm; Referenz: reference/ref_cap_1u.step (1u).
"""
import math
from functools import lru_cache

import cadquery as cq

U = 19.05
GAP_X = 1.68          # Fuge zwischen Caps in x
GAP_Y = 1.51          # Fuge in y
Y_OFF = -0.127        # Referenz-Cap sitzt 0,127 mm vor der Stem-Mitte

# Wandneigung (mm Einzug je mm Höhe): seitlich 16°, hinten 18°, vorne ≈ 5,3°
SLOPE = {"x": math.tan(math.radians(16)), "back": math.tan(math.radians(18)), "front": 0.092}
Z_BODY = 11.0         # Loft-Höhe vor dem Mulden-Schnitt

# Oberseite der 1u-Referenz: Mulden-Mittellinie z = Z0 + TILT*y bei x = 0
Z0, TILT = 7.356, 0.15
DISH_SAG, DISH_A = 0.939, 6.0     # Pfeilhöhe bei ±6 mm (1u)
HALF_1U = (U - GAP_X) / 2         # 8.685

# Innenraum: Wandstärke je Seite (bezogen auf die 1u-Referenz), 15° Entformung
WALL = {"x": 1.484, "front": 1.698, "back": 1.444}
CEIL = 4.9
DRAFT = math.tan(math.radians(15))
STEM_R, CROSS_L, CROSS_W = 2.75, 4.0, 1.5
STAB = {2.0: 11.938, 2.25: 11.938, 2.5: 11.938, 2.75: 11.938, 6.0: 38.1, 6.25: 50.0, 7.0: 57.15}
LEGEND_DEPTH = 0.6


def _warn(msg):
    import sys
    print(f"WARN: {msg}", file=sys.stderr)


# ---------------------------------------------------------------- Polygone
def outline(shape, w, h):
    """CCW-Umriss der Cap-Unterkante (rechtwinklig), relativ zur Stem-Mitte."""
    if shape == "iso":      # ISO-Enter: 1,25u x 2u unten rechts + 1,5u-Kopf (rechtsbündig)
        xlo, xr, xlu = -0.625 * U + GAP_X / 2, 0.625 * U - GAP_X / 2, -0.875 * U + GAP_X / 2
        yb, yt, ym = -U + GAP_Y / 2 + Y_OFF, U - GAP_Y / 2 + Y_OFF, GAP_Y / 2 + Y_OFF
        return [(xlo, yb), (xr, yb), (xr, yt), (xlu, yt), (xlu, ym), (xlo, ym)]
    hx, hy = (w * U - GAP_X) / 2, (h * U - GAP_Y) / 2
    return [(-hx, -hy + Y_OFF), (hx, -hy + Y_OFF), (hx, hy + Y_OFF), (-hx, hy + Y_OFF)]


def offset_poly(pts, dist):
    """Rechtwinkliges CCW-Polygon kantenweise nach innen versetzen.
    dist: Funktion Richtung ('x'|'front'|'back') -> Abstand."""
    n = len(pts)

    def edge(i):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        if dx == 0:      # vertikal: Normale (dy,-dx)/|.|
            return "x", (1 if dy > 0 else -1, 0)
        return ("front" if dx > 0 else "back"), (0, -1 if dx > 0 else 1)

    out = []
    for i in range(n):
        px = pts[i]
        e_prev, e_next = edge((i - 1) % n), edge(i)
        sx = sy = None
        for kind, normal in (e_prev, e_next):
            d = dist(kind)
            if normal[0]:
                sx = -normal[0] * d
            else:
                sy = -normal[1] * d
        out.append((px[0] + sx, px[1] + sy))
    return out


def _solid_between(p0, z0, p1, z1):
    """Konvexes/konkaves Prisma aus ebenen Seitenflächen zwischen zwei Polygonen."""
    n = len(p0)
    v0 = [cq.Vector(x, y, z0) for x, y in p0]
    v1 = [cq.Vector(x, y, z1) for x, y in p1]
    faces = [cq.Face.makeFromWires(cq.Wire.makePolygon(v0, close=True)),
             cq.Face.makeFromWires(cq.Wire.makePolygon(v1, close=True))]
    for i in range(n):
        j = (i + 1) % n
        faces.append(cq.Face.makeFromWires(cq.Wire.makePolygon([v0[i], v0[j], v1[j], v1[i]], close=True)))
    return cq.Solid.makeSolid(cq.Shell.makeShell(faces)).fix()


def _try_fillet(solid, radius, edges, what):
    try:
        res = solid.fillet(radius, edges)
        if res.isValid() and res.Volume() > 0:
            return res
        _warn(f"Fillet {what} r={radius}: ungültiges Ergebnis, übersprungen")
    except Exception as e:  # OCC wirft StdFail_NotDone o. ä.
        _warn(f"Fillet {what} r={radius} übersprungen ({type(e).__name__})")
    return solid


# ---------------------------------------------------------------- Mulde
def _edge_heights():
    """Höhe der Vorder-/Hinterkante der 1u-Referenz (x = 0), Mulden-Linie der Referenz."""
    yf = (-(U - GAP_Y) / 2 + Y_OFF)
    yb = ((U - GAP_Y) / 2 + Y_OFF)
    zf = Z0
    zb = Z0
    for _ in range(30):
        zf = Z0 + TILT * (yf + SLOPE["front"] * zf)
        zb = Z0 + TILT * (yb - SLOPE["back"] * zb)
    return zf, zb


Z_FRONT, Z_BACK = _edge_heights()


def _dish_cutter(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    a = max(abs(min(xs)), abs(max(xs))) - (HALF_1U - DISH_A)   # Mulden-Kante (Abstand von der Stem-Achse)
    radius = (a * a + DISH_SAG ** 2) / (2 * DISH_SAG)
    y_ft = min(ys) + SLOPE["front"] * Z_FRONT
    y_bt = max(ys) - SLOPE["back"] * Z_BACK
    tilt = (Z_BACK - Z_FRONT) / (y_bt - y_ft)
    th = math.atan(tilt)
    d = cq.Vector(0, math.cos(th), math.sin(th))
    nup = cq.Vector(0, -math.sin(th), math.cos(th))
    low = cq.Vector(0, y_ft, Z_FRONT)                  # tiefste Linie bei x = 0
    axis_pt = low + nup * radius
    length = (max(ys) - min(ys)) / math.cos(th) + 40
    return cq.Solid.makeCylinder(radius, length, axis_pt - d * (length / 2), d)


# ---------------------------------------------------------------- Stems
def stem_positions(shape, w, h):
    """Stem-Mittelpunkte relativ zur Cap (Haupt-Stem zuerst)."""
    pos = [(0.0, 0.0)]
    if shape == "iso" or h >= 2:
        o = STAB[2.0]
        pos += [(0.0, o), (0.0, -o)]
    elif w >= 2:
        o = STAB[min(STAB, key=lambda k: abs(k - w))]
        pos += [(o, 0.0), (-o, 0.0)]
    return pos


def _add_stems(cap, positions):
    cyl = None
    for x, y in positions:
        c = cq.Solid.makeCylinder(STEM_R, CEIL + 0.5, cq.Vector(x, y, 0))
        cyl = c if cyl is None else cyl.fuse(c)
    cap = cap.fuse(cyl).clean()
    circles = [e for e in cap.Edges() if e.geomType() == "CIRCLE" and abs(e.radius() - STEM_R) < 1e-3
               and abs(e.Center().z - CEIL) < 1e-3]
    # Nur der Haupt-Stem bekommt den r1-Übergang; Stab-Stems liegen zu nah an der
    # Deckenrundung des Hohlraums (OCC-Fillet scheitert dort), sie bleiben scharfkantig.
    main = [c for c in circles if abs(c.Center().x - positions[0][0]) < 1e-3 and abs(c.Center().y - positions[0][1]) < 1e-3]
    if main:
        cap = _try_fillet(cap, 1.0, main, "Stem")
    for x, y in positions:
        for sx, sy in ((CROSS_L, CROSS_W), (CROSS_W, CROSS_L)):
            # Loch endet bündig an der Decke (z = CEIL)
            box = cq.Solid.makeBox(sx, sy, CEIL + 1.0, cq.Vector(x - sx / 2, y - sy / 2, -1.0))
            cap = cap.cut(box)
    return cap


# ---------------------------------------------------------------- Cap
@lru_cache(maxsize=None)
def build_cap(shape="rect", w=1.0, h=1.0):
    """Liefert (outer, cap, top_bbox):
    outer = Außenkörper ohne Hohlraum (Basis für den Legend-Slab),
    cap   = fertige Cap mit Hohlraum und Stems,
    top_bbox = (xmin, xmax, ymin, ymax) der Oberseite (Legend-Zone)."""
    base = outline(shape, w, h)
    top = offset_poly(base, lambda k: SLOPE[k] * Z_BODY)
    outer = _solid_between(base, 0.0, top, Z_BODY)
    sloped = [e for e in outer.Edges() if abs(e.startPoint().z - e.endPoint().z) > 1e-6]
    outer = _try_fillet(outer, 2.0, sloped, f"Ecken {shape}{w}x{h}")

    outer = outer.cut(_dish_cutter(base)).clean()
    tf = [f for f in outer.Faces() if f.normalAt().z > 0.5]
    if len(tf) != 1:
        raise RuntimeError(f"Mulden-Fläche nicht eindeutig ({len(tf)})")
    tb = tf[0].BoundingBox()
    top_bbox = (tb.xmin, tb.xmax, tb.ymin, tb.ymax)
    outer = _try_fillet(outer, 0.4, tf[0].Edges(), f"Oberkante {shape}{w}x{h}")

    # Hohlraum: Boden-Polygon um die Wandstärke eingezogen, 15° Entformung bis zur Decke
    cav0 = offset_poly(base, lambda k: WALL[k] - DRAFT * 0.5)
    cav1 = offset_poly(base, lambda k: WALL[k] + DRAFT * CEIL)
    cavity = _solid_between(cav0, -0.5, cav1, CEIL)
    ceil_edges = [e for e in cavity.Edges() if abs(e.startPoint().z - CEIL) < 1e-6 and abs(e.endPoint().z - CEIL) < 1e-6]
    cavity = _try_fillet(cavity, 1.0, ceil_edges, f"Decke {shape}{w}x{h}")
    cap = outer.cut(cavity).clean()
    cap = _add_stems(cap, stem_positions(shape, w, h))
    return outer, cap, top_bbox


@lru_cache(maxsize=None)
def build_slab(shape="rect", w=1.0, h=1.0):
    """Oberste 0,6 mm der Cap (folgt Mulde/Neigung) – wird mit dem Text-Prisma geschnitten."""
    outer = build_cap(shape, w, h)[0]
    return outer.cut(outer.translate(cq.Vector(0, 0, -LEGEND_DEPTH)))


def split_legend(shape, w, h, prism):
    """(cap_body, legend) für ein Text-Prisma (Compound) – Legend bündig zur Oberfläche."""
    cap = build_cap(shape, w, h)[1]
    legend = build_slab(shape, w, h).intersect(prism)
    return cap.cut(legend), legend
