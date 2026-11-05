import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, applyPattern } from '../lib/patterns.js';
import { createMap } from '../lib/paintmap.js';
import { index } from './helpers.mjs';

const ctxFor = (name, nSlots) => {
  const layout = index.layouts[name];
  return { layout, nSlots, map: createMap(layout.bbox), assign: new Map(layout.keys.map((k) => [k.id, { capSlot: 1, legendSlot: 2 }])) };
};

test('10 Muster mit Namen', () => {
  assert.equal(PATTERNS.length, 10);
  assert.ok(PATTERNS.every((p) => p.name && typeof p.run === 'function'));
});

for (const n of [2, 8]) {
  test(`alle Muster, ${n} Slots, alle 12 Layouts: Slots im gültigen Bereich`, () => {
    for (const name of Object.keys(index.layouts)) {
      PATTERNS.forEach((p, i) => {
        const c = ctxFor(name, n);
        applyPattern(i, c);
        for (const a of c.assign.values()) {
          assert.ok(Number.isInteger(a.capSlot) && a.capSlot >= 1 && a.capSlot <= n, `${name} ${p.name} cap ${a.capSlot}`);
          assert.ok(Number.isInteger(a.legendSlot) && a.legendSlot >= 1 && a.legendSlot <= n, `${name} ${p.name} legend ${a.legendSlot}`);
        }
        assert.ok(c.map.data.every((v) => v <= n), `${name} ${p.name} Karte`);
      });
    }
  });
}

test('gemalte Muster füllen die Karte, andere leeren sie; mehrere Slots werden genutzt', () => {
  const painted = [6, 7, 8, 9];
  PATTERNS.forEach((p, i) => {
    const c = ctxFor('us_60', 8);
    c.map.data.fill(5);
    applyPattern(i, c);
    const used = new Set(c.map.data);
    if (painted.includes(i)) assert.ok(used.size >= 2, p.name); else assert.deepEqual([...used], [0], p.name);
  });
  const c = ctxFor('us_60', 8); applyPattern(6, c);
  assert.ok(new Set(c.map.data).has(3));
  assert.ok(!new Set(c.map.data).has(2), 'Slot 2 bleibt der Schrift vorbehalten');
});

test('Akzent und Regenbogen-Spalten', () => {
  const c = ctxFor('de_full', 8);
  applyPattern(2, c);
  assert.equal(c.assign.get('Escape').capSlot, 3);
  assert.equal(c.assign.get('KeyA').capSlot, 1);
  applyPattern(5, c);
  assert.equal(new Set([...c.assign.values()].map((a) => a.capSlot)).size, 8);
});
