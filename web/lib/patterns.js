// 10 fertige Muster für die ganze Tastatur. Nicht gemalte Muster setzen cap-/legendSlot und leeren die Karte,
// gemalte setzen Klassisch (Caps 1, Legends 2) und schreiben in die Karte. Funktioniert für 2-8 Slots.
import { U } from './paintmap.js';

const centerOf = (k) => [(k.x + k.w / 2) * U, -(k.y + k.h / 2) * U];
/** Slot s, falls vorhanden, sonst fallback. */
const have = (n, s, fallback) => (s <= n ? s : fallback);
/** Slots, über die gemalte Muster laufen: Slot 2 bleibt der Schrift vorbehalten, solange es einen dritten gibt. */
const bandSlots = (n) => (n >= 3 ? [1, ...Array.from({ length: n - 2 }, (_, i) => i + 3)] : [1, 2]);
const contrast = (cap) => (cap === 1 ? 2 : 1);

function classic(c) {
  for (const a of c.assign.values()) { a.capSlot = 1; a.legendSlot = 2; }
  c.map.data.fill(0);
}

function paintAll(c, fn) {
  classic(c);
  const m = c.map;
  for (let py = 0; py < m.h; py++) {
    const y = m.ymax - (py + 0.5) * m.res;
    for (let px = 0; px < m.w; px++) m.data[py * m.w + px] = fn(m.xmin + (px + 0.5) * m.res, y, px, py);
  }
}

const perKey = (c, fn) => {
  c.map.data.fill(0);
  c.layout.keys.forEach((k, i) => {
    const [cap, legend] = fn(k, i);
    Object.assign(c.assign.get(k.id), { capSlot: cap, legendSlot: legend });
  });
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const PATTERNS = [
  { name: 'Klassisch', run: classic },
  { name: 'Modifier-Kontrast', run: (c) => perKey(c, (k) => (k.kind === 'alpha' ? [1, 2] : [2, 1])) },
  { name: 'Akzent', run: (c) => perKey(c, (k) => (['Escape', 'Enter', 'Space'].includes(k.id) ? [have(c.nSlots, 3, 2), have(c.nSlots, 3, 2) === 2 ? 1 : 2] : [1, 2])) },
  { name: 'Schachbrett', run: (c) => perKey(c, (k) => {
    const [cx, cy] = centerOf(k);
    return (Math.floor(cx / U) + Math.round(-cy / U)) % 2 === 0 ? [1, 2] : [2, 1];
  }) },
  { name: 'Reihen', run: (c) => {
    const rows = [...new Set(c.layout.keys.map((k) => Math.round(k.y * 4)))].sort((a, b) => a - b);
    perKey(c, (k) => { const cap = 1 + (rows.indexOf(Math.round(k.y * 4)) % c.nSlots); return [cap, contrast(cap)]; });
  } },
  { name: 'Regenbogen-Spalten', run: (c) => {
    const [x0, , x1] = c.layout.bbox;
    perKey(c, (k) => {
      const cap = 1 + Math.min(c.nSlots - 1, Math.floor(((centerOf(k)[0] - x0) / (x1 - x0)) * c.nSlots));
      return [cap, contrast(cap)];
    });
  } },
  { name: 'Diagonale Streifen', run: (c) => {
    const s = bandSlots(c.nSlots);
    paintAll(c, (x, y) => s[Math.abs(Math.floor((x + y) / 8)) % s.length]);
  } },
  { name: 'Wellen', run: (c) => {
    const s = bandSlots(c.nSlots);
    paintAll(c, (x, y) => s[Math.abs(Math.floor((y + 3 * Math.sin(x / 6)) / 5)) % s.length]);
  } },
  { name: 'Punkte', run: (c) => {
    const s = bandSlots(c.nSlots), P = 5;
    paintAll(c, (x, y) => {
      const row = Math.floor(y / P), cx = (Math.floor((x + (row & 1 ? P / 2 : 0)) / P) + 0.5) * P - (row & 1 ? P / 2 : 0);
      const cy = (row + 0.5) * P;
      if ((x - cx) ** 2 + (y - cy) ** 2 > 1.4 * 1.4) return 0;
      return s[Math.abs(Math.floor(cx / P)) % (s.length - 1) + 1];
    });
  } },
  { name: 'Verlauf', run: (c) => {
    const [x0, , x1] = c.layout.bbox;
    paintAll(c, (x, _y, px, py) => ((x - x0) / (x1 - x0) > (BAYER[(py & 3) * 4 + (px & 3)] + 0.5) / 16 ? 2 : 1));
  } },
];

/** i: 0-basierter Musterindex. ctx: {layout (index.layouts[name]), nSlots, map, assign: Map(keyId -> {capSlot, legendSlot})}. */
export const applyPattern = (i, ctx) => PATTERNS[i].run(ctx);
