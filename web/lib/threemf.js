// Port von keycaps/print3mf.py::write_plate – aber je Taste eigene Mesh-Objekte (kein Mesh-Sharing), damit
// Part-Extruder je Taste verschieden sein dürfen und 4b je Taste eigene Dreiecke (paint_color) bekommt.
import { zipSync, strToU8 } from '../vendor/fflate.js';
import { pack } from './pack.js';

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MODEL_REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const XML = "<?xml version='1.0' encoding='utf-8'?>\n";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function meshObject(id, name, m, paint) {
  const out = [`<object id="${id}" type="model" name="${esc(name)}"><mesh><vertices>`];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) {
    out.push(`<vertex x="${p[i].toFixed(6)}" y="${p[i + 1].toFixed(6)}" z="${p[i + 2].toFixed(6)}"/>`);
  }
  out.push('</vertices><triangles>');
  const t = m.idx;
  for (let i = 0; i < t.length; i += 3) {
    const pc = paint && paint[i / 3];
    out.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"${pc ? ` paint_color="${pc}"` : ''}/>`);
  }
  out.push('</triangles></mesh></object>');
  return out.join('');
}

/** items: [{id, mesh: {cap, legend|null, bbox}, capSlot, legendSlot, pos: [px, py], capPaint?: Array}] -> ZIP-Bytes einer Platte.
 *  capPaint: je Cap-Dreieck paint_color-Code oder undefined. pos = linke untere Ecke des Footprints (mm). Cap-Part extruder = capSlot, Legend-Part = legendSlot. */
export function plateBytes(items) {
  const res = [], build = [], cfg = [];
  let next = 1;
  for (const it of items) {
    const { id, mesh } = it;
    const parts = [['cap', mesh.cap, it.capSlot, it.capPaint]];
    if (mesh.legend) parts.push(['legend', mesh.legend, it.legendSlot]);
    const ids = [];
    for (const [kind, m, , paint] of parts) {
      res.push(meshObject(next, `${id}_${kind}`, m, paint));
      ids.push(next++);
    }
    const wid = next++;
    res.push(`<object id="${wid}" type="model" name="${esc(id)}"><components>`
      + ids.map((c) => `<component objectid="${c}"/>`).join('') + '</components></object>');
    cfg.push(`<object id="${wid}"><metadata key="name" value="${esc(id)}"/>`
      + parts.map(([kind, , slot], i) => `<part id="${ids[i]}" subtype="normal_part"><metadata key="name" value="${esc(id)}_${kind}"/>`
        + `<metadata key="extruder" value="${slot}"/></part>`).join('') + '</object>');
    const dx = it.pos[0] - mesh.bbox[0], dy = it.pos[1] - mesh.bbox[1];
    build.push(`<item objectid="${wid}" partnumber="${esc(id)}" transform="1 0 0 0 1 0 0 0 1 ${dx.toFixed(6)} ${dy.toFixed(6)} 0"/>`);
  }
  const model = `${XML}<model xmlns="${CORE}" unit="millimeter"><resources>${res.join('')}</resources><build>${build.join('')}</build></model>`;
  const types = `${XML}<Types xmlns="${CONTENT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = `${XML}<Relationships xmlns="${REL}"><Relationship Id="rel0" Type="${MODEL_REL}" Target="/3D/3dmodel.model"/></Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(`${XML}<config>${cfg.join('')}</config>`),
  });
}

/** layout: index.layouts[name]; getMesh(i) -> dekodiertes Mesh; assign(key) -> {cap, legend} (1-basierte Slots).
 *  painter(k, mesh, capSlot) -> {mesh: {pos, idx}, paint} | null: verfeinertes Cap-Mesh mit paint_color (4b).
 *  -> Liste von Uint8Array, eine je Platte. */
export function buildPlates(layout, getMesh, assign, painter) {
  const meshes = layout.keys.map((k) => getMesh(k.mesh));
  const sizes = meshes.map((m) => [m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1]]);
  const { plateOf, pos } = pack(sizes);
  const plates = [];
  for (let n = 0; n <= Math.max(...plateOf); n++) {
    const items = [];
    layout.keys.forEach((k, i) => {
      if (plateOf[i] !== n) return;
      const a = assign(k);
      const p = painter && painter(k, meshes[i], a.cap);
      items.push({ id: k.id, mesh: p ? { ...meshes[i], cap: p.mesh } : meshes[i], capPaint: p && p.paint, capSlot: a.cap, legendSlot: a.legend, pos: pos[i] });
    });
    plates.push(plateBytes(items));
  }
  return plates;
}
