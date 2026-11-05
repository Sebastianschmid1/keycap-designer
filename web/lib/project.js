// Projektdatei (JSON) und gemeinsamer Exportpfad für Browser und CLI.
//   {version: 1, layout, slots: ['#rrggbb', ...], assign: {keyId: [capSlot, legendSlot]}, map: {w, h, res, data: base64-RLE}}
import { createMap, decodeData, encodeData, hasPaint, keyRects } from './paintmap.js';
import { paintCap } from './refine.js';
import { buildPlates } from './threemf.js';

export const VERSION = 1;

/** assign: Map(keyId -> {capSlot, legendSlot}); map: Farbkarte des Layouts. */
export function serializeProject({ layout, slots, assign, map }) {
  return {
    version: VERSION,
    layout,
    slots: slots.map((s) => s.color),
    assign: Object.fromEntries([...assign].map(([id, a]) => [id, [a.capSlot, a.legendSlot]])),
    map: { w: map.w, h: map.h, res: map.res, data: encodeData(map.data) },
  };
}

/** -> {layout, slots: [{color}], assign: Map, map}; prüft Version, Layout, Slots und Kartengröße gegen index. */
export function parseProject(obj, index) {
  if (!obj || obj.version !== VERSION) throw new Error(`Projektdatei: Version ${obj && obj.version} wird nicht unterstützt`);
  const L = index.layouts[obj.layout];
  if (!L) throw new Error(`Projektdatei: unbekanntes Layout ${obj.layout}`);
  if (!Array.isArray(obj.slots) || obj.slots.length < 2 || obj.slots.length > 8 || !obj.slots.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) {
    throw new Error('Projektdatei: ungültige Slots');
  }
  const n = obj.slots.length;
  const ok = (s) => Number.isInteger(s) && s >= 1 && s <= n;
  const assign = new Map(L.keys.map((k) => {
    const a = (obj.assign || {})[k.id];
    if (a && !(ok(a[0]) && ok(a[1]))) throw new Error(`Projektdatei: ungültige Zuordnung für ${k.id}`);
    return [k.id, { capSlot: a ? a[0] : 1, legendSlot: a ? a[1] : 2 }];
  }));
  const map = createMap(L.bbox, obj.map && obj.map.res);
  if (!obj.map || obj.map.w !== map.w || obj.map.h !== map.h) throw new Error('Projektdatei: Farbkarte passt nicht zum Layout');
  map.data = decodeData(obj.map.data, map.w * map.h);
  if (map.data.some((v) => v > n)) throw new Error('Projektdatei: Farbkarte enthält Slots über der Slotzahl');
  return { layout: obj.layout, slots: obj.slots.map((color) => ({ color })), assign, map };
}

/** Projekt (Ergebnis von parseProject bzw. {layout, slots, assign, map}) -> Platten (Uint8Array je Platte). */
export function exportPlates(index, getMesh, project) {
  const L = index.layouts[project.layout];
  return buildPlates(L, getMesh, (k) => {
    const a = project.assign.get(k.id);
    return { cap: a.capSlot, legend: a.legendSlot };
  }, (k, mesh, capSlot) => {
    if (!hasPaint(project.map, keyRects(k, index.u), capSlot)) return null;
    return paintCap(mesh.cap, k.stem, project.map, capSlot, project.slots.length);
  });
}
