import test from 'node:test';
import assert from 'node:assert/strict';
import { refineTop, paintCap, paintCode, normalZ, MAX_EDGE, TOP_NZ } from '../lib/refine.js';
import { createMap, fillRect, keyRects } from '../lib/paintmap.js';
import { index, getMesh, edgeProblems, area } from './helpers.mjs';

// Mesh-Auswahl: kleinste und größte Cap-Dreieckszahl, Space (6,25u), ISO-Enter, Numpad-Plus (vertikal), 1u.
const pick = () => {
  const keys = Object.values(index.layouts).flatMap((L) => L.keys);
  const by = (f) => keys.find(f);
  const sorted = [...new Set(keys.map((k) => k.mesh))].sort((a, b) => index.meshes[a].cap.t - index.meshes[b].cap.t);
  return [...new Set([sorted[0], sorted[sorted.length - 1], by((k) => k.id === 'Space').mesh, by((k) => k.shape === 'iso').mesh,
    by((k) => k.id === 'NumpadAdd').mesh, by((k) => k.id === 'KeyA').mesh])];
};

test('Ausgangsmeshes sind wasserdicht (Voraussetzung)', () => {
  for (const i of pick()) assert.equal(edgeProblems(getMesh(i).cap.idx), null, `Mesh ${i}`);
});

test('Verfeinerung: wasserdicht, Top-Kanten <= 0,5 mm, Fläche unverändert', () => {
  for (const i of pick()) {
    const cap = getMesh(i).cap;
    const r = refineTop(cap);
    assert.equal(edgeProblems(r.idx), null, `Mesh ${i}`);
    assert.ok(r.idx.length > cap.idx.length);
    let longest = 0;
    for (let t = 0; t < r.idx.length; t += 3) {
      if (normalZ(r.pos, r.idx[t], r.idx[t + 1], r.idx[t + 2]) <= TOP_NZ) continue;
      for (let e = 0; e < 3; e++) {
        const a = r.idx[t + e] * 3, b = r.idx[t + (e + 1) % 3] * 3;
        longest = Math.max(longest, Math.hypot(r.pos[a] - r.pos[b], r.pos[a + 1] - r.pos[b + 1], r.pos[a + 2] - r.pos[b + 2]));
      }
    }
    assert.ok(longest <= MAX_EDGE + 1e-6, `Mesh ${i}: längste Top-Kante ${longest}`);
    const a0 = area(cap.pos, cap.idx), a1 = area(r.pos, r.idx);
    assert.ok(Math.abs(a1 - a0) / a0 < 1e-6, `Mesh ${i}: Fläche ${a0} -> ${a1}`);
  }
});

test('paint_color-Kodierung', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(paintCode), ['4', '8', '0C', '1C', '2C', '3C', '4C', '5C']);
});

test('paintCap: nur Top-Dreiecke im bemalten Bereich bekommen Codes; capSlot/0 nicht', () => {
  const L = index.layouts.us_60, k = L.keys.find((x) => x.id === 'KeyA');
  const map = createMap(L.bbox);
  const [r] = keyRects(k, index.u);
  const half = [r[0], r[1], (r[0] + r[2]) / 2, r[3]];
  fillRect(map, half, 3);
  const { mesh, paint } = paintCap(getMesh(k.mesh).cap, k.stem, map, 1, 4);
  const codes = paint.filter(Boolean);
  assert.ok(codes.length > 100 && codes.every((c) => c === '0C'));
  for (let t = 0; t < paint.length; t++) {
    const [a, b, c] = [mesh.idx[t * 3], mesh.idx[t * 3 + 1], mesh.idx[t * 3 + 2]];
    if (paint[t]) {
      assert.ok(normalZ(mesh.pos, a, b, c) > TOP_NZ);
      assert.ok((mesh.pos[a * 3] + mesh.pos[b * 3] + mesh.pos[c * 3]) / 3 + k.stem[0] < (r[0] + r[2]) / 2 + 1e-3);
    }
  }
  // capSlot == Kartenwert -> kein paint_color
  assert.equal(paintCap(getMesh(k.mesh).cap, k.stem, map, 3, 4).paint.filter(Boolean).length, 0);
});
