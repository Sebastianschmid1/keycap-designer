import test from 'node:test';
import assert from 'node:assert/strict';
import { index, blob, getMesh } from './helpers.mjs';

test('index: 12 Layouts, Tasten verweisen auf gültige Meshes', () => {
  assert.equal(Object.keys(index.layouts).length, 12);
  for (const L of Object.values(index.layouts)) {
    for (const k of L.keys) assert.ok(index.meshes[k.mesh], k.id);
  }
});

test('Dekodierung liefert die im Index (= Python mesh_of) angegebenen Vertex-/Dreieckszahlen', () => {
  index.meshes.forEach((e, i) => {
    const m = getMesh(i);
    for (const part of ['cap', 'legend']) {
      if (!e[part]) { assert.equal(m[part], null); continue; }
      assert.equal(m[part].pos.length, e[part].v * 3);
      assert.equal(m[part].idx.length, e[part].t * 3);
      let max = 0;
      for (const v of m[part].idx) max = Math.max(max, v);
      assert.ok(max < e[part].v);
    }
  });
});

test('dekodierte Positionen füllen die bbox exakt aus (Cap + Legend zusammen)', () => {
  index.meshes.forEach((e, i) => {
    const m = getMesh(i);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const part of [m.cap, m.legend]) {
      if (!part) continue;
      for (let j = 0; j < part.pos.length; j++) {
        lo[j % 3] = Math.min(lo[j % 3], part.pos[j]); hi[j % 3] = Math.max(hi[j % 3], part.pos[j]);
      }
    }
    for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(lo[a] - e.bbox[a]) < 1e-3 && Math.abs(hi[a] - e.bbox[a + 3]) < 1e-3, `Mesh ${i} Achse ${a}`);
    }
  });
});

test('Blob-Größe passt zu den Offsets', () => {
  const last = index.meshes.at(-1);
  const p = last.legend || last.cap;
  const pad = (n) => n + ((4 - (n % 4)) % 4);
  assert.equal(blob.length, p.off + pad(p.v * 6) + pad(p.t * 3 * (p.v <= 65535 ? 2 : 4)));
});
