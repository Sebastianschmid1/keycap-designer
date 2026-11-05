import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { decodeMesh } from './lib/mesh.js';
import { createMap, keyRects, stampCircle, stampLine, fillRect, writeBlock, pixelRect, mergeBox } from './lib/paintmap.js';
import { PATTERNS, applyPattern } from './lib/patterns.js';
import { quantizeImage, hexToRgb } from './lib/quantize.js';
import { serializeProject, parseProject, exportPlates } from './lib/project.js';

const U = 19.05;
const DEFAULT_COLORS = ['#d9d9d9', '#1a1a1a', '#d62828', '#1d4ed8', '#2a9d3f', '#f4c20d', '#8a4fff', '#ff7f11'];
const LANG_LABEL = { de: 'DE (ISO)', en: 'UK (ISO)', us: 'US (ANSI)' };
const FORM_LABEL = { full: '100 %', tkl: 'TKL', 75: '75 %', 60: '60 %' };
const $ = (id) => document.getElementById(id);

// ---- Zustand: Slots (Farbe je Filament) und je Taste capSlot / legendSlot (1-basiert = Bambu-Extruder).
// Dazu je Layout eine Farbkarte (Slot-Indizes je 0,25 mm, lib/paintmap.js): Wert 0 = capSlot der Taste. Die Cap-Fläche
// liest die Karte nur auf Top-Flächen (Normale z > 0,5 = dieselbe Regel wie lib/refine.js beim Export).
const state = {
  slots: DEFAULT_COLORS.slice(0, 4).map((color) => ({ color })),
  layout: null,
  assign: {},          // layoutName -> Map(keyId -> {capSlot, legendSlot})
  maps: {},            // layoutName -> Farbkarte
  selected: new Set(),
  tool: 'select',      // select | paint
  brush: { slot: 1, size: 3, erase: false },
  history: [],         // Snapshots {layout, assign, data} des aktuellen Layouts
};
const HISTORY_MAX = 50;

let index, blob;
const geoms = new Map();       // Mesh-Index -> {cap, legend, bbox, zmax}
const materials = [];          // Slot-Index (0-basiert) -> Material
const keyViews = new Map();    // keyId -> {key, proxies: [Mesh], marks: [LineSegments], cap, legend}

// ---- three.js
const canvas = $('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d21);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-150, -250, 400);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(35, 1, 5, 4000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
let root = null;
let dirty = true;
const render = () => { dirty = true; };
controls.addEventListener('change', render);

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
  render();
}
new ResizeObserver(resize).observe(canvas);
(function loop() {
  requestAnimationFrame(loop);
  if (dirty) { dirty = false; renderer.render(scene, camera); }
})();

// ---- Material
function slotMaterial(slot) {
  const i = slot - 1;
  if (!materials[i]) {
    materials[i] = new THREE.MeshStandardMaterial({ color: state.slots[i].color, roughness: 0.55, metalness: 0, flatShading: true });
  }
  return materials[i];
}

