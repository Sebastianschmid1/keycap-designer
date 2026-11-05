import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { serializeProject, parseProject, exportPlates } from '../lib/project.js';
import { createMap, stampLine } from '../lib/paintmap.js';
import { applyPattern } from '../lib/patterns.js';
import { index, getMesh } from './helpers.mjs';

const make = (name = 'us_60') => {
  const L = index.layouts[name];
  const assign = new Map(L.keys.map((k) => [k.id, { capSlot: 1, legendSlot: 2 }]));
  assign.get('KeyA').capSlot = 4;
  const map = createMap(L.bbox);
  return { layout: name, slots: ['#d9d9d9', '#1a1a1a', '#d62828', '#1d4ed8'].map((color) => ({ color })), assign, map };
};

test('Projekt: Roundtrip über JSON', () => {
  const p = make();
  stampLine(p.map, 20, -30, 200, -60, 2, 3);
  const q = parseProject(JSON.parse(JSON.stringify(serializeProject(p))), index);
  assert.equal(q.layout, 'us_60');
  assert.deepEqual(q.slots, p.slots);
  assert.deepEqual(q.assign, p.assign);
  assert.deepEqual(q.map.data, p.map.data);
});

test('Projekt: ungültige Dateien werden abgelehnt', () => {
  const o = serializeProject(make());
  assert.throws(() => parseProject({ ...o, version: 9 }, index), /Version/);
  assert.throws(() => parseProject({ ...o, layout: 'xx_60' }, index), /Layout/);
  assert.throws(() => parseProject({ ...o, assign: { KeyA: [9, 1] } }, index), /Zuordnung/);
  assert.throws(() => parseProject({ ...o, map: { ...o.map, w: 5 } }, index), /Farbkarte/);
  assert.throws(() => parseProject({ ...o, slots: ['#fff', '#000'] }, index), /Slots/);
});

test('Export: Slot 3 nur über Bemalung -> paint_color im 3MF, kein Part mit Extruder 3', () => {
  const p = make();
  p.assign.get('KeyA').capSlot = 1;
  applyPattern(6, { layout: index.layouts.us_60, nSlots: 4, map: p.map, assign: p.assign });
  const plates = exportPlates(index, getMesh, parseProject(serializeProject(p), index));
  const files = unzipSync(plates[0]);
  const model = strFromU8(files['3D/3dmodel.model']), cfg = strFromU8(files['Metadata/model_settings.config']);
  assert.ok((model.match(/paint_color="0C"/g) || []).length > 1000);
  assert.ok((model.match(/paint_color="1C"/g) || []).length > 1000);
  assert.doesNotMatch(cfg, /key="extruder" value="3"/);
});

test('Export: unbemalte Tasten bleiben unverfeinert und ohne paint_color', () => {
  const p = make();
  const plates = exportPlates(index, getMesh, p);
  const model = strFromU8(unzipSync(plates[0])['3D/3dmodel.model']);
  assert.doesNotMatch(model, /paint_color/);
  const tris = (model.match(/<triangle /g) || []).length;
  const expect = index.layouts.us_60.keys.reduce((s, k) => s + index.meshes[k.mesh].cap.t + (index.meshes[k.mesh].legend ? index.meshes[k.mesh].legend.t : 0), 0);
  assert.equal(tris, expect);
});
