"""CLI: baut Keycap-Layouts als STEP (je Taste Cap + Legend).

    python -m keycaps.build --lang de --form full [--preview]
    python -m keycaps.build --all [--preview] [--3mf]
"""
import argparse
import os
import time
from concurrent.futures import ProcessPoolExecutor

import cadquery as cq

from . import cap, layouts, legend

OUT = "out"
CAP_COLOR = cq.Color(0.85, 0.85, 0.85, 1.0)
LEGEND_COLOR = cq.Color(0.0, 0.0, 0.0, 1.0)
CHUNK = 10


def geom_key(key):
    return (key.shape, key.w, key.h)


def legend_anchor(gk):
    """(cx, cy, nutzbare Breite) der Legend-Zone einer Cap-Geometrie."""
    shape = gk[0]
    xmin, xmax, ymin, ymax = cap.build_cap(*gk)[2]
    cx = 0.0 if shape == "iso" else (xmin + xmax) / 2
    cy = (ymin + ymax) / 2
    avail = 2 * min(xmax - cx, cx - xmin) - 2 * legend.MARGIN
    return cx, cy, avail


def make_legend(gk, spec):
    """(cap_body, legend|None) für eine Geometrie + Legend-Spezifikation (Taste im Ursprung)."""
    if spec is None:
        return cap.build_cap(*gk)[1], None
    cx, cy, avail = legend_anchor(gk)
    prism = legend.build_prism(spec, (cx, cy), avail)
    body, leg = cap.split_legend(*gk, prism)
    if not (leg.isValid() and body.isValid()) or leg.Volume() <= 0:
        raise RuntimeError(f"Legend {spec} auf {gk}: ungültiges Ergebnis")
    return body, leg


def _job(args):
    gk, specs = args
    return [(gk, s, make_legend(gk, s)) for s in specs]


def build_parts(keys, pool, cache):
    """Füllt cache[(geomkey, spec)] für alle noch fehlenden Kombinationen (parallel)."""
    todo = {}
    for k in keys:
        item = (geom_key(k), k.spec)
        if item not in cache:
            todo.setdefault(item[0], set()).add(item[1])
    tasks = []
    for gk, specs in todo.items():
        specs = sorted(specs, key=lambda s: (s is not None, s or ()))
        tasks += [(gk, specs[i:i + CHUNK]) for i in range(0, len(specs), CHUNK)]
    for res in pool.map(_job, tasks):
        for gk, spec, parts in res:
            cache[(gk, spec)] = parts


def assemble(name, keys, cache):
    asm = cq.Assembly(name=name)
    for k in keys:
        body, leg = cache[(geom_key(k), k.spec)]
        x, y = k.stem_mm
        loc = cq.Location(cq.Vector(x, y, 0))
        asm.add(body, name=f"{k.id}_cap", loc=loc, color=CAP_COLOR)
        if leg is not None:
            asm.add(leg, name=f"{k.id}_legend", loc=loc, color=LEGEND_COLOR)
    return asm


def preview_svg(path, keys, cache):
    """Draufsicht: Oberseiten der Caps + Legends (leichtgewichtig, ohne Hohlraum)."""
    shapes = []
    for k in keys:
        gk = geom_key(k)
        loc = cq.Location(cq.Vector(*k.stem_mm, 0))
        top = [f for f in cap.build_cap(*gk)[0].Faces() if f.normalAt().z > 0.5]
        shapes += [f.moved(loc) for f in top]
        leg = cache[(gk, k.spec)][1]
        if leg is not None:
            shapes.append(leg.moved(loc))
    comp = cq.Compound.makeCompound(shapes)
    cq.exporters.export(comp, path, exportType="SVG",
                        opt={"projectionDir": (0, 0, 1), "showAxes": False, "showHidden": False,
                             "width": 2400, "height": 1000, "strokeWidth": 0.15})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", choices=layouts.LANGS)
    ap.add_argument("--form", choices=layouts.FORMS)
    ap.add_argument("--all", action="store_true", help="alle 12 Layouts")
    ap.add_argument("--preview", action="store_true", help="zusätzlich out/<lang>_<form>_top.svg")
    ap.add_argument("--3mf", dest="threemf", action="store_true", help="zusätzlich out/<lang>_<form>/plate_<n>.3mf")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--workers", type=int, default=os.cpu_count())
    a = ap.parse_args(argv)
    if a.all:
        todo = [(lg, f) for lg in layouts.LANGS for f in layouts.FORMS]
    elif a.lang and a.form:
        todo = [(a.lang, a.form)]
    else:
        ap.error("--lang und --form angeben oder --all")
    os.makedirs(a.out, exist_ok=True)
    cache = {}
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for lang, form in todo:
            t0 = time.time()
            keys = layouts.layout(lang, form)
            build_parts(keys, pool, cache)
            name = f"{lang}_{form}"
            assemble(name, keys, cache).export(os.path.join(a.out, f"{name}.step"), exportType="STEP")
            if a.preview:
                preview_svg(os.path.join(a.out, f"{name}_top.svg"), keys, cache)
            plates = []
            if a.threemf:
                from . import print3mf
                plates = print3mf.export_plates(os.path.join(a.out, name), keys, cache, geom_key)
            extra = f", {len(plates)} Platten" if a.threemf else ""
            print(f"{name}: {len(keys)} Tasten{extra}, {time.time() - t0:.1f} s", flush=True)


if __name__ == "__main__":
    main()
