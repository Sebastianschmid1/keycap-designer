// Dekodierung von web/data (Format: siehe keycaps/webdata.py).
const pad4 = (n) => n + ((4 - (n % 4)) % 4);

// Typed-Array-Views brauchen 4-Byte-Ausrichtung -> Uint8Array-Views (z. B. Node-Buffer) werden kopiert.
function aligned(buf) {
  return buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** blob: ArrayBuffer | Uint8Array. part: {v, t, off}; bbox: [x0,y0,z0,x1,y1,z1].
 *  -> {pos: Float32Array (3v), idx: Uint16Array|Uint32Array (3t)} */
export function decodePart(blob, part, bbox) {
  const ab = aligned(blob);
  const q = new Uint16Array(ab, part.off, part.v * 3);
  const idx = part.v <= 65535 ? new Uint16Array(ab, part.off + pad4(part.v * 6), part.t * 3)
    : new Uint32Array(ab, part.off + pad4(part.v * 6), part.t * 3);
  const pos = new Float32Array(part.v * 3);
  const s = [0, 1, 2].map((a) => (bbox[a + 3] - bbox[a]) / 65535);
  for (let i = 0; i < pos.length; i++) pos[i] = bbox[i % 3] + q[i] * s[i % 3];
  return { pos, idx };
}

/** Dekodiert beide Teile eines Meshes aus index.meshes -> {cap, legend|null, bbox}. */
export function decodeMesh(blob, entry) {
  const ab = aligned(blob);
  return {
    cap: decodePart(ab, entry.cap, entry.bbox),
    legend: entry.legend ? decodePart(ab, entry.legend, entry.bbox) : null,
    bbox: entry.bbox,
  };
}
