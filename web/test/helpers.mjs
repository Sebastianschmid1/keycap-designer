import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMesh } from '../lib/mesh.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8'));
export const blob = readFileSync(join(dataDir, 'meshes.bin'));
const cache = new Map();
export const getMesh = (i) => {
  if (!cache.has(i)) cache.set(i, decodeMesh(blob, index.meshes[i]));
  return cache.get(i);
};

/** Kantenprüfung: jede ungerichtete Kante genau 2 Dreiecke, gegenläufig orientiert -> true, sonst Fehlertext. */
export function edgeProblems(idx) {
  const dir = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = `${idx[t + e]}>${idx[t + (e + 1) % 3]}`;
      dir.set(k, (dir.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of dir) {
    const [a, b] = k.split('>');
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return `Kante ${k}: ${n}x, Gegenkante ${dir.get(`${b}>${a}`) || 0}x`;
  }
  return null;
}

export function area(pos, idx) {
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}
