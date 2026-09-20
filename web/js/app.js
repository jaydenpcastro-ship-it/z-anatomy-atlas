// Z-Anatomy Atlas: navigation + 3D viewer. Plain ES modules, no build step.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const CFG = Object.assign({ modelBase: 'models/', dataBase: 'data/', imgBase: 'img/' }, window.ATLAS_CONFIG || {});
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

// ------------------------------------------------------------------ config --
const SYS = {
  skeletal: ['Skeletal system', '#E6DCC6', 'skeletal'],
  joints: ['Joints & ligaments', '#9DB7D1', 'skeletal_joints'],
  insertions: ['Muscular insertions', '#F0663A', 'muscles_on_skeleton'],
  muscular: ['Muscular system', '#D0453C', 'muscular'],
  fascia: ['Fascia & body envelope', '#9DB7D1', 'fascia'],
  cardiovascular: ['Cardiovascular system', '#E0453B', 'cardiovascular'],
  lymphoid: ['Lymphoid organs', '#74D6A2', 'lymphoid'],
  nervous: ['Nervous system & sense organs', '#F3D24E', 'nervous'],
  visceral: ['Visceral systems', '#E58A8A', 'visceral'],
  regions: ['Regions of human body', '#E8B7A0', 'regions_head_neck'],
  reference: ['Reference lines & movements', '#8FA3B8', null],
};
const TAGS = [
  ['ALL', 'All body systems'], ['SKELETAL', 'Skeletal'], ['JOINTS', 'Joints'], ['MUSCULAR', 'Muscular'], ['FASCIA', '– Fascia & envelope'],
  ['CARDIOVASCULAR', 'Cardiovascular'], ['LYMPHOID', 'Lymphoid'], ['NERVOUS', 'Nervous (all)'], ['CNS', '– CNS'],
  ['PNS', '– PNS'], ['SENSE', '– Sense organs'], ['VISCERAL', 'Visceral (all)'], ['RESPIRATORY', '– Respiratory'],
  ['DIGESTIVE', '– Digestive'], ['URINARY', '– Urinary'], ['REPRODUCTIVE', '– Reproductive'], ['ENDOCRINE', '– Endocrine'],
  ['INTEGUMENTARY', 'Integumentary (hair)'], ['REGIONS', 'Body regions'], ['REFERENCE', 'Reference & movements'],
];
const JOINTS = [
  ['ALL', 'Any joint type'], ['SYNOVIAL', 'Synovial'], ['FIBROUS', 'Fibrous'], ['CARTILAGINOUS', 'Cartilaginous'],
  ['BALL_AND_SOCKET', 'Ball and socket'], ['HINGE', 'Hinge'], ['PIVOT', 'Pivot'], ['SADDLE', 'Saddle'],
  ['PLANE', 'Plane'], ['CONDYLOID', 'Condyloid'],
];
const JOINT_KINDS = new Set(['SYNOVIAL', 'FIBROUS', 'CARTILAGINOUS']);
const CARTS = [['ALL', 'Any cartilage'], ['HYALINE', 'Hyaline'], ['FIBROCARTILAGE', 'Fibrocartilage'], ['ELASTIC', 'Elastic']];
const NICE = { BALL_AND_SOCKET: 'Ball and socket', HYALINE: 'Hyaline cartilage', FIBROCARTILAGE: 'Fibrocartilage', ELASTIC: 'Elastic cartilage' };
const nice = (s) => NICE[s] || s.charAt(0) + s.slice(1).toLowerCase();
const HIDE_TAGS = new Set(['SKELETAL', 'JOINTS', 'MUSCULAR', 'FASCIA', 'CARDIOVASCULAR', 'LYMPHOID', 'NERVOUS', 'VISCERAL', 'REGIONS', 'REFERENCE']);
const TAG_NAME = { CNS: 'Central nervous system', PNS: 'Peripheral nervous system', SENSE: 'Sense organ', RESPIRATORY: 'Respiratory',
  DIGESTIVE: 'Digestive', URINARY: 'Urinary', REPRODUCTIVE: 'Reproductive', ENDOCRINE: 'Endocrine', INTEGUMENTARY: 'Integumentary' };

// ------------------------------------------------------------------- state --
const S = {
  M: null, i18n: {}, lang: 'en',
  byId: new Map(), groups: new Map(), lmByTarget: new Map(), siblings: new Map(), lmById: new Map(),
  kids: new Map(), // groupId | "root:<sys>" -> { groups: [], items: Map(name -> recs[]) }
  roots: new Map(), // system -> root groups
  sys: new Map(),  // key -> { group, loaded, loading, visible, progress }
  meshes: new Map(), // id -> Mesh[]
  sel: new Set(), cur: null, curLm: null, ghost: false, iso: false, pins: false,
  desc: new Map(),
};
const nameOf = (r) => (S.lang === 'en' ? r.name : (S.i18n[r.name.toLowerCase()]?.[S.lang] || r.name));
const latinOf = (r) => S.i18n[r.name.toLowerCase()]?.la || '';

