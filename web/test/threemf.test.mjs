import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { buildPlates } from '../lib/threemf.js';
import { resolveAssign } from '../lib/assign.js';
import { X_MIN } from '../lib/pack.js';
import { index, getMesh } from './helpers.mjs';

const spec = { default: { cap: 1, legend: 2 }, kind: { mod: { cap: 3 } }, keys: { Escape: { cap: 4 }, Enter: { cap: 4 } } };
const layout = index.layouts.us_60;
const plates = buildPlates(layout, getMesh, (k) => resolveAssign(spec, k));
const files = unzipSync(plates[0]);
const model = strFromU8(files['3D/3dmodel.model']);
const cfg = strFromU8(files['Metadata/model_settings.config']);

test('resolveAssign: default < kind < keys', () => {
  const k = (id, kind) => ({ id, kind });
  assert.deepEqual(resolveAssign(spec, k('KeyA', 'alpha')), { cap: 1, legend: 2 });
  assert.deepEqual(resolveAssign(spec, k('Tab', 'mod')), { cap: 3, legend: 2 });
  assert.deepEqual(resolveAssign(spec, k('Enter', 'mod')), { cap: 4, legend: 2 });
});

test('3MF: Paketstruktur', () => {
  assert.deepEqual(Object.keys(files).sort(), ['3D/3dmodel.model', 'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels']);
  assert.match(model, /<model xmlns="http:\/\/schemas.microsoft.com\/3dmanufacturing\/core\/2015\/02" unit="millimeter">/);
  assert.doesNotMatch(model, /BambuStudio|basematerials/);
});

test('3MF: je Taste eigene Cap-/Legend-Mesh-Objekte, keine geteilten', () => {
  const n = layout.keys.length, noLegend = layout.keys.filter((k) => index.meshes[k.mesh].legend === null).length;
  assert.equal(plates.length, 1);
  assert.equal((model.match(/<mesh>/g) || []).length, 2 * n - noLegend);
  assert.equal((model.match(/<components>/g) || []).length, n);
  assert.equal((model.match(/<item /g) || []).length, n);
  const refs = [...model.matchAll(/<component objectid="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(refs).size, refs.length);
});

test('3MF: Part-Extruder je Taste aus der Zuordnung', () => {
  const part = (name) => cfg.match(new RegExp(`<metadata key="name" value="${name}"/><metadata key="extruder" value="(\\d+)"/>`))[1];
  assert.equal(part('KeyA_cap'), '1');
  assert.equal(part('KeyA_legend'), '2');
  assert.equal(part('Tab_cap'), '3');
  assert.equal(part('Enter_cap'), '4');
  assert.equal(part('Enter_legend'), '2');
  assert.doesNotMatch(cfg, /Space_legend/);
  assert.deepEqual([...new Set([...cfg.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1]))].sort(), ['1', '2', '3', '4']);
});

test('3MF: alle Footprints liegen bei X >= 23,5 mm', () => {
  const dx = [...model.matchAll(/transform="1 0 0 0 1 0 0 0 1 ([-\d.]+) /g)].map((m) => Number(m[1]));
  layout.keys.forEach((k, i) => {
    assert.ok(dx[i] + index.meshes[k.mesh].bbox[0] >= X_MIN - 1e-4, k.id);
  });
});