// Cap-Material: Grundfarbe = capSlot der Taste; auf Top-Flächen überschreibt der Kartenwert (Slot-Farbe aus uPal).
const capMats = [];
const palUniform = { value: Array.from({ length: 9 }, () => new THREE.Vector3()) };
const mapTexUniform = { value: null };
const mapInfoUniform = { value: new THREE.Vector4() };   // xmin, ymax, Breite mm, Höhe mm
function syncPalette() {
  state.slots.forEach((s, i) => { const c = new THREE.Color(s.color); palUniform.value[i + 1].set(c.r, c.g, c.b); });
}
function capMaterial(a) {
  const i = a.capSlot - 1;
  if (!capMats[i]) {
    const m = new THREE.MeshStandardMaterial({ color: state.slots[i].color, roughness: 0.55, metalness: 0, flatShading: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uMap = mapTexUniform; sh.uniforms.uPal = palUniform; sh.uniforms.uInfo = mapInfoUniform;
      sh.vertexShader = `varying vec3 vWP;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;')}`;
      sh.fragmentShader = `varying vec3 vWP;\nuniform sampler2D uMap;\nuniform vec3 uPal[9];\nuniform vec4 uInfo;\n${sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (normalize(cross(dFdx(vWP), dFdy(vWP))).z > 0.5) {
          vec2 uv = vec2((vWP.x - uInfo.x) / uInfo.z, (uInfo.y - vWP.y) / uInfo.w);
          int s = int(texture2D(uMap, uv).r * 255.0 + 0.5);
          if (s > 0 && s < 9 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) diffuseColor.rgb = uPal[s];
        }`)}`;
    };
    m.customProgramCacheKey = () => 'capmap';
    capMats[i] = m;
  }
  return capMats[i];
}
const legendMaterial = (a) => slotMaterial(a.legendSlot);

// ---- Farbkarte als Textur (R8). Pinselstriche laden nur den geänderten Pixelbereich nach.
const texOf = new WeakMap();
const mapOf = () => state.maps[state.layout];
function mapTexture(map) {
  let t = texOf.get(map);
  if (!t) {
    t = new THREE.DataTexture(map.data, map.w, map.h, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    renderer.initTexture(t);
    texOf.set(map, t);
  }
  return t;
}
/** box: [px0, py0, px1, py1] (inklusive) oder null = ganze Karte. */
function refreshMap(box) {
  const map = mapOf(), tex = mapTexture(map);
  if (box) {
    try {
      const w = box[2] - box[0] + 1, h = box[3] - box[1] + 1, sub = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) sub.set(map.data.subarray((box[1] + j) * map.w + box[0], (box[1] + j) * map.w + box[0] + w), j * w);
      const src = new THREE.DataTexture(sub, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      src.unpackAlignment = 1;
      src.needsUpdate = true;
      renderer.copyTextureToTexture(src, tex, new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(w, h)), new THREE.Vector2(box[0], box[1]));
      src.dispose();
    } catch (err) { console.warn('Teil-Upload fehlgeschlagen, lade ganze Karte', err); tex.needsUpdate = true; }
  } else tex.needsUpdate = true;
  render();
}
function bindMap() {
  const map = mapOf();
  mapTexUniform.value = mapTexture(map);
  mapInfoUniform.value.set(map.xmin, map.ymax, map.w * map.res, map.h * map.res);
}

function geomOf(i) {
  if (!geoms.has(i)) {
    const m = decodeMesh(blob, index.meshes[i]);
    const mk = (p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
      g.setIndex(new THREE.BufferAttribute(p.idx, 1));
      return g;
    };
    geoms.set(i, { cap: mk(m.cap), legend: m.legend ? mk(m.legend) : null, bbox: m.bbox });
  }
  return geoms.get(i);
}

const rectsOf = (k) => (k.shape === 'iso'
  ? [[k.x - 0.25, k.y, 1.5, 1], [k.x, k.y + 1, 1.25, 1]] : [[k.x, k.y, k.w, k.h]]);
const footprint = (k) => keyRects(k, U);

const markMaterial = new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false });
const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });

function assignOf(id) { return state.assign[state.layout].get(id); }

function showLayout(name) {
  state.layout = name;
  state.selected.clear();
  if (!state.assign[name]) {
    state.assign[name] = new Map(index.layouts[name].keys.map((k) => [k.id, { capSlot: 1, legendSlot: 2 }]));
  }
  if (!state.maps[name]) state.maps[name] = createMap(index.layouts[name].bbox);
  state.history = [];
  bindMap();
  if (root) scene.remove(root);
  root = new THREE.Group();
  keyViews.clear();
  const L = index.layouts[name];
  for (const k of L.keys) {
    const g = geomOf(k.mesh);
    const a = assignOf(k.id);
    const view = { key: k, proxies: [], marks: [] };
    const cap = new THREE.Mesh(g.cap, capMaterial(a));
    cap.position.set(k.stem[0], k.stem[1], 0);
    cap.userData.keyId = k.id;
    root.add(cap);
    view.cap = cap;
    if (g.legend) {
      view.legend = new THREE.Mesh(g.legend, legendMaterial(a));
      view.legend.position.copy(cap.position);
      root.add(view.legend);
    }
    const zmax = g.bbox[5];
    for (const [rx, ry, rw, rh] of rectsOf(k)) {
      const box = new THREE.BoxGeometry(rw * U, rh * U, zmax);
      const proxy = new THREE.Mesh(box, proxyMaterial);
      proxy.position.set((rx + rw / 2) * U, -(ry + rh / 2) * U, zmax / 2);
      proxy.userData.keyId = k.id;
      root.add(proxy);
      view.proxies.push(proxy);
      const mark = new THREE.LineSegments(new THREE.EdgesGeometry(box), markMaterial);
      mark.position.copy(proxy.position);
      mark.visible = false;
      mark.renderOrder = 10;
      root.add(mark);
      view.marks.push(mark);
    }
    keyViews.set(k.id, view);
  }
  scene.add(root);
  const [x0, y0, x1, y1] = L.bbox;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
  // Abstand so, dass das Layout die Fläche füllt (Breite gegen horizontales, Höhe gegen vertikales Sichtfeld; Kippung ~57°).
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = Math.max((w / 2) / (tanV * camera.aspect), (h * 0.9 / 2) / tanV) * 1.06 + 15;
  controls.target.set(cx, cy, 0);
  camera.position.set(cx, cy - d * 0.55, d * 0.83);
  controls.update();
  updateSelectionUi();
  updateUndoUi();
  render();
}

function refreshMaterials() {
  for (const v of keyViews.values()) {
    const a = assignOf(v.key.id);
    v.cap.material = capMaterial(a);
    if (v.legend) v.legend.material = legendMaterial(a);
  }
  render();
}

// ---- Zeigerereignisse: Auswahl per Klick (Werkzeug "Auswählen") bzw. Pinselstrich (Werkzeug "Malen")
const raycaster = new THREE.Raycaster();
let down = null;
let stroke = null;
const ndc = (e) => {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};

/** Erster Treffer auf einer Top-Fläche eines Caps -> {id, x, y} (Welt) oder null. */
function pickTop(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const hit = raycaster.intersectObjects([...keyViews.values()].map((v) => v.cap), false)[0];
  if (!hit || !hit.face || hit.face.normal.z <= 0.5) return null;
  return { id: hit.object.userData.keyId, x: hit.point.x, y: hit.point.y };
}

function paintAt(e) {
  const p = pickTop(e);
  if (!p) { stroke.last = null; return; }
  const map = mapOf(), clip = footprint(keyViews.get(p.id).key);
  const r = state.brush.size / 2, val = state.brush.erase ? 0 : state.brush.slot;
  const l = stroke.last;
  const box = l && l.id === p.id ? stampLine(map, l.x, l.y, p.x, p.y, r, val, clip) : stampCircle(map, p.x, p.y, r, val, clip);
  stroke.last = p;
  if (box) refreshMap(box);
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.tool === 'paint' && e.button === 0) {
    pushHistory();
    stroke = { last: null };
    canvas.setPointerCapture(e.pointerId);
    paintAt(e);
    return;
  }
  down = [e.clientX, e.clientY];
});
canvas.addEventListener('pointermove', (e) => { if (stroke) paintAt(e); });
canvas.addEventListener('pointerup', (e) => {
  if (stroke) { stroke = null; return; }
  if (state.tool !== 'select' || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  raycaster.setFromCamera(ndc(e), camera);
  const hits = raycaster.intersectObjects([...keyViews.values()].flatMap((v) => v.proxies), false);
  const id = hits.length ? hits[0].object.userData.keyId : null;
  if (!e.shiftKey) state.selected.clear();
  if (id) {
    if (e.shiftKey && state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
  }
  updateSelectionUi();
});

function updateSelectionUi() {
  for (const [id, v] of keyViews) for (const m of v.marks) m.visible = state.selected.has(id);
  const n = state.selected.size;
  const names = [...state.selected].slice(0, 4).join(', ');
  $('selInfo').textContent = n ? `(${n}: ${names}${n > 4 ? ', …' : ''})` : '(keine)';
  render();
}

function select(pred) {
  state.selected = new Set(index.layouts[state.layout].keys.filter(pred).map((k) => k.id));
  updateSelectionUi();
}
$('selAll').onclick = () => select(() => true);
$('selNone').onclick = () => select(() => false);

// ---- Slots
function buildSlotUi() {
  const n = state.slots.length;
  $('slots').replaceChildren(...state.slots.map((s, i) => {
    const row = document.createElement('div');
    row.className = 'slot';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = s.color;
    inp.oninput = () => {
      s.color = inp.value;
      if (materials[i]) materials[i].color.set(s.color);
      if (capMats[i]) capMats[i].color.set(s.color);
      syncPalette();
      paintSwatches();
      render();
    };
    const lab = document.createElement('span');
    lab.textContent = `Slot ${i + 1}`;
    row.append(inp, lab);
    return row;
  }));
  for (const box of document.querySelectorAll('.swatches')) {
    box.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const b = document.createElement('button');
      b.textContent = i + 1;
      b.title = `Slot ${i + 1}`;
      b.onclick = () => {
        const pick = box.parentElement.dataset;
        const keys = pick.target === 'all' ? [...keyViews.keys()] : [...state.selected];
        if (!keys.length) return;
        pushHistory();
        for (const id of keys) assignOf(id)[pick.part === 'cap' ? 'capSlot' : 'legendSlot'] = i + 1;
        // "Cap-Slot setzen" überschreibt die Bemalung der Taste: Karte im Footprint leeren
        if (pick.part === 'cap') {
          if (pick.target === 'all') mapOf().data.fill(0);
          else for (const id of keys) for (const r of footprint(keyViews.get(id).key)) fillRect(mapOf(), r, 0);
          refreshMap(null);
        }
        refreshMaterials();
      };
      return b;
    }));
  }
  const ps = $('paintSlots');
  ps.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.textContent = i + 1;
    b.title = `Pinsel: Slot ${i + 1}`;
    b.onclick = () => { state.brush.slot = i + 1; state.brush.erase = false; updateToolUi(); };
    return b;
  }));
  syncPalette();
  paintSwatches();
  updateToolUi();
}

function paintSwatches() {
  for (const box of document.querySelectorAll('.swatches, #paintSlots')) {
    [...box.children].forEach((b, i) => {
      const c = new THREE.Color(state.slots[i].color);
      b.style.background = state.slots[i].color;
      b.style.color = c.getHSL({}).l > 0.55 ? '#111' : '#fff';
      b.style.textShadow = 'none';
    });
  }
}

function setSlotCount(n) {
  while (state.slots.length < n) state.slots.push({ color: DEFAULT_COLORS[state.slots.length] });
  state.slots.length = n;
  materials.length = Math.min(materials.length, n);
  capMats.length = Math.min(capMats.length, n);
  state.brush.slot = Math.min(state.brush.slot, n);
  for (const m of Object.values(state.maps)) { for (let i = 0; i < m.data.length; i++) if (m.data[i] > n) m.data[i] = 0; }
  for (const map of Object.values(state.assign)) {
    for (const a of map.values()) {
      if (a.capSlot > n) a.capSlot = 1;
      if (a.legendSlot > n) a.legendSlot = 2;
    }
  }
  state.history = [];
  buildSlotUi();
  if (root) { refreshMap(null); refreshMaterials(); updateUndoUi(); }
}

// ---- Werkzeug-UI
function setTool(tool) {
  state.tool = tool;
  // Malen: linke Maustaste malt, rechts dreht, Mitte schiebt
  controls.mouseButtons = tool === 'paint'
    ? { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  canvas.style.cursor = tool === 'paint' ? 'crosshair' : '';
  updateToolUi();
}
function updateToolUi() {
  $('toolSelect').classList.toggle('active', state.tool === 'select');
  $('toolPaint').classList.toggle('active', state.tool === 'paint');
  $('paintOpts').hidden = state.tool !== 'paint';
  $('erase').classList.toggle('active', state.brush.erase);
  [...$('paintSlots').children].forEach((b, i) => b.classList.toggle('active', !state.brush.erase && state.brush.slot === i + 1));
  $('brushVal').textContent = `${state.brush.size} mm`;
}
$('toolSelect').onclick = () => setTool('select');
$('toolPaint').onclick = () => setTool('paint');
$('erase').onclick = () => { state.brush.erase = !state.brush.erase; updateToolUi(); };
$('brushSize').oninput = () => { state.brush.size = Number($('brushSize').value); updateToolUi(); };

// ---- Rückgängig: Snapshots von Karte + Zuordnung des aktuellen Layouts
function pushHistory() {
  state.history.push({
    layout: state.layout,
    assign: [...state.assign[state.layout]].map(([id, a]) => [id, a.capSlot, a.legendSlot]),
    data: mapOf().data.slice(),
  });
  if (state.history.length > HISTORY_MAX) state.history.shift();
  updateUndoUi();
}
function undo() {
  const s = state.history.pop();
  if (!s || s.layout !== state.layout) return;
  for (const [id, cap, legend] of s.assign) Object.assign(assignOf(id), { capSlot: cap, legendSlot: legend });
  mapOf().data.set(s.data);
  refreshMap(null);
  refreshMaterials();
  updateUndoUi();
}
function updateUndoUi() {
  $('undo').disabled = !state.history.length;
  $('undo').title = `Rückgängig (Strg+Z), ${state.history.length} Schritt(e)`;
}
$('undo').onclick = undo;
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});

const say = (msg) => { $('status').textContent = msg; };

// ---- Muster
function buildPatternUi() {
  $('patterns').replaceChildren(...PATTERNS.map((p, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${p.name}`;
    b.onclick = () => {
      pushHistory();
      applyPattern(i, { layout: index.layouts[state.layout], nSlots: state.slots.length, map: mapOf(), assign: state.assign[state.layout] });
      refreshMap(null);
      refreshMaterials();
      say(`Muster „${p.name}“ angewendet.`);
    };
    return b;
  }));
}