// ------------------------------------------------------------------ three ---
const canvas = $('#gl');
const stage = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  stage.append(el('p', { style: 'padding:2rem' }, 'WebGL is not available in this browser, so the 3D view cannot start.'));
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.02, 40);
camera.position.set(0, 0.95, 4.2);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.35));
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(-1.5, 2, 3); camera.add(key);
const rim = new THREE.DirectionalLight(0xbcd4ff, 0.7); rim.position.set(2, 1, -2); camera.add(rim);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.87, 0);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
controls.minDistance = 0.05; controls.maxDistance = 12;
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });
const world = new THREE.Group(); scene.add(world);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(resize).observe(stage); resize();
(function loop() {
  requestAnimationFrame(loop);
  if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
})();

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);

// ---------------------------------------------------------------- materials -
const hiCache = new Map(), ghostCache = new Map();
function hiMat(m) {
  if (!hiCache.has(m)) {
    const c = m.clone(); c.emissive = m.color.clone().multiplyScalar(0.7); c.emissiveIntensity = 1; hiCache.set(m, c);
  }
  return hiCache.get(m);
}
function ghostMat(m) {
  if (!ghostCache.has(m)) {
    const c = m.clone(); c.transparent = true; c.opacity = 0.07; c.depthWrite = false; ghostCache.set(m, c);
  }
  return ghostCache.get(m);
}
function restyle() {
  const has = S.sel.size > 0;
  for (const [id, list] of S.meshes) {
    const picked = S.sel.has(id);
    for (const m of list) {
      const base = m.userData.m0;
      m.material = has && picked ? hiMat(base) : (has && S.ghost ? ghostMat(base) : base);
      m.visible = !(has && S.iso) || picked;
    }
  }
  $('#ghostBtn').setAttribute('aria-pressed', S.ghost);
  $('#isoBtn').setAttribute('aria-pressed', S.iso);
  dirty = true;
}

// ------------------------------------------------------------ system loading -
function sysState(k) {
  if (!S.sys.has(k)) {
    const group = new THREE.Group(); group.visible = false; world.add(group);
    S.sys.set(k, { group, loaded: false, loading: null, visible: false, progress: 0 });
  }
  return S.sys.get(k);
}
function setLoading(text, frac) {
  const box = $('#loading');
  box.hidden = text == null;
  if (text != null) { $('span', box).textContent = text; $('.bar i', box).style.width = `${Math.round((frac || 0) * 100)}%`; }
}
async function loadSystem(k) {
  const st = sysState(k);
  if (st.loaded) return;
  if (st.loading) return st.loading;
  const info = S.M.systems.find((s) => s.key === k);
  if (!info) return;
  const total = info.files.reduce((a, f) => a + f.bytes, 0) || 1;
  const got = info.files.map(() => 0);
  st.loading = (async () => {
    setLoading(`Loading ${SYS[k][0]}…`, 0);
    await Promise.all(info.files.map((f, i) => gltfLoader.loadAsync(CFG.modelBase + f.file, (ev) => {
      got[i] = ev.loaded; const frac = got.reduce((a, b) => a + b, 0) / total;
      st.progress = Math.min(frac, 1); setLoading(`Loading ${SYS[k][0]}… ${Math.round(frac * 100)}%`, frac);
      setProg(k, frac);
    }).then((gltf) => { st.group.add(gltf.scene); register(gltf.scene); })));
    st.loaded = true; setLoading(null); setProg(k, 0); restyle();
  })().catch((e) => { console.error(e); setLoading(`Could not load ${SYS[k][0]}`, 0); setTimeout(() => setLoading(null), 3000); st.loading = null; });
  return st.loading;
}
function register(root) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    let p = n; while (p && !p.userData.zid) p = p.parent;
    if (!p) return;
    n.userData.zid = p.userData.zid; n.userData.m0 = n.material;
    if (!S.meshes.has(p.userData.zid)) S.meshes.set(p.userData.zid, []);
    S.meshes.get(p.userData.zid).push(n);
  });
}
async function setSystemVisible(k, on) {
  const st = sysState(k);
  st.visible = on; st.group.visible = on;
  const li = document.querySelector(`.sys[data-key="${k}"]`);
  if (li) { li.classList.toggle('on', on); $('.eye', li).setAttribute('aria-pressed', on); }
  dirty = true; rebuildPins(); saveHash();
  if (on) { await loadSystem(k); restyle(); }
}

