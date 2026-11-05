// Bild -> Slot-Indizes. Palette: [[r, g, b], ...] (Slot i+1 = Eintrag i). Alpha < 128 = nicht malen (Ergebnis 0).
const W = [0.3, 0.59, 0.11]; // gewichtete RGB-Distanz (Luma-Gewichte)

export function nearestSlot(rgb, palette) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = W[0] * (rgb[0] - palette[i][0]) ** 2 + W[1] * (rgb[1] - palette[i][1]) ** 2 + W[2] * (rgb[2] - palette[i][2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best + 1;
}

/** img: {data: RGBA-Bytes, width, height}. -> Uint8Array width*height (0 = transparent, sonst Slot). Floyd-Steinberg optional. */
export function quantizeImage(img, palette, dither) {
  const { data, width: w, height: h } = img, out = new Uint8Array(w * h);
  const buf = dither ? Float32Array.from(data) : data;
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (data[o + 3] < 128) continue;
      for (let c = 0; c < 3; c++) px[c] = Math.min(255, Math.max(0, buf[o + c]));
      const s = nearestSlot(px, palette);
      out[y * w + x] = s;
      if (!dither) continue;
      const diffuse = (dx, dy, f) => {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h || data[(yy * w + xx) * 4 + 3] < 128) return;
        for (let c = 0; c < 3; c++) buf[(yy * w + xx) * 4 + c] += (px[c] - palette[s - 1][c]) * f;
      };
      diffuse(1, 0, 7 / 16); diffuse(-1, 1, 3 / 16); diffuse(0, 1, 5 / 16); diffuse(1, 1, 1 / 16);
    }
  }
  return out;
}

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
