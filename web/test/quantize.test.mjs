import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestSlot, quantizeImage, hexToRgb } from '../lib/quantize.js';

const pal = ['#d9d9d9', '#1a1a1a', '#d62828', '#1d4ed8'].map(hexToRgb);
const img = (w, h, f) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(f(i % w, Math.floor(i / w)), i * 4);
  return { data, width: w, height: h };
};

test('nearestSlot: reine Farben', () => {
  assert.equal(nearestSlot([250, 250, 250], pal), 1);
  assert.equal(nearestSlot([10, 10, 10], pal), 2);
  assert.equal(nearestSlot([220, 30, 30], pal), 3);
  assert.equal(nearestSlot([20, 70, 220], pal), 4);
});

test('Alpha < 128 = 0 (nicht malen)', () => {
  const q = quantizeImage(img(2, 1, (x) => (x ? [0, 0, 0, 127] : [0, 0, 0, 128])), pal, false);
  assert.deepEqual([...q], [2, 0]);
});

test('Dithering: Mittelgrau mischt zwei Slots, ohne Dithering einheitlich', () => {
  const grey = img(32, 32, () => [120, 120, 120, 255]);
  const two = pal.slice(0, 2);
  const plain = quantizeImage(grey, two, false), dith = quantizeImage(grey, two, true);
  assert.equal(new Set(plain).size, 1);
  assert.deepEqual([...new Set(dith)].sort(), [1, 2]);
  const ones = dith.filter((v) => v === 1).length / dith.length;
  assert.ok(ones > 0.3 && ones < 0.7, `Anteil ${ones}`);
});
