import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pack, X_MIN, X_MAX, Y_MIN, Y_MAX } from '../lib/pack.js';

// Fixture: Ergebnisse von keycaps/print3mf.py::pack für dieselben Größen (siehe tests/test_print3mf.py).
const cases = JSON.parse(readFileSync(new URL('./fixtures/pack.json', import.meta.url), 'utf8'));

test('pack stimmt mit dem Python-Ergebnis überein', () => {
  for (const c of cases) {
    const r = pack(c.sizes);
    assert.deepEqual(r.plateOf, c.plateOf);
    assert.deepEqual(r.pos, c.pos);
  }
});

test('pack hält Bettgrenzen ein', () => {
  for (const c of cases) {
    const r = pack(c.sizes);
    c.sizes.forEach(([w, h], i) => {
      const [x, y] = r.pos[i];
      assert.ok(x >= X_MIN && x + w <= X_MAX + 1e-9 && y >= Y_MIN && y + h <= Y_MAX + 1e-9);
    });
  }
});

test('zu große Taste wird abgelehnt', () => {
  assert.throws(() => pack([[300, 10]]), /passt nicht/);
});
