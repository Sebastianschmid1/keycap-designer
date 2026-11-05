// Farbkarte je Layout: Uint8Array W x H, RES mm/px über die Layout-bbox [xmin, ymin, xmax, ymax] (y nach oben).
// Wert 0 = unbemalt (-> capSlot der Taste), 1..8 = Slot. Pixel (px, py): px = floor((x - xmin)/RES), py = floor((ymax - y)/RES).
// Rechtecke ("rect") sind Weltkoordinaten in mm: [x0, y0, x1, y1] mit y0 < y1.
export const RES = 0.25;
export const U = 19.05;

export function createMap(bbox, res = RES) {
  const w = Math.ceil((bbox[2] - bbox[0]) / res), h = Math.ceil((bbox[3] - bbox[1]) / res);
  return { res, xmin: bbox[0], ymax: bbox[3], w, h, data: new Uint8Array(w * h) };
}

/** Footprint einer Taste (u-Geometrie, y nach unten) als Weltrechtecke in mm. */
export function keyRects(k, u = U) {
  const r = k.shape === 'iso' ? [[k.x - 0.25, k.y, 1.5, 1], [k.x, k.y + 1, 1.25, 1]] : [[k.x, k.y, k.w, k.h]];
  return r.map(([x, y, w, h]) => [x * u, -(y + h) * u, (x + w) * u, -y * u]);
}

export const sample = (m, x, y) => {
  const px = Math.floor((x - m.xmin) / m.res), py = Math.floor((m.ymax - y) / m.res);
  return px < 0 || py < 0 || px >= m.w || py >= m.h ? 0 : m.data[py * m.w + px];
};

const inRects = (rects, x, y) => rects.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3]);
const clampBox = (m, a) => [Math.max(0, a[0]), Math.max(0, a[1]), Math.min(m.w - 1, a[2]), Math.min(m.h - 1, a[3])];

/** Schreibt val in alle Pixel, deren Mitte in [x0,y0,x1,y1] (Welt) und - falls clip - in einem Clip-Rechteck liegt.
 *  -> geänderter Pixelbereich [px0, py0, px1, py1] (inklusive) oder null. */
function fillWhere(m, box, val, test, clip) {
  const [px0, py0, px1, py1] = clampBox(m, [
    Math.floor((box[0] - m.xmin) / m.res), Math.floor((m.ymax - box[3]) / m.res),
    Math.floor((box[2] - m.xmin) / m.res), Math.floor((m.ymax - box[1]) / m.res)]);
  if (px1 < px0 || py1 < py0) return null;
  for (let py = py0; py <= py1; py++) {
    const y = m.ymax - (py + 0.5) * m.res;
    for (let px = px0; px <= px1; px++) {
      const x = m.xmin + (px + 0.5) * m.res;
      if (test(x, y) && (!clip || inRects(clip, x, y))) m.data[py * m.w + px] = val;
    }
  }
  return [px0, py0, px1, py1];
}

export const stampCircle = (m, cx, cy, r, val, clip) =>
  fillWhere(m, [cx - r, cy - r, cx + r, cy + r], val, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, clip);

export const fillRect = (m, rect, val) => fillWhere(m, rect, val, (x, y) => x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3]);

export const mergeBox = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

/** Linie zwischen zwei Punkten = dicht aneinandergereihte Kreisstempel. */
export function stampLine(m, x0, y0, x1, y1, r, val, clip) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(m.res, r / 2)));
  let box = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    box = mergeBox(box, stampCircle(m, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, val, clip));
  }
  return box;
}

/** Hat der Footprint bemalte Pixel, die sich vom capSlot unterscheiden? (nur dann wird exportseitig verfeinert) */
export function hasPaint(m, rects, capSlot) {
  for (const r of rects) {
    const px0 = Math.max(0, Math.floor((r[0] - m.xmin) / m.res)), px1 = Math.min(m.w - 1, Math.floor((r[2] - m.xmin) / m.res));
    const py0 = Math.max(0, Math.floor((m.ymax - r[3]) / m.res)), py1 = Math.min(m.h - 1, Math.floor((m.ymax - r[1]) / m.res));
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const v = m.data[py * m.w + px];
        if (v !== 0 && v !== capSlot) return true;
      }
    }
  }
  return false;
}

/** Schreibt einen Pixelblock (values: Uint8Array w*h, 0 = nicht schreiben) mit linker oberer Ecke (px0, py0);
 *  clip: optionale Weltrechtecke. -> geänderter Bereich oder null. */
export function writeBlock(m, px0, py0, w, h, values, clip) {
  let box = null;
  for (let j = 0; j < h; j++) {
    const py = py0 + j;
    if (py < 0 || py >= m.h) continue;
    const y = m.ymax - (py + 0.5) * m.res;
    for (let i = 0; i < w; i++) {
      const px = px0 + i, v = values[j * w + i];
      if (!v || px < 0 || px >= m.w) continue;
      if (clip && !inRects(clip, m.xmin + (px + 0.5) * m.res, y)) continue;
      m.data[py * m.w + px] = v;
      box = mergeBox(box, [px, py, px, py]);
    }
  }
  return box;
}

/** Pixelbereich eines Weltrechtecks -> [px0, py0, w, h]. */
export function pixelRect(m, r) {
  const px0 = Math.floor((r[0] - m.xmin) / m.res), py0 = Math.floor((m.ymax - r[3]) / m.res);
  return [px0, py0, Math.max(1, Math.ceil((r[2] - m.xmin) / m.res) - px0), Math.max(1, Math.ceil((r[3] - r[1]) / m.res))];
}

// ---- Serialisierung: Lauflängen (Wert, Anzahl als Varint), base64
export function encodeData(data) {
  const out = [];
  for (let i = 0; i < data.length;) {
    let j = i;
    while (j < data.length && data[j] === data[i]) j++;
    out.push(data[i]);
    for (let n = j - i; ; n >>= 7) { out.push((n & 127) | (n > 127 ? 128 : 0)); if (n <= 127) break; }
    i = j;
  }
  let s = '';
  for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.slice(i, i + 8192));
  return btoa(s);
}

export function decodeData(b64, len) {
  const s = atob(b64), data = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < s.length;) {
    const v = s.charCodeAt(i++);
    let n = 0, sh = 0, c;
    do { c = s.charCodeAt(i++); n |= (c & 127) << sh; sh += 7; } while (c & 128);
    if (o + n > len) throw new Error('Farbkarte: Daten länger als erwartet');
    data.fill(v, o, o + n);
    o += n;
  }
  if (o !== len) throw new Error('Farbkarte: Daten kürzer als erwartet');
  return data;
}
