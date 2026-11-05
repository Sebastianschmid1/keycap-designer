// Headless-3MF-Export:
//   node web/tools/export_cli.mjs <layout> <zuordnung.json> <ausgabe.3mf>     (4a: Zuordnung per Spec, keine Bemalung)
//   node web/tools/export_cli.mjs --project <projekt.json> <ausgabe.3mf>      (Projektdatei aus "Projekt speichern", mit Bemalung)
// Eine Platte -> exakt <ausgabe.3mf>, mehrere -> <ausgabe>_plate_<n>.3mf (n ab 1). Gibt die Pfade aus.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMesh } from '../lib/mesh.js';
import { buildPlates } from '../lib/threemf.js';
import { resolveAssign } from '../lib/assign.js';
import { exportPlates, parseProject } from '../lib/project.js';

const args = process.argv.slice(2);
const isProject = args[0] === '--project';
const [a1, a2, a3] = isProject ? args.slice(1) : args;
const outFile = isProject ? a2 : a3;
if (!outFile) {
  console.error('Aufruf: node export_cli.mjs <layout z. B. us_60> <zuordnung.json> <ausgabe.3mf>\n    oder: node export_cli.mjs --project <projekt.json> <ausgabe.3mf>');
  process.exit(2);
}
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'));
const blob = readFileSync(join(dataDir, 'meshes.bin'));
const cache = new Map();
const getMesh = (i) => {
  if (!cache.has(i)) cache.set(i, decodeMesh(blob, index.meshes[i]));
  return cache.get(i);
};
let plates;
if (isProject) {
  plates = exportPlates(index, getMesh, parseProject(JSON.parse(readFileSync(a1, 'utf8')), index));
} else {
  const layout = index.layouts[a1];
  if (!layout) {
    console.error(`Unbekanntes Layout ${a1}; verfügbar: ${Object.keys(index.layouts).join(', ')}`);
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(a2, 'utf8'));
  plates = buildPlates(layout, getMesh, (k) => resolveAssign(spec, k));
}
plates.forEach((bytes, n) => {
  const p = plates.length === 1 ? outFile : outFile.replace(/(\.3mf)?$/, `_plate_${n + 1}.3mf`);
  writeFileSync(p, bytes);
  console.log(p);
});
