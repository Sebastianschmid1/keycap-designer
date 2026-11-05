// 1:1-Port von keycaps/print3mf.py::pack (gleiche Konstanten, gleiche Reihenfolge).
export const X_MIN = 23.5, X_MAX = 253.0, Y_MIN = 3.0, Y_MAX = 253.0, GAP = 3.0;

/** sizes: [[w, h], ...] -> {plateOf: [..], pos: [[x, y], ..]} (linke untere Ecke des Footprints). */
export function pack(sizes) {
  const order = sizes.map((_, i) => i).sort((a, b) => (sizes[b][1] - sizes[a][1]) || (sizes[b][0] - sizes[a][0]) || (a - b));
  const plateOf = new Array(sizes.length).fill(0), pos = new Array(sizes.length).fill(null);
  let plate = 0, x = X_MIN, y = Y_MIN, shelfH = 0;
  for (const i of order) {
    const [w, h] = sizes[i];
    if (w > X_MAX - X_MIN || h > Y_MAX - Y_MIN) throw new Error(`Taste ${w.toFixed(1)} x ${h.toFixed(1)} mm passt nicht auf das Bett`);
    if (x + w > X_MAX + 1e-9) { x = X_MIN; y = y + shelfH + GAP; shelfH = 0; }
    if (y + h > Y_MAX + 1e-9) { plate += 1; x = X_MIN; y = Y_MIN; shelfH = 0; }
    plateOf[i] = plate; pos[i] = [x, y];
    x += w + GAP;
    shelfH = Math.max(shelfH, h);
  }
  return { plateOf, pos };
}
