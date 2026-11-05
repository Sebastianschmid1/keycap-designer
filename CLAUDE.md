# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Zweck

Generator für 3D-druckbare MX-Keycaps: komplette Tastatur-Layouts für **de**, **en**, **us**
in den Formfaktoren **100 %, TKL, 75 %, 60 %** (= 12 Layouts). Jede Taste besteht aus zwei
Körpern — Cap und bündig eingelegter Legend — für Zweifarbdruck. Ergebnis lokal (STEP für
Onshape, 3MF für den Druck) und als Import in ein Onshape-Dokument (ein Tab pro Layout).
Status und offene Punkte: `Umsetzungsplan.md`.

## Befehle

Venv: `.venv/` (cadquery 2.8.0, OCP 7.9.3.1.1, trimesh, fontTools, pytest; kein Paket-Install nötig).

```bash
.venv/bin/pytest -q                                   # alle Tests (~40 s)
.venv/bin/pytest -q tests/test_cap.py -k legend       # einzelne Tests
.venv/bin/python -m keycaps.build --lang de --form full [--preview] [--3mf]
.venv/bin/python -m keycaps.build --all --preview --3mf   # alle 12 Layouts, ~3,5 min
.venv/bin/python -m keycaps.onshape create | upload <lang>_<form> | upload --all | status
```

```bash
.venv/bin/python -m keycaps.webdata                    # web/data neu erzeugen (~70 s, ~9,6 MB, wird committet)
python3 start.py                                       # Frontend lokal (nur stdlib), öffnet den Browser
node --test web/test/*.test.mjs                        # JS-Tests (Node 22: Glob, nicht das Verzeichnis)
node web/tools/export_cli.mjs us_60 zuordnung.json out.3mf   # Headless-3MF-Export (nur Slots, keine Bemalung)
node web/tools/export_cli.mjs --project projekt.json out.3mf  # dito aus einer Projektdatei ("Projekt speichern"), mit Bemalung
```

Ausgabe in `out/` (gitignored): `<lang>_<form>.step` (Cap + Legend je Taste als Assembly-Parts
`<keyid>_cap`/`<keyid>_legend`), `<lang>_<form>_top.svg` (Draufsicht), `<lang>_<form>/plate_<n>.3mf`.

## Architektur

- `keycaps/layouts.py` — reine Daten: `layout(lang, form)` → `Key(id, x, y, w, h, shape, spec)` in u
  (KLE-Geometrie, y nach unten); `spec = (main, shift, altgr)`, `None` = blank (Leertaste).
- `keycaps/cap.py` — Geometrie in mm, Ursprung = Stem-Mitte, z = 0 = Cap-Unterkante:
  Loft mit kantenweiser Wandneigung → Mulde (gekippter Zylinder, konstante Pfeilhöhe) → Hohlraum → Stems.
  `build_cap`/`build_slab` sind per `lru_cache` je `(shape, w, h)` gecacht.
- `keycaps/legend.py` — Text-Prisma (DejaVu Sans Bold) und Platzierung; `split_legend` in `cap.py`
  schneidet es mit der obersten 0,6-mm-Schicht → Legend-Körper, Cap = Cap − Legend.
- `keycaps/build.py` — baut je `(geom_key, spec)` einmal (ProcessPool, Cache über alle Layouts),
  platziert per `cq.Location(stem_mm)` → STEP; `--3mf` ruft `print3mf.py`
  (Core 3MF + `Metadata/model_settings.config` mit Part-Extruder: Cap 1 / Legend 2 — Bambu ignoriert
  `basematerials`; Shelf-Packing für X2D, X ≥ 23,5 mm).
- `keycaps/onshape.py` — HMAC-Client + additiver Import (State in `reference/onshape-state.json`).

- `keycaps/webdata.py` — tesselliert alle eindeutigen (geom, spec) der 12 Layouts → `web/data/index.json`
  (Meshes, Tasten je Layout mit Stem-Position, u-Geometrie, `kind` alpha/mod/fn/nav/num) + `meshes.bin`
  (uint16 relativ zur Mesh-bbox, Format im Modul-Docstring).
- `web/` — Frontend ohne Build-Step (reine ES-Module, Importmap): `index.html`, `app.js` (UI/three.js),
  `lib/` = Logik ohne DOM/three (`pack.js` = Port von `print3mf.pack`, `threemf.js` = Platten → ZIP,
  `mesh.js` = Dekodierung, `assign.js` = Zuordnung für die CLI), `vendor/` (three 0.187.0, fflate 0.8.3, Lizenzen),
  `tools/export_cli.mjs`, `test/`. Datenmodell: `slots` (Farben, 2–8) + je Taste `capSlot`/`legendSlot`
  (1-basiert = Bambu-Extruder); 3MF mit je Taste eigenen Mesh-Objekten.
  **Bemalung (4b):** eine Farbkarte je Layout (`lib/paintmap.js`: `Uint8Array`, 0,25 mm/px über die Layout-bbox, 0 = unbemalt
  → capSlot, 1..8 = Slot) ist das einzige Modell für Pinsel, Bilder (`quantize.js`: gewichtete RGB-Distanz, optional
  Floyd–Steinberg) und gemalte Muster (`patterns.js`, 10 Stück). Regel „Top-Fläche“: Dreiecke mit Normale z > 0,5 sind
  bemalbar, Seiten/Innenflächen immer capSlot — Vorschau (Shader-Patch in `capMaterial`, Karte als R8-Textur) und Export
  (`refine.js`) nutzen dieselbe Regel. Export: Top-Dreiecke der bemalten Tasten werden kantenbasiert konform auf ≤ 0,5 mm
  verfeinert, am Schwerpunkt abgetastet → `paint_color` am `<triangle>` (Kodierung: Slot 1 `4`, 2 `8`, s ≥ 3 `<hex(s−3)>C`;
  per Bambu-Slicetest belegt). `project.js` = Projektdatei (JSON, Karte lauflängenkodiert) + gemeinsamer Exportpfad
  für Browser und CLI. Bemalte Tasten machen die 3MF groß (de_full mit Bild ≈ 40 MB, ~15 s).