// ---------------------------------------------------------------- camera ----
let tween = null;
function flyTo(center, radius, dir) {
  const d = (dir || camera.position.clone().sub(controls.target)).clone().normalize();
  const dist = Math.max(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2, 0.15);
  const to = { p: center.clone().add(d.multiplyScalar(dist)), t: center.clone() };
  const from = { p: camera.position.clone(), t: controls.target.clone() }, t0 = performance.now();
  tween = { from, to, t0, dur: reduce() ? 1 : 600 };
  (function step(now) {
    if (!tween || tween.t0 !== t0) return;
    const k = Math.min((now - t0) / tween.dur, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(from.p, to.p, e); controls.target.lerpVectors(from.t, to.t, e); dirty = true;
    if (k < 1) requestAnimationFrame(step); else tween = null;
  })(t0);
}
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function boundsOf(recs) {
  const b = new THREE.Box3();
  for (const r of recs) { b.expandByPoint(new THREE.Vector3(...r.min)); b.expandByPoint(new THREE.Vector3(...r.max)); }
  return b;
}
function focusRecs(recs, dir) {
  if (!recs.length) return;
  const b = boundsOf(recs), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  flyTo(c, Math.max(r, 0.02), dir);
}
function fitVisible(dir) {
  const recs = S.M.structures.filter((r) => r.system !== 'reference' && S.sys.get(r.system)?.visible);
  if (!recs.length) return flyTo(new THREE.Vector3(0, 0.87, 0), 0.95, dir);
  focusRecs(recs, dir);
}
const VIEWS = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0] };
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.view;
  if (v === 'fit') return S.sel.size ? focusRecs([...S.sel].map((id) => S.byId.get(id))) : fitVisible();
  const dir = new THREE.Vector3(...VIEWS[v]);
  if (S.sel.size) focusRecs([...S.sel].map((id) => S.byId.get(id)), dir);
  else { const c = new THREE.Vector3(0, 0.87, 0); flyTo(c, 0.95, dir); }
}));

// -------------------------------------------------------------- landmarks ---
const pinObj = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
pinObj.renderOrder = 10; pinObj.visible = false; pinObj.frustumCulled = false; scene.add(pinObj);
const flash = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
  new THREE.PointsMaterial({ size: 16, sizeAttenuation: false, color: 0xffb020, depthTest: false, transparent: true }));
flash.renderOrder = 11; flash.visible = false; flash.frustumCulled = false; scene.add(flash);
let pinIds = [];
function rebuildPins() {
  const lms = S.M ? S.M.landmarks.filter((l) => S.sys.get(l.system)?.visible) : [];
  pinIds = lms.map((l) => l.id);
  const pos = new Float32Array(lms.length * 3), col = new Float32Array(lms.length * 3), c = new THREE.Color();
  lms.forEach((l, i) => { pos.set(l.pos, i * 3); c.set(SYS[l.system]?.[1] || '#ffffff'); col.set([c.r, c.g, c.b], i * 3); });
  pinObj.geometry.dispose();
  pinObj.geometry = new THREE.BufferGeometry();
  pinObj.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pinObj.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pinObj.visible = S.pins && lms.length > 0; dirty = true;
}
$('#pinsBtn').addEventListener('click', () => {
  S.pins = !S.pins; $('#pinsBtn').setAttribute('aria-pressed', S.pins); rebuildPins();
});

// ---------------------------------------------------------------- picking ---
const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.012;
const ndc = new THREE.Vector2();
let hoverOk = true, lastHover = 0;
function pickAt(e, forHover) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const t0 = performance.now();
  let lm = null;
  if (pinObj.visible) {
    const ph = ray.intersectObject(pinObj)[0];
    if (ph) lm = S.lmById.get(pinIds[ph.index]);
  }
  const roots = [...S.sys.values()].filter((s) => s.visible && s.loaded).map((s) => s.group);
  const hits = ray.intersectObjects(roots, true).filter((h) => h.object.isMesh && h.object.visible &&
    !(S.sel.size && S.ghost && !S.sel.has(h.object.userData.zid)));
  if (forHover && performance.now() - t0 > 70) hoverOk = false; // raycast too slow on this machine: hover off, click still works
  const rec = hits.length ? S.byId.get(hits[0].object.userData.zid) : null;
  return { rec, lm };
}
const tip = $('#tip');
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons || !hoverOk) { tip.hidden = true; return; }
  const now = performance.now(); if (now - lastHover < 90) return; lastHover = now;
  const { rec, lm } = pickAt(e, true);
  const label = lm ? `${lm.name} (landmark)` : rec ? nameOf(rec) + (rec.side ? ` (${rec.side.toUpperCase()})` : '') : null;
  tip.hidden = !label;
  if (label) { tip.textContent = label; tip.style.left = `${e.clientX - stage.getBoundingClientRect().left}px`; tip.style.top = `${e.clientY - stage.getBoundingClientRect().top}px`; }
  canvas.style.cursor = label ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; $('#hint').classList.add('hide'); });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const { rec, lm } = pickAt(e, false);
  if (lm) { const t = S.byId.get(lm.target); if (t) { selectRec(t, { focus: false }); showLandmark(lm); } }
  else if (rec) selectRec(rec, { focus: false });
  else clearSel();
});