// ---- Bild
let image = null;
$('imageFile').onchange = async () => {
  const f = $('imageFile').files[0];
  image = null;
  if (!f) return;
  try {
    image = await createImageBitmap(f);
    say(`Bild geladen: ${image.width} × ${image.height} px.`);
  } catch (err) { console.error(err); say(`Bild nicht lesbar: ${err.message}`); }
};
const imgCanvas = document.createElement('canvas');
function paintImage(map, rect, clip, fill, dither) {
  const [px0, py0, w, h] = pixelRect(map, rect);
  imgCanvas.width = w; imgCanvas.height = h;
  const ctx = imgCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  const s = (fill ? Math.max : Math.min)(w / image.width, h / image.height);
  ctx.drawImage(image, (w - image.width * s) / 2, (h - image.height * s) / 2, image.width * s, image.height * s);
  const q = quantizeImage(ctx.getImageData(0, 0, w, h), state.slots.map((s2) => hexToRgb(s2.color)), dither);
  return writeBlock(map, px0, py0, w, h, q, clip);
}
const unionRect = (rects) => rects.reduce((u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
$('applyImage').onclick = () => {
  if (!image) return say('Erst ein Bild wählen.');
  const target = $('imageTarget').value, fill = $('imageFit').value === 'fill', dither = $('imageDither').checked;
  const map = mapOf();
  const keys = [...state.selected].map((id) => keyViews.get(id).key);
  if (target !== 'all' && !keys.length) return say('Erst Tasten auswählen.');
  pushHistory();
  if (target === 'all') paintImage(map, index.layouts[state.layout].bbox, null, fill, dither);
  else if (target === 'span') { const rs = keys.flatMap(footprint); paintImage(map, unionRect(rs), rs, fill, dither); }
  else for (const k of keys) { const rs = footprint(k); paintImage(map, unionRect(rs), rs, fill, dither); }
  refreshMap(null);
  say('Bild aufgebracht.');
};

// ---- Projekt speichern / laden
const projectNow = () => ({ layout: state.layout, slots: state.slots, assign: state.assign[state.layout], map: mapOf() });
function download(bytes, type, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('saveProject').onclick = () => {
  download(JSON.stringify(serializeProject(projectNow())), 'application/json', `keycaps_${state.layout}.json`);
  say('Projekt gespeichert.');
};
$('loadProject').onclick = () => $('projectFile').click();
$('projectFile').onchange = async () => {
  const f = $('projectFile').files[0];
  $('projectFile').value = '';
  if (!f) return;
  try {
    const p = parseProject(JSON.parse(await f.text()), index);
    state.slots = p.slots;
    materials.length = 0; capMats.length = 0;
    state.assign[p.layout] = p.assign;
    state.maps[p.layout] = p.map;
    $('slotCount').value = p.slots.length;
    state.brush.slot = Math.min(state.brush.slot, p.slots.length);
    buildSlotUi();
    $('layout').value = p.layout;
    showLayout(p.layout);
    say(`Projekt geladen: ${f.name}`);
  } catch (err) { console.error(err); say(`Projekt nicht geladen: ${err.message}`); }
};

// ---- Export (derselbe Pfad wie export_cli.mjs --project)
$('export').onclick = () => {
  say('Exportiere …');
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const name = state.layout;
      const plates = exportPlates(index, (i) => decodeMesh(blob, index.meshes[i]), projectNow());
      plates.forEach((bytes, n) => download(bytes, 'model/3mf', `${name}_plate_${n + 1}.3mf`));
      say(`${plates.length} Platte(n) exportiert (${((performance.now() - t0) / 1000).toFixed(1)} s).`);
    } catch (err) {
      console.error(err);
      say(`Export fehlgeschlagen: ${err.message}`);
    }
  }, 30);
};

// ---- Start
async function init() {
  const [idx, buf] = await Promise.all([
    fetch('data/index.json').then((r) => r.json()),
    fetch('data/meshes.bin').then((r) => r.arrayBuffer()),
  ]);
  index = idx;
  blob = buf;
  const sel = $('layout');
  for (const name of Object.keys(index.layouts)) {
    const [lg, f] = name.split('_');
    sel.append(new Option(`${LANG_LABEL[lg]} · ${FORM_LABEL[f]}`, name));
  }
  sel.onchange = () => showLayout(sel.value);
  const cnt = $('slotCount');
  for (let n = 2; n <= 8; n++) cnt.append(new Option(`${n} Slots`, n));
  cnt.value = state.slots.length;
  cnt.onchange = () => setSlotCount(Number(cnt.value));
  buildSlotUi();
  buildPatternUi();
  const want = new URLSearchParams(location.search).get('layout');
  sel.value = index.layouts[want] ? want : 'de_full';
  resize();
  showLayout(sel.value);
}
init().catch((err) => { console.error(err); $('status').textContent = `Laden fehlgeschlagen: ${err.message}`; });