- `start.py` — stdlib-`ThreadingHTTPServer` auf 127.0.0.1 (Port 8765, sonst frei), setzt MIME-Typen explizit
  (Windows liefert `.js` sonst evtl. als `text/plain`); `sys._MEIPASS` für die spätere PyInstaller-EXE.

## Referenz-Keycap (Onshape)

Vorbild ist Sebastians Dokument „keycap“, Part Studio 1 (Part „cap“):
`https://cad.onshape.com/documents/92e2b5d3972b28678a865470/w/ddc3e205d78591528ff26cd1/e/3b063ce8a6bcc6a18f6dd32e`.
Dort im Maßstab 1:10 skizziert und am Ende per `Transform` ×10 skaliert — Skizzenmaße also ×10 lesen.
Exportierte Geometrie liegt in `reference/ref_cap_1u.step` (Ground Truth für 1u, Boden bei z = 1,1).

Gemessen am Export (relativ zum Boden):
- Grundfläche 17,37 × 17,54 mm (y vorne −8,90, hinten +8,64), Gesamthöhe 8,9 mm.
- Top: zylindrische Mulde quer (x), Mitte 7,36 mm, bei x = ±6 mm +0,94 mm höher;
  längs (y) nach vorne geneigt, Steigung ≈ 0,15 (≈ 8,5°).
- Wände asymmetrisch: seitlich ≈ 16°, hinten ≈ 18°, vorne ≈ 5°.
- Hohlraum innen 15 × 15 mm, 15° Entformung, Decke bei ≈ 4,4–4,9 mm.
- MX-Stem Ø 5,5 mm, Kreuz 4,0 × 1,5 mm (beide Arme 1,5 mm — Drucktoleranz).
- Rundungen: Kanten r 0,4 und r 2, Face-Blends r 1.

## Onshape-API

- Zugang über `ONESHAPE` (Access Key) und `ONESHAPESECRET` in `.env` (übernommen aus
  `~/panzer/.env`, gitignored). HMAC-Signatur wie in `~/panzer/v10_2/onshape_read.py`.
- Free-Account: nur **öffentliche** Dokumente möglich (`isPublic: false` → HTTP 409).
- Nur lesen und additiv anlegen — keine Tabs/Dokumente löschen oder überschreiben; neue Stände
  als neuen Tab importieren. IDs werden in einer State-Datei gehalten, damit ein Retry nichts doppelt anlegt.
- Die Codex-Sandbox blockt Netzwerk: Onshape-Aufrufe und `pip install` laufen außerhalb der Sandbox.

## Slicer-Prüfung (Bambu X2D)

Bambu Studio 2.8.2 headless: `~/.local/opt/bambustudio-2.8.2/squashfs-root/AppRun` mit den X2D-Profilen
aus `~/panzer/v10_2/cad/plate-evidence/bambu_project/profiles/` (`machine.json;process.json`,
Filamente `filament.json;accent.json`), eigenes `--datadir` und XDG-Verzeichnisse, immer mit `timeout`.

## Release

Tag `v*` pushen → `.github/workflows/release.yml`: Node-Tests (ubuntu), dann Windows-Exe
(`pyinstaller==6.16.0 --onefile --name keycap-designer --add-data "web;web" start.py`) als Artifact und
Release-Asset. Lokaler Linux-Test: gleicher Befehl mit `web:web`, Binary mit `--no-browser` starten.
Hinweis: PyInstaller braucht beim Bauen genug Platz im Ausgabeverzeichnis (objcopy) und beim Start in `TMPDIR`.

## Domänen-Vokabular

- **u**: Raster 19,05 mm; eine Taste mit Breite `w` u belegt `w·19,05` mm, die Cap ist 1,68 mm
  kleiner (Fuge) — beim Referenz-1u also ≈ 17,37 mm.
- **us** = ANSI, US-QWERTY · **en** = ISO-UK (QWERTY, £, ISO-Enter, `\|`-Taste links) ·
  **de** = ISO-DE (QWERTZ, AltGr-Legends, deutsche Modifier-Namen).
- **Legend**: eigener Körper, bündig in die Top-Oberfläche eingelassen (gleiche Mulde/Neigung),
  `Cap − Legend` ergibt den Cap-Körper. Font: DejaVu Sans Bold (deckt Umlaute, €, £, ², ³, µ, Pfeile).
- **Profil**: einheitlich — jede Reihe nutzt die Referenzform (keine Reihen-Skulptur).
- **Stabilisator-Stems** (Cherry): ab 2u zusätzliche Stems bei ±11,938 mm, 6,25u bei ±50 mm;
  vertikal für ISO-Enter, Numpad-Enter und Numpad-Plus.
