// Konforme Verfeinerung der Top-Dreiecke eines Cap-Meshes und paint_color-Zuordnung aus der Farbkarte.
// Regel "Top-Fläche" (Vorschau = Export): Normale z > TOP_NZ. Abgetastet wird am Dreiecksschwerpunkt (Mesh + Stem = Welt).
import { sample } from './paintmap.js';

export const MAX_EDGE = 0.5;
export const TOP_NZ = 0.5;

/** Normalen-z eines Dreiecks (normiert) aus pos (Array/Float32Array) und Indizes. */
export function normalZ(pos, a, b, c) {
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
  const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l > 0 ? nz / l : 0;
}

const KEYN = 4194304; // Vertexzahl < 2^22
const ekey = (a, b) => (a < b ? a * KEYN + b : b * KEYN + a);

/** cap: {pos, idx} -> {pos: Float32Array, idx: Uint32Array}; kein Top-Kantenstück > maxEdge, wasserdicht (kantenbasierte Teilung). */
export function refineTop(cap, maxEdge = MAX_EDGE) {
  const pos = Array.from(cap.pos);
  let idx = Array.from(cap.idx);
  const dist = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (let pass = 0; ; pass++) {
    const split = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (normalZ(pos, v[0], v[1], v[2]) <= TOP_NZ) continue;
      for (let e = 0; e < 3; e++) if (dist(v[e], v[(e + 1) % 3]) > maxEdge) split.add(ekey(v[e], v[(e + 1) % 3]));
    }
    if (!split.size) break;
    if (pass > 24) throw new Error('Verfeinerung konvergiert nicht');
    const mids = new Map();
    const mid = (a, b) => {
      const k = ekey(a, b);
      let m = mids.get(k);
      if (m === undefined) {
        m = pos.length / 3;
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
        mids.set(k, m);
      }
      return m;
    };
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      const f = [0, 1, 2].map((e) => split.has(ekey(v[e], v[(e + 1) % 3])));
      const n = f[0] + f[1] + f[2];
      if (n === 0) { out.push(v[0], v[1], v[2]); continue; }
      if (n === 1) {
        const s = f.indexOf(true), a = v[s], b = v[(s + 1) % 3], c = v[(s + 2) % 3], m = mid(a, b);
        out.push(a, m, c, m, b, c);
      } else if (n === 2) {
        const u = f.indexOf(false), a = v[(u + 1) % 3], b = v[(u + 2) % 3], c = v[u];
        const m0 = mid(a, b), m1 = mid(b, c);
        out.push(m0, b, m1);
        if (dist(m0, c) < dist(a, m1)) out.push(a, m0, c, m0, m1, c); else out.push(a, m0, m1, a, m1, c);
      } else {
        const m0 = mid(v[0], v[1]), m1 = mid(v[1], v[2]), m2 = mid(v[2], v[0]);
        out.push(v[0], m0, m2, m0, v[1], m1, m2, m1, v[2], m0, m1, m2);
      }
    }
    idx = out;
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

/** Bambu/Prusa TriangleSelector, unverteiltes Blatt: Zustand s = Filament s. */
export const paintCode = (s) => (s === 1 ? '4' : s === 2 ? '8' : `${(s - 3).toString(16).toUpperCase()}C`);

/** Verfeinert die Top-Fläche und liefert je Dreieck den paint_color-Code (oder undefined).
 *  stem: [x, y] (Mesh -> Welt), map: Farbkarte, capSlot: Slot der Taste, nSlots: Obergrenze. -> {mesh: {pos, idx}, paint: Array} */
export function paintCap(cap, stem, map, capSlot, nSlots = 8) {
  const mesh = refineTop(cap);
  const { pos, idx } = mesh, paint = new Array(idx.length / 3);
  for (let t = 0; t < paint.length; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (normalZ(pos, a, b, c) <= TOP_NZ) continue;
    const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3 + stem[0], y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3 + stem[1];
    const s = sample(map, x, y);
    if (s !== 0 && s !== capSlot && s <= nSlots) paint[t] = paintCode(s);
  }
  return { mesh, paint };
}
