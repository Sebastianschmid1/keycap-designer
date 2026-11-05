import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, sample, stampCircle, stampLine, fillRect, hasPaint, keyRects, writeBlock, encodeData, decodeData, RES } from '../lib/paintmap.js';

const bbox = [0.84, -94.6, 284.9, -0.88];

test('Karte: Größe und Pixelabbildung', () => {
  const m = createMap(bbox);
  assert.equal(m.res, RES);
  assert.equal(m.w, Math.ceil((284.9 - 0.84) / 0.25));
  assert.equal(m.h, Math.ceil((94.6 - 0.88) / 0.25));
  m.data[3 * m.w + 5] = 7; // px 5, py 3
  assert.equal(sample(m, 0.84 + 5.1 * 0.25, -0.88 - 3.1 * 0.25), 7);
  assert.equal(sample(m, -5, -5), 0);
  assert.equal(sample(m, 100, 5), 0);
});

test('Kreisstempel: Radius, Clip, Radierer', () => {
  const m = createMap(bbox);
  stampCircle(m, 50, -30, 2, 3);
  assert.equal(sample(m, 50, -30), 3);
  assert.equal(sample(m, 51.8, -30), 3);
  assert.equal(sample(m, 52.3, -30), 0);
  stampCircle(m, 50, -30, 1, 0);
  assert.equal(sample(m, 50, -30), 0);
  assert.equal(sample(m, 51.5, -30), 3);
  stampCircle(m, 100, -30, 3, 2, [[99, -40, 200, 0]]);
  assert.equal(sample(m, 98, -30), 0);
  assert.equal(sample(m, 101, -30), 2);
});

test('Linie: lückenlos zwischen zwei Punkten', () => {
  const m = createMap(bbox);
  const box = stampLine(m, 20, -20, 60, -50, 0.5, 4);
  for (let t = 0; t <= 1; t += 0.01) assert.equal(sample(m, 20 + 40 * t, -20 - 30 * t), 4, `t=${t}`);
  assert.ok(box[2] > box[0] && box[3] > box[1]);
});

test('Footprint füllen/leeren, hasPaint', () => {
  const m = createMap(bbox);
  const k = { id: 'x', x: 1, y: 0, w: 1, h: 1, shape: 'rect' };
  const [r] = keyRects(k);
  assert.deepEqual(r.map((v) => Math.round(v * 100) / 100 + 0), [19.05, -19.05, 38.1, 0].map((v) => v + 0));
  assert.equal(hasPaint(m, [r], 1), false);
  fillRect(m, r, 1);
  assert.equal(hasPaint(m, [r], 1), false);
  assert.equal(hasPaint(m, [r], 2), true);
  fillRect(m, r, 0);
  assert.equal(hasPaint(m, [r], 2), false);
  assert.equal(keyRects({ x: 13, y: 1, w: 1.5, h: 2, shape: 'iso' }).length, 2);
});

test('writeBlock: 0 überspringt, Clip begrenzt', () => {
  const m = createMap(bbox);
  writeBlock(m, 10, 10, 2, 2, Uint8Array.from([1, 0, 2, 3]));
  assert.deepEqual([m.data[10 * m.w + 10], m.data[10 * m.w + 11], m.data[11 * m.w + 10], m.data[11 * m.w + 11]], [1, 0, 2, 3]);
});

test('Kodierung: Roundtrip, kompakt, Fehler bei falscher Länge', () => {
  const m = createMap(bbox);
  stampCircle(m, 60, -40, 5, 5); stampLine(m, 10, -10, 200, -70, 1, 8);
  const s = encodeData(m.data);
  assert.ok(s.length < m.data.length / 10);
  assert.deepEqual(decodeData(s, m.data.length), m.data);
  assert.throws(() => decodeData(s, m.data.length + 1));
  assert.throws(() => decodeData(s, 10));
});
