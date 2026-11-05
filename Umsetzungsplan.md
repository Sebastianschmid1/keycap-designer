# Umsetzungsplan

Ziel: 12 vollständige Keycap-Layouts (de/en/us × 100 %/TKL/75 %/60 %) nach der Onshape-Referenz,
zweifarbig (Cap + Legend), lokal als STEP/3MF und als Onshape-Import.

- [x] Onshape-Zugang aus `~/panzer/.env` übernommen, Referenz analysiert und als `reference/ref_cap_1u.step` exportiert (2026-11-05)
- [x] Projekt-Venv `.venv` (cadquery 2.8.0, OCP 7.9.3.1.1, trimesh 5.1.0, pytest) (2026-11-05)
- [x] Stufe 1: Cap-Geometrie (alle Breiten, ISO-Enter, Stabilisator-Stems), Legend-Inlay, Layout-Daten (12), STEP-Export je Layout, Tests (2026-11-05; 49 Tests grün, `--all` 2 m 44 s)
  - offen (optional): Stab-Stems ohne r1-Übergang zur Decke (OCC-Fillet scheitert); „Druck“ hält rechts nur 0,94 statt 1 mm Rand
- [x] Stufe 2: 3MF-Druckplatten (X2D, zwei Filamente) und Onshape-Import-Skript
  - [x] `print3mf.py` (Packing, 1 Platte je Layout) und `onshape.py` (additiv, State-Datei), 57 Tests grün (2026-11-05)
  - [x] Bambu ignoriert `basematerials` → Part-Extruder in `model_settings.config`; Slicer-Test de_full: Filament 1 135,8 g, Filament 2 0,45 g, 58 Tests grün (2026-11-05)
- [x] Stufe 3: Import der 12 Layouts nach Onshape — öffentliches Dokument „keycaps“ (Free-Account erlaubt keine privaten), alle 12 Translations DONE, Cap-Zahl je Tab geprüft, de_60 sichtgeprüft (2026-11-05)
  - offen (optional): identische rechte Modifier (Strg/Win/Alt) werden im STEP als Instanz der linken exportiert → Onshape-Name `ControlLeft_cap_1` statt `ControlRight_cap`; Behebung bräuchte neue Tabs
- [x] Stufe 4: Browser-Frontend (three.js, ohne Build-Step) + Starter `start.py` / Windows-EXE, öffentliches GitHub-Repo
  - [x] 4a Basis: Mesh-Daten `web/data` (Python), Viewer, Layout-Wahl, Filament-Slots 2–8, Farbe je Taste/Legend/ganze Tastatur, 3MF-Export im Browser (Part-Extruder) (2026-11-05; web/data 9,6 MB, 63 pytest + 12 node-Tests grün, Bambu-Slicetest us_60 mit 4 Slots: alle 4 Filamente > 0 g)
  - [x] 4b Malen: Farbkarte (Slot-Index je 0,25 mm), Pinsel, Bilder auf Taste/Tastatur (Quantisierung + Dithering), 10 Muster, `paint_color` mit konformer Verfeinerung, Projekt speichern/laden (2026-11-05; Slicetests: us_60 Slot 3 nur per Bemalung 4,66 g, de_full mit Bild alle 4 Filamente > 0; Lead-Nachprüfung: Kodierung Slot 2 (`8`) und Slot 8 (`5C`) per Slicetest belegt, Legends bleiben bei Vollbemalung erhalten (Legend-Extrusion −7 %); offen (optional): 3MF bemalter Tasten groß, de_full mit Bild ≈ 40 MB)
  - [x] 4c Veröffentlichung (2026-11-06)
    - [x] README + Screenshot, MIT-Lizenz, `release.yml` (Node-Tests → Windows-Exe als Release-Asset), `.gitignore` ergänzt (2026-11-05; PyInstaller-Linux-Smoke-Test ok)
    - [x] Repo `Sebastianschmid1/keycap-designer` öffentlich, Secret-Scan ohne Treffer, `main` gepusht, Release `v0.1.0` mit `keycap-designer.exe` (16 MB) per Actions (2026-11-06; Probelauf per `workflow_dispatch` grün, Exe auf Windows-PC gestartet: `app.js` als `text/javascript`, `data/index.json` 200)
    - offen (optional): Actions auf Node-24-Versionen heben (checkout/setup-node/setup-python/upload-artifact laufen noch als Node 20, nur Warnung); Exe unsigniert (SmartScreen)