// -------------------------------------------------------------- selection ---
function siblingsOf(rec) { return S.siblings.get(`${rec.system}|${rec.group}|${rec.name}`) || [rec]; }
async function selectRec(rec, { focus = true } = {}) {
  const sib = siblingsOf(rec);
  S.cur = rec; S.curLm = null; S.sel = new Set(sib.map((r) => r.id));
  if (!S.sys.get(rec.system)?.visible) await setSystemVisible(rec.system, true);
  else await loadSystem(rec.system);
  restyle(); showInfo(sib); markTree(); saveHash();
  if (focus) focusRecs(sib);
}
function selectMany(recs) {
  S.cur = null; S.sel = new Set(recs.map((r) => r.id));
  const need = new Set(recs.map((r) => r.system));
  Promise.all([...need].map((k) => (S.sys.get(k)?.visible ? loadSystem(k) : setSystemVisible(k, true)))).then(restyle);
  restyle(); markTree();
  $('#info').replaceChildren(el('div', { className: 'empty' }, el('h2', {}, `${recs.length} structures highlighted`),
    el('p', {}, 'They are highlighted in the 3D view. Enable “Ghost others” to fade the rest.'),
    el('div', { className: 'actions' }, el('button', { className: 'btn primary', onclick: () => focusRecs(recs) }, 'Focus'), el('button', { className: 'btn', onclick: clearSel }, 'Clear'))));
  focusRecs(recs);
}
function clearSel() {
  S.sel = new Set(); S.cur = null; S.curLm = null; flash.visible = false; restyle(); markTree(); saveHash();
  $('#info').replaceChildren(emptyInfo());
}
const emptyInfo = () => $('#info-empty').content.cloneNode(true);
$('#clearBtn').addEventListener('click', clearSel);
$('#ghostBtn').addEventListener('click', () => { S.ghost = !S.ghost; restyle(); });
$('#isoBtn').addEventListener('click', () => { S.iso = !S.iso; restyle(); });

// -------------------------------------------------------------- info panel --
async function descFor(sys) {
  if (!S.desc.has(sys)) S.desc.set(sys, fetch(`${CFG.dataBase}desc/${sys}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return S.desc.get(sys);
}
function fmtDesc(text, title) {
  const box = el('div', { className: 'desc' });
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    let m;
    if ((m = b.match(/^===\s*(.+?)\s*===$/))) box.append(el('h5', {}, m[1]));
    else if ((m = b.match(/^==\s*(.+?)\s*==$/))) box.append(el('h4', {}, m[1]));
    else if (b.toLowerCase() === (title || '').toLowerCase() || /^[A-Z0-9 ,()'’\-/&]+(\s\((MUSCLE|BONE)\))?$/.test(b) && b.length < 70) continue;
    else box.append(el('p', {}, b));
  }
  return box;
}
function crumbs(rec) {
  const chain = []; let g = S.groups.get(rec.group);
  while (g) { chain.unshift(g); g = S.groups.get(g.parent); }
  const root = chain[0] && chain[0].name.toLowerCase().includes((SYS[rec.system]?.[0] || '').split(' ')[0].toLowerCase()) ? 1 : 0;
  return chain.slice(root);
}
async function showInfo(sib) {
  const rec = sib[0], color = SYS[rec.system]?.[1] || '#888';
  const box = el('div', { style: `--dot:${color}` });
  box.append(el('h2', {}, nameOf(rec)));
  if (latinOf(rec) && latinOf(rec).toLowerCase() !== nameOf(rec).toLowerCase()) box.append(el('div', { className: 'latin' }, latinOf(rec)));
  const path = crumbs(rec);
  box.append(el('div', { className: 'crumbs' }, SYS[rec.system]?.[0] || rec.system, ...path.flatMap((g) => [' › ', el('span', {}, S.lang === 'en' ? g.name : (S.i18n[g.name.toLowerCase()]?.[S.lang] || g.name))])));
  const pills = el('div', { className: 'pills' }, el('span', { className: 'pill sys' }, SYS[rec.system]?.[0] || rec.system));
  const sides = sib.map((r) => r.side).filter(Boolean);
  if (sides.length) pills.append(el('span', { className: 'pill' }, sides.length > 1 ? 'Left & right' : (sides[0] === 'l' ? 'Left' : 'Right')));
  for (const t of rec.tags) if (!HIDE_TAGS.has(t)) pills.append(el('span', { className: 'pill' }, TAG_NAME[t] || nice(t)));
  if (rec.joint_kind) pills.append(el('span', { className: 'pill' }, `${nice(rec.joint_kind)} joint`));
  if (rec.joint_type) pills.append(el('span', { className: 'pill' }, `${nice(rec.joint_type)} joint`));
  if (rec.cartilage) pills.append(el('span', { className: 'pill' }, nice(rec.cartilage)));
  box.append(pills);
  box.append(el('div', { className: 'actions' },
    el('button', { className: 'btn primary', onclick: () => focusRecs(sib) }, 'Focus'),
    el('button', { className: 'btn', onclick: () => { S.iso = !S.iso; restyle(); } }, 'Isolate'),
    el('button', { className: 'btn', onclick: () => { S.ghost = !S.ghost; restyle(); } }, 'Ghost others'),
    el('button', { className: 'btn', onclick: () => navigator.clipboard?.writeText(location.href) }, 'Copy link')));
  const ids = new Set(sib.map((r) => r.id));
  const lms = S.M.landmarks.filter((l) => ids.has(l.target));
  const seen = new Set(), uniq = lms.filter((l) => (seen.has(l.name + l.side) ? false : seen.add(l.name + l.side)));
  if (uniq.length) {
    box.append(el('h3', {}, `Landmarks (${uniq.length})`));
    box.append(el('div', { className: 'lm-list' }, uniq.slice(0, 60).map((l) => el('button', { onclick: () => showLandmark(l) }, l.name))));
  }
  const holder = el('div', {}, el('h3', {}, 'Description'), el('p', { className: 'fine' }, 'Loading…'));
  box.append(holder);
  $('#info').replaceChildren(box);
  const d = await descFor(rec.system);
  if (S.cur !== rec) return;
  const t = d[rec.name];
  holder.replaceChildren(el('h3', {}, 'Description'), t ? fmtDesc(t, rec.name) : el('p', { className: 'fine' }, 'No description available for this structure.'),
    t ? el('p', { className: 'fine' }, 'Text: Wikipedia, CC BY-SA.') : null);
}
async function showLandmark(lm) {
  S.curLm = lm;
  flash.geometry.attributes.position.set(lm.pos); flash.geometry.attributes.position.needsUpdate = true; flash.visible = true; dirty = true;
  const c = new THREE.Vector3(...lm.pos);
  flyTo(c, 0.06);
  const d = await descFor(lm.system), t = d[lm.name];
  const box = el('div', { className: 'lm-detail' }, el('h3', {}, `Landmark: ${lm.name}`), t ? fmtDesc(t, lm.name) : el('p', { className: 'fine' }, 'No description available for this landmark.'));
  $('.lm-detail')?.remove(); $('#info').append(box); box.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------- navigation tree --
const openers = new Map(); // groupId -> open()
function countIn(gid) {
  const k = S.kids.get(gid); if (!k) return 0;
  if (k.count != null) return k.count;
  k.count = k.items.size + k.groups.reduce((a, g) => a + countIn(g.id), 0); return k.count;
}
function itemRow(name, recs) {
  const rec = recs[0];
  const b = el('button', { className: 'row leaf', type: 'button', title: name }, el('span', { className: 'chev' }, '›'), nameOf(rec));
  b.dataset.ids = recs.map((r) => r.id).join('|');
  const sides = [...new Set(recs.map((r) => r.side).filter(Boolean))];
  if (sides.length) b.append(el('span', { className: 'side-tag' }, sides.map((s) => s.toUpperCase()).join('·')));
  b.addEventListener('click', () => selectRec(rec));
  return b;
}
function groupNode(g, sys) {
  const li = el('li'); const row = el('button', { className: 'row', type: 'button' }, el('span', { className: 'chev' }, '›'),
    S.lang === 'en' ? g.name : (S.i18n[g.name.toLowerCase()]?.[S.lang] || g.name), el('span', { className: 'n' }, String(countIn(g.id))));
  row.dataset.gid = g.id;
  const ul = el('ul'); ul.hidden = true; let built = false;
  const open = (force) => {
    const want = force ?? ul.hidden;
    if (want && !built) { fillLevel(ul, g.id, sys); built = true; }
    ul.hidden = !want; row.classList.toggle('open', want);
  };
  openers.set(g.id, open); row.addEventListener('click', () => { open(); selectGroup(g); });
  li.append(row, ul); return li;
}
function groupStructures(gid) {
  const k = S.kids.get(gid), out = [];
  if (!k) return out;
  for (const recs of k.items.values()) out.push(...recs);
  for (const g of k.groups) out.push(...groupStructures(g.id));
  return out;
}
async function selectGroup(g) {
  const recs = groupStructures(g.id);
  if (!recs.length) return;
  S.cur = null; S.curLm = null; S.sel = new Set(recs.slice(0, 800).map((r) => r.id));
  if (!S.sys.get(g.system)?.visible) await setSystemVisible(g.system, true); else await loadSystem(g.system);
  restyle(); markTree();
  const color = SYS[g.system]?.[1] || '#888', chain = []; let p = S.groups.get(g.parent);
  while (p) { chain.unshift(p); p = S.groups.get(p.parent); }
  const gname = (x) => (S.lang === 'en' ? x.name : (S.i18n[x.name.toLowerCase()]?.[S.lang] || x.name));
  const box = el('div', { style: `--dot:${color}` }, el('h2', {}, gname(g)));
  if (chain.length > 1) box.append(el('div', { className: 'crumbs' }, chain.slice(1).flatMap((c) => [gname(c), ' › ']), gname(g)));
  box.append(el('div', { className: 'pills' }, el('span', { className: 'pill sys' }, SYS[g.system]?.[0] || g.system), el('span', { className: 'pill' }, `${recs.length} structures`)));
  box.append(el('div', { className: 'actions' },
    el('button', { className: 'btn primary', onclick: () => focusRecs(recs) }, 'Focus'),
    el('button', { className: 'btn', onclick: () => { S.iso = !S.iso; restyle(); } }, 'Isolate'),
    el('button', { className: 'btn', onclick: () => { S.ghost = !S.ghost; restyle(); } }, 'Ghost others'),
    el('button', { className: 'btn', onclick: clearSel }, 'Clear')));
  const holder = el('div', {}); box.append(holder);
  $('#info').replaceChildren(box);
  const t = (await descFor(g.system))[g.name];
  if (t) holder.append(el('h3', {}, 'Description'), fmtDesc(t, g.name), el('p', { className: 'fine' }, 'Text: Wikipedia, CC BY-SA.'));
}
function fillLevel(ul, gid, sys) {
  const k = S.kids.get(gid); if (!k) return;
  for (const g of k.groups) if (countIn(g.id) > 0) ul.append(groupNode(g, sys)); // skip empty classification headings
  const names = [...k.items.keys()].sort((a, b) => a.localeCompare(b));
  for (const n of names) ul.append(el('li', {}, itemRow(n, k.items.get(n))));
}
function topLevel(sys) {
  const roots = S.roots.get(sys) || [];
  return roots.length === 1 ? roots[0].id : `root:${sys}`; // a sole root heading is the system itself: show its children directly
}
function fillTop(ul, sys) {
  fillLevel(ul, topLevel(sys), sys);
  if (topLevel(sys) !== `root:${sys}`) fillLevel(ul, `root:${sys}`, sys); // structures that sit outside any group
}
function buildSystems() {
  const ul = $('#systems'); ul.replaceChildren(); openers.clear();
  for (const info of S.M.systems) {
    const k = info.key, [label, color, thumb] = SYS[k] || [info.label, '#888', null];
    const li = el('li', { className: 'sys' + (S.sys.get(k)?.visible ? ' on' : ''), style: `--dot:${color}` }); li.dataset.key = k;
    const head = el('div', { className: 'sys-head' });
    const th = el('div', { className: 'sys-thumb' }); if (thumb) th.style.backgroundImage = `url(${CFG.imgBase}${thumb}_front.png)`;
    const name = el('button', { className: 'sys-name', type: 'button', 'aria-expanded': 'false' }, el('b', {}, label), el('small', {}, `${info.structures} structures · ${(info.bytes / 1e6).toFixed(1)} MB`));
    const eye = el('button', { className: 'eye', type: 'button', title: 'Show / hide in 3D view', 'aria-pressed': String(!!S.sys.get(k)?.visible) },
      el('span', { innerHTML: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>' }));
    head.append(th, name, eye);
    const prog = el('div', { className: 'sys-prog' });
    const tree = el('div', { className: 'tree' }); tree.hidden = true; const root = el('ul'); tree.append(root);
    let built = false;
    name.addEventListener('click', async () => {
      const show = tree.hidden; tree.hidden = !show; name.setAttribute('aria-expanded', show);
      if (show && !built) { fillTop(root, k); built = true; }
      if (show && !S.sys.get(k)?.visible) { await setSystemVisible(k, true); if (!S.sel.size) fitVisible(); }
    });
    eye.addEventListener('click', async () => { const on = !S.sys.get(k)?.visible; await setSystemVisible(k, on); if (on && !S.sel.size) fitVisible(); });
    li.append(head, prog, tree); li.dataset.built = '0'; ul.append(li);
    li._ensureTree = () => { if (tree.hidden) { tree.hidden = false; name.setAttribute('aria-expanded', 'true'); } if (!built) { fillTop(root, k); built = true; } };
  }
}
function setProg(k, f) { const p = document.querySelector(`.sys[data-key="${k}"] .sys-prog`); if (p) p.style.transform = `scaleX(${f})`; }
function markTree() {
  document.querySelectorAll('.row.sel').forEach((n) => n.classList.remove('sel'));
  if (!S.sel.size) return;
  const first = [...S.sel][0];
  document.querySelectorAll('.row.leaf').forEach((n) => { if (n.dataset.ids && n.dataset.ids.split('|').includes(first)) n.classList.add('sel'); });
}
function revealInTree(rec) {
  const li = document.querySelector(`.sys[data-key="${rec.system}"]`); if (!li || !li._ensureTree) return;
  li._ensureTree();
  const chain = []; let g = S.groups.get(rec.group);
  while (g) { chain.unshift(g.id); g = S.groups.get(g.parent); }
  for (const gid of chain) openers.get(gid)?.(true);
  markTree(); document.querySelector('.row.sel')?.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' });
}

// ------------------------------------------------------------------ search --
function rank(name, q) { const n = name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; }
const F = { q: '', tag: 'ALL', joint: 'ALL', cart: 'ALL', lm: true };
function runSearch() {
  F.q = $('#q').value.trim().toLowerCase(); F.tag = $('#fSystem').value; F.joint = $('#fJoint').value; F.cart = $('#fCart').value; F.lm = $('#fLandmarks').checked;
  const active = F.q || F.tag !== 'ALL' || F.joint !== 'ALL' || F.cart !== 'ALL';
  $('#clearFilters').hidden = !(F.tag !== 'ALL' || F.joint !== 'ALL' || F.cart !== 'ALL');
  $('#results').hidden = !active; $('#browse').hidden = active;
  if (!active) return;
  const ok = (r) => (F.tag === 'ALL' || r.tags.includes(F.tag)) &&
    (F.joint === 'ALL' || (JOINT_KINDS.has(F.joint) ? r.joint_kind === F.joint : r.joint_type === F.joint)) &&
    (F.cart === 'ALL' || r.cartilage === F.cart) &&
    (!F.q || r._s.includes(F.q));
  const rows = new Map();
  const add = (r, kind, lm) => {
    const key2 = `${kind}|${r.system}|${r.group}|${r.name}`; // left/right twins share one row
    if (!rows.has(key2)) rows.set(key2, { rec: r, kind, lm, sides: [] });
    if (r.side) rows.get(key2).sides.push(r.side);
  };
  for (const r of S.M.structures) if (ok(r)) add(r, 'structure');
  if (F.lm) for (const l of S.M.landmarks) if (l._asRec && ok(l._asRec)) add(l._asRec, 'landmark', l);
  const list = [...rows.values()].sort((a, b) => rank(a.rec.name, F.q) - rank(b.rec.name, F.q) || (a.kind === 'structure' ? 0 : 1) - (b.kind === 'structure' ? 0 : 1) || a.rec.name.localeCompare(b.rec.name));
  renderResults(list);
}
function renderResults(list, limit = 80) {
  const box = $('#results'); box.replaceChildren();
  const all = list.filter((x) => x.kind === 'structure').flatMap((x) => siblingsOf(x.rec));
  box.append(el('div', { className: 'count' }, `${list.length} result${list.length === 1 ? '' : 's'}`,
    all.length > 1 ? el('button', { className: 'btn', type: 'button', onclick: () => selectMany(all.slice(0, 500)) }, `Highlight ${Math.min(all.length, 500)}`) : null));
  for (const it of list.slice(0, limit)) {
    const r = it.rec, color = SYS[r.system]?.[1] || '#888';
    const path = crumbs(r).map((g) => g.name).join(' › ');
    const side = [...new Set(it.sides)].map((s) => s.toUpperCase()).join('·');
    const b = el('button', { className: 'res', type: 'button', style: `--dot:${color}` },
      el('div', { className: 't' }, el('span', { className: 'dot' }), nameOf(r), side ? el('span', { className: 'side-tag' }, side) : null, it.kind === 'landmark' ? el('span', { className: 'pin' }, '📍 landmark') : null),
      el('div', { className: 'p' }, [SYS[r.system]?.[0], path].filter(Boolean).join(' › ')));
    b.addEventListener('click', async () => {
      const target = it.kind === 'landmark' ? S.byId.get(it.lm.target) : r;
      await selectRec(target, { focus: it.kind !== 'landmark' }); revealInTreeSoon(target);
      if (it.lm) showLandmark(it.lm);
    });
    box.append(b);
  }
  if (list.length > limit) box.append(el('button', { className: 'btn more', type: 'button', onclick: () => renderResults(list, limit + 200) }, `Show more (${list.length - limit} left)`));
}
const revealInTreeSoon = (rec) => setTimeout(() => revealInTree(rec), 0);
$('#q').addEventListener('input', debounce(runSearch, 120));
['#fSystem', '#fJoint', '#fCart', '#fLandmarks'].forEach((s) => $(s).addEventListener('change', runSearch));
$('#clearFilters').addEventListener('click', () => { $('#fSystem').value = $('#fJoint').value = $('#fCart').value = 'ALL'; runSearch(); });
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fillSelect(sel, opts) { sel.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l))); }

// ------------------------------------------------------------- url state ----
function saveHash() {
  const vis = [...S.sys].filter(([, s]) => s.visible).map(([k]) => k).join(',');
  const p = new URLSearchParams(); if (vis) p.set('s', vis); if (S.cur) p.set('sel', S.cur.id); if (S.lang !== 'en') p.set('lang', S.lang);
  history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname + location.search);
}
async function restoreHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('lang')) { S.lang = p.get('lang'); $('#lang').value = S.lang; }
  const list = (p.get('s') || 'skeletal').split(',').filter((k) => S.M.systems.some((s) => s.key === k));
  await Promise.all(list.map((k) => setSystemVisible(k, true)));
  const sel = p.get('sel') && S.byId.get(p.get('sel'));
  if (sel) { await selectRec(sel); revealInTree(sel); } else fitVisible();
}

// -------------------------------------------------------------------- init --
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'Escape') clearSel();
  else if (e.key === 'g' || e.key === 'G') { S.ghost = !S.ghost; restyle(); }
  else if (e.key === 'i' || e.key === 'I') { S.iso = !S.iso; restyle(); }
  else if (e.key === 'f' || e.key === 'F') { S.sel.size ? focusRecs([...S.sel].map((id) => S.byId.get(id))) : fitVisible(); }
});
$('#menuBtn').addEventListener('click', () => { const o = document.body.classList.toggle('nav-open'); $('#menuBtn').setAttribute('aria-expanded', o); });
$('#lang').addEventListener('change', () => { S.lang = $('#lang').value; buildSystems(); syncOn(); runSearch(); if (S.cur) showInfo(siblingsOf(S.cur)); saveHash(); });
const syncOn = () => S.sys.forEach((st, k) => { const li = document.querySelector(`.sys[data-key="${k}"]`); li?.classList.toggle('on', st.visible); });

async function init() {
  setLoading('Loading atlas index…', 0.1);
  try {
    const [M, i18n] = await Promise.all([
      fetch(`${CFG.dataBase}manifest.json`).then((r) => { if (!r.ok) throw new Error(`manifest ${r.status}`); return r.json(); }),
      fetch(`${CFG.dataBase}i18n.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    S.M = M; S.i18n = i18n;
  } catch (e) {
    setLoading(null); $('#browse').append(el('p', { className: 'fine', style: 'padding:8px' }, `Could not load the atlas data (${e.message}). Run tools/export_web.py and serve this folder over http.`)); return;
  }
  for (const g of S.M.groups) { S.groups.set(g.id, g); S.kids.set(g.id, { groups: [], items: new Map() }); }
  for (const k of new Set(S.M.systems.map((s) => s.key))) { S.kids.set(`root:${k}`, { groups: [], items: new Map() }); S.roots.set(k, []); }
  for (const g of S.M.groups) {
    if (g.parent && S.groups.has(g.parent)) S.kids.get(g.parent).groups.push(g);
    else S.roots.get(g.system)?.push(g);
  }
  // several root groups in a system -> list them under a synthetic root; a sole root heading is skipped (see topLevel)
  for (const [k, roots] of S.roots) if (roots.length > 1) S.kids.get(`root:${k}`).groups.push(...roots);
  for (const r of S.M.structures) {
    S.byId.set(r.id, r);
    const sk = `${r.system}|${r.group}|${r.name}`;
    if (!S.siblings.has(sk)) S.siblings.set(sk, []); S.siblings.get(sk).push(r);
    const gid = S.groups.has(r.group) ? r.group : `root:${r.system}`;
    const kids = S.kids.get(gid); if (!kids.items.has(r.name)) kids.items.set(r.name, []); kids.items.get(r.name).push(r);
  }
  for (const l of S.M.landmarks) { S.lmById.set(l.id, l); if (!S.lmByTarget.has(l.target)) S.lmByTarget.set(l.target, []); S.lmByTarget.get(l.target).push(l); }
  const pathText = (r) => crumbs(r).map((g) => g.name).join(' ');
  for (const r of S.M.structures) r._s = `${r.name} ${latinOf(r)} ${pathText(r)} ${SYS[r.system]?.[0] || ''}`.toLowerCase();
  for (const l of S.M.landmarks) {
    const t = S.byId.get(l.target); if (!t) continue;
    // a landmark searches/filters like the structure it sits on, but under its own name
    l._asRec = { ...t, name: l.name, side: l.side, _s: `${l.name} ${S.i18n[l.name.toLowerCase()]?.la || ''} ${pathText(t)} ${SYS[t.system]?.[0] || ''}`.toLowerCase() };
  }

  fillSelect($('#fSystem'), TAGS); fillSelect($('#fJoint'), JOINTS); fillSelect($('#fCart'), CARTS);
  for (const info of S.M.systems) sysState(info.key);
  buildSystems(); setLoading(null); $('#info').replaceChildren(emptyInfo());
  await restoreHash(); rebuildPins();
  window.atlas = { S, focusRecs, selectRec, THREE, camera, controls, scene };   // handy for debugging in the console
}
init();
