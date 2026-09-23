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
// Short, spoken-friendly explanation of each category, for the audio "Listen" buttons (accessibility / hands-free study).
const SYS_BLURB = {
  skeletal: 'The skeletal system is the framework of bones and cartilage that supports the body, protects internal organs, and works with muscles to produce movement. It also stores minerals such as calcium and, within certain bones, produces blood cells in the bone marrow. This category includes the skull, spine, ribs, and the bones of the limbs and girdles.',
  joints: "Joints are the connections between bones, held together by ligaments and, in synovial joints, a fluid-filled capsule that allows smooth movement. This category groups the body's joints by type — fibrous, cartilaginous, and synovial — along with the ligaments that stabilize them.",
  insertions: "Muscular insertions show where each muscle attaches onto the skeleton, marking its origin and insertion points. Viewing them alongside the bones helps you understand how a muscle's pull translates into movement at a joint.",
  muscular: 'The muscular system is made up of skeletal muscles that contract to move the bones, stabilize joints, and maintain posture. Each muscle here has an origin, an insertion, and one or more actions it produces at a joint.',
  fascia: 'Fascia is the connective tissue envelope that wraps and separates muscles, organs, and other structures, giving the body its internal shape and letting tissues slide against one another. This category covers the major fascial layers and septa of the body.',
  cardiovascular: "The cardiovascular system is the network of the heart, arteries, veins, and capillaries that circulates blood, delivering oxygen and nutrients to tissues and carrying away waste. Explore the heart's chambers and the major vessels of systemic and pulmonary circulation.",
  lymphoid: "The lymphoid system includes the lymph nodes, spleen, thymus, and lymphatic vessels that drain excess fluid from tissues and support the body's immune defenses.",
  nervous: 'The nervous system includes the brain and spinal cord, known as the central nervous system, as well as the peripheral nerves and sense organs that connect the body to the outside world.',
  visceral: 'Visceral systems cover the internal organs of the digestive, respiratory, urinary, reproductive, and endocrine systems, such as the lungs, stomach, kidneys, and hormone-producing glands.',
  regions: 'Body regions divide the body into named surface areas, such as the head, neck, thorax, abdomen, and limbs, that are used to describe location. This category is a map of anatomical regions rather than individual structures.',
  reference: 'Reference lines and movements are the anatomical planes, directional terms, and joint movements — like flexion, extension, and rotation — used to describe position and motion throughout this atlas.',
};

// ------------------------------------------------------------------- state --
const S = {
  M: null, i18n: {}, lang: 'en',
  byId: new Map(), groups: new Map(), lmByTarget: new Map(), siblings: new Map(), lmById: new Map(),
  childGroups: new Map(), // group id -> child groups (one global anatomical hierarchy shared by all systems)
  rootGroups: [],         // groups whose parent is unknown
  items: new Map(),       // `${system}|${groupId}` -> Map(name -> recs[]); groupId '' = not in any group
  counts: new Map(),
  sys: new Map(),  // key -> { group, loaded, loading, visible, progress }
  meshes: new Map(), // id -> Mesh[]
  sel: new Set(), cur: null, curLm: null, ghost: false, iso: false, pins: false, tab: null,
  desc: new Map(),
  wholes: new Map(),      // `${system}|${muscle}` -> every head/part record of a muscle whose parts are separate structures
};
const nameOf = (r) => (S.lang === 'en' ? r.name : (S.i18n[r.name.toLowerCase()]?.[S.lang] || r.name));
const latinOf = (r) => S.i18n[r.name.toLowerCase()]?.la || '';

// ------------------------------------------------------------------ three ---
const canvas = $('#gl');
const stage = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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
controls.minDistance = 0.004; controls.maxDistance = 12;   // structures range from 1.8 m (body) to 3 mm (stapes): zoom must reach both
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });
const world = new THREE.Group(); scene.add(world);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(resize).observe(stage); resize();

// Per-frame hooks for the study / motion modules. frameHooks run before the render and return true to force a redraw
// (an animation is running); afterHooks run after it (DOM overlays that follow 3D points read the final camera).
const frameHooks = new Set(), afterHooks = new Set();
// The near plane follows the zoom distance so a 3 mm structure can be filled with the frame without clipping,
// while the whole body keeps the depth precision it had with a fixed 2 cm near plane.
function autoNear() {
  const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.04, 0.001, 0.02);
  if (Math.abs(near - camera.near) > camera.near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); dirty = true; }
}
let lastFrame = performance.now();
(function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
  let need = controls.update();
  for (const f of frameHooks) if (f(dt, now)) need = true;
  autoNear();
  const draw = need || dirty;
  if (draw) { renderer.render(scene, camera); dirty = false; }
  for (const f of afterHooks) f(draw);
})(performance.now());
// world point -> pixels inside #stage (for labels / pins drawn as DOM); visible = in front of the camera and inside the frame
const _pv = new THREE.Vector3();
function project(v, out = {}) {
  _pv.copy(v).project(camera);
  out.x = (_pv.x * 0.5 + 0.5) * stage.clientWidth; out.y = (-_pv.y * 0.5 + 0.5) * stage.clientHeight; out.z = _pv.z;
  out.visible = _pv.z > -1 && _pv.z < 1 && _pv.x > -1.05 && _pv.x < 1.05 && _pv.y > -1.05 && _pv.y < 1.05;
  return out;
}

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
  // fit the bounding sphere in the narrower of the vertical / horizontal field of view, so wide selections are not cropped on a tall stage
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const dist = Math.max(radius / Math.sin(Math.min(vHalf, hHalf)) * 1.15, 0.012);
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
let pinIndex = new Map(); // landmark id -> its slot in the pin buffer, kept alongside pinIds
function rebuildPins() {
  const lms = S.M ? S.M.landmarks.filter((l) => S.sys.get(l.system)?.visible) : [];
  pinIds = lms.map((l) => l.id);
  pinIndex = new Map(pinIds.map((id, i) => [id, i]));
  const pos = new Float32Array(lms.length * 3), col = new Float32Array(lms.length * 3), c = new THREE.Color();
  lms.forEach((l, i) => { pos.set(l.pos, i * 3); c.set(SYS[l.system]?.[1] || '#ffffff'); col.set([c.r, c.g, c.b], i * 3); });
  pinObj.geometry.dispose();
  pinObj.geometry = new THREE.BufferGeometry();
  pinObj.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pinObj.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pinObj.visible = S.pins && lms.length > 0; dirty = true;
}
// Lets an active Motion session keep a bone's landmark pins glued to it while the bone swings (a no-op if that
// landmark isn't currently rendered as a pin). rebuildPins() is the way back to the rest positions once it stops.
function movePinTo(id, pos) {
  const i = pinIndex.get(id); if (i == null) return;
  pinObj.geometry.attributes.position.array.set([pos.x, pos.y, pos.z], i * 3);
  pinObj.geometry.attributes.position.needsUpdate = true; dirty = true;
}
$('#pinsBtn').addEventListener('click', () => {
  S.pins = !S.pins; $('#pinsBtn').setAttribute('aria-pressed', S.pins); rebuildPins();
});

// ---------------------------------------------------------------- picking ---
const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.012;
const ndc = new THREE.Vector2();
let hoverOk = true, lastHover = 0;
function pickAt(e, forHover, { additive = false } = {}) {
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
  // Ghost mode normally excludes faded structures from picking so a mis-click can't grab the background; an
  // additive (ctrl/shift) click means the user wants exactly one of those faded structures, so it stays pickable.
  const hits = ray.intersectObjects(roots, true).filter((h) => h.object.isMesh && h.object.visible &&
    (additive || !(S.sel.size && S.ghost && !S.sel.has(h.object.userData.zid))));
  if (forHover && performance.now() - t0 > 70) hoverOk = false; // raycast too slow on this machine: hover off, click still works
  const rec = hits.length ? S.byId.get(hits[0].object.userData.zid) : null;
  return { rec, lm };
}
const tip = $('#tip');
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons || !hoverOk || atlas.pickHandler) { tip.hidden = true; return; }   // quiz mode must not leak names through the hover tip
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
  const additive = e.ctrlKey || e.metaKey || e.shiftKey;
  const { rec, lm } = pickAt(e, false, { additive });
  if (atlas.pickHandler) { atlas.pickHandler(rec, lm, e); return; }   // study mode takes over clicks (no info panel, no selection)
  if (lm) {
    const t = S.byId.get(lm.target);
    if (t) { if (additive) toggleInSelection(t); else { selectRec(t, { focus: false }); showLandmark(lm); } }
  } else if (rec) { additive ? toggleInSelection(rec) : selectRec(rec, { focus: false }); }
  else if (!additive) clearSel();
});

// ----------------------------------------------------------- text-to-speech --
// Reads category, group and structure explanations aloud so the atlas can be studied hands-free. One utterance
// plays at a time; the button that started it doubles as its stop control (aria-pressed + a "speaking" style).
const SPEECH_LANG = { en: 'en-US', la: 'la', fr: 'fr-FR', es: 'es-ES', pt: 'pt-PT' };
const speechOk = () => 'speechSynthesis' in window;
let speakBtn = null;
function stopSpeech() {
  if (speechOk()) speechSynthesis.cancel();
  if (speakBtn) { speakBtn.classList.remove('speaking'); speakBtn.setAttribute('aria-pressed', 'false'); const lbl = $('.lbl', speakBtn); if (lbl) lbl.textContent = speakBtn.dataset.idleLabel || 'Listen'; }
  speakBtn = null;
}
function speak(text, btn) {
  if (!speechOk()) { notify('Text-to-speech is not supported in this browser'); return; }
  const wasThis = btn && speakBtn === btn;
  stopSpeech();
  if (wasThis) return; // clicking the button that is already speaking just stops it
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[S.lang] || 'en-US'; u.rate = 0.95;
  u.onend = stopSpeech; u.onerror = stopSpeech;
  speakBtn = btn || null;
  if (btn) { btn.classList.add('speaking'); btn.setAttribute('aria-pressed', 'true'); const lbl = $('.lbl', btn); if (lbl) lbl.textContent = 'Stop'; }
  speechSynthesis.speak(u);
}
const speakerIcon = () => el('span', { className: 'ico', 'aria-hidden': 'true', innerHTML:
  '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 6a9 9 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/></svg>' });
// A "Listen" button; getText() may return a string or a Promise<string> (fetched lazily on click).
function listenBtn(getText, label) {
  const b = el('button', { className: 'btn listen', type: 'button', 'aria-pressed': 'false', title: label || 'Listen to this explanation' },
    speakerIcon(), el('span', { className: 'lbl' }, 'Listen'));
  b.dataset.idleLabel = 'Listen';
  b.addEventListener('click', async () => {
    if (b.classList.contains('speaking')) { stopSpeech(); return; }
    b.disabled = true;
    const text = await getText();
    b.disabled = false;
    if (!text) { notify('Nothing to read aloud yet'); return; }
    speak(text, b);
  });
  return b;
}
function triggerListen() {
  const b = $('#info .btn.listen');
  if (b) b.click(); else notify('Select a structure or category first, then press L to hear it');
}

// -------------------------------------------------------------- selection ---
function siblingsOf(rec) { return S.siblings.get(`${rec.system}|${rec.group}|${rec.name}`) || [rec]; }
// A muscle with several heads/parts is one anatomical unit. Isolate and its zoom act on the whole muscle, not on one head:
// either the muscle has its own group ("Biceps brachii muscle.g" holds both heads) or its parts are named "<Part> head|part|belly of <muscle>".
const WHOLE_GROUP = /^(?!Muscles).+ muscle$|^Levator ani$/i;
const partBase = (name) => { const m = name.match(/^[^(]+? (?:head|part|belly) of (.+)$/i); return m ? m[1].replace(/ muscle$/i, '').toLowerCase() : null; };
function wholeOf(rec) {
  const sib = siblingsOf(rec);
  if (rec.system !== 'muscular') return sib;
  const g = S.groups.get(rec.group);
  if (g && WHOLE_GROUP.test(g.name)) { const all = groupStructures(rec.system, g.id); if (all.length) return all; }
  const b = partBase(rec.name), parts = b && S.wholes.get(`${rec.system}|${b}`);
  return parts && parts.length > sib.length ? parts : sib;
}
async function selectRec(rec, { focus = true } = {}) {
  stopSpeech();
  const sib = siblingsOf(rec);
  const shown = S.iso ? wholeOf(rec) : sib;   // while isolating, a click isolates the whole muscle
  S.cur = rec; S.curLm = null; S.sel = new Set(shown.map((r) => r.id));
  if (!S.sys.get(rec.system)?.visible) await setSystemVisible(rec.system, true);
  else await loadSystem(rec.system);
  restyle(); showInfo(sib); markTree(); saveHash();
  if (focus) focusRecs(shown);
}
function ensureVisible(recs) {
  const need = new Set(recs.map((r) => r.system));
  return Promise.all([...need].map((k) => (S.sys.get(k)?.visible ? loadSystem(k) : setSystemVisible(k, true)))).then(restyle);
}
// Add or remove a whole batch of structures from the current selection together (e.g. every ligament in a group),
// so unrelated tissue types picked one after another stay highlighted and can be isolated as one set.
function toggleManyInSelection(recs) {
  if (!recs.length) return;
  stopSpeech();
  const already = recs.every((r) => S.sel.has(r.id));
  const sel = new Set(S.sel);
  for (const r of recs) { if (already) sel.delete(r.id); else sel.add(r.id); }
  S.cur = null; S.curLm = null; S.sel = sel;
  if (!sel.size) { restyle(); markTree(); saveHash(); $('#info').replaceChildren(emptyInfo()); return; }
  ensureVisible(recs); restyle(); markTree(); saveHash(); multiInfo();
}
const toggleInSelection = (rec) => toggleManyInSelection(siblingsOf(rec));
function selectMany(recs) {
  stopSpeech();
  S.cur = null; S.curLm = null; S.sel = new Set(recs.map((r) => r.id));
  ensureVisible(recs); restyle(); markTree(); saveHash();
  multiInfo();
  focusRecs(recs);
}
// Info panel for a multi-structure selection: one row per structure (sides merged), each removable, plus the
// usual Focus / Isolate / Ghost actions and a Listen button that reads the whole list aloud.
function multiInfo() {
  const recs = selectionRecs();
  const groups = new Map();
  for (const r of recs) { const k = `${r.system}|${r.name}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const rows = [...groups.values()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const box = el('div', { className: 'empty' },
    el('h2', {}, `${rows.length} structure${rows.length === 1 ? '' : 's'} selected`),
    el('p', {}, 'Ctrl/⌘-click (or Shift-click) a structure in the 3D view, tree or search results to add or remove it here.'));
  box.append(listenBtn(() => `Currently selected: ${rows.map((g) => nameOf(g[0])).join(', ')}.`, 'Listen to the list of selected structures'));
  box.append(el('div', { className: 'multi-list' }, rows.map((g) => {
    const r = g[0], color = SYS[r.system]?.[1] || '#888';
    return el('div', { className: 'multi-item', style: `--dot:${color}` },
      el('span', { className: 'dot' }), el('span', { className: 'nm' }, nameOf(r)),
      el('span', { className: 'sysname' }, SYS[r.system]?.[0] || r.system),
      el('button', { className: 'x', type: 'button', title: `Remove ${nameOf(r)}`, 'aria-label': `Remove ${nameOf(r)} from selection`, onclick: () => toggleManyInSelection(g) }, '×'));
  })));
  box.append(el('div', { className: 'actions' },
    el('button', { className: 'btn primary', onclick: () => focusRecs(recs) }, 'Focus'),
    el('button', { className: 'btn', title: 'Show only the selected structures (I)', onclick: () => toggleIso() }, S.iso ? 'Show all' : 'Isolate selection'),
    el('button', { className: 'btn', onclick: () => { S.ghost = !S.ghost; restyle(); } }, 'Ghost others'),
    el('button', { className: 'btn', onclick: clearSel }, 'Clear all')));
  box.append(buildExportSection());
  $('#info').replaceChildren(box);
}
function clearSel() {
  stopSpeech();
  S.sel = new Set(); S.cur = null; S.curLm = null; flash.visible = false; restyle(); markTree(); saveHash();
  $('#info').replaceChildren(emptyInfo());
}
const emptyInfo = () => $('#info-empty').content.cloneNode(true);
// Isolate = show only the selection and frame all of it (both sides, every part) as one whole.
const selectionRecs = () => [...S.sel].map((id) => S.byId.get(id)).filter(Boolean);
let hintTimer = 0;
function notify(text) {
  const h = $('#hint'); h.textContent = text; h.classList.remove('hide'); clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.add('hide'), 2800);
}
function setIso(on) {
  if (on && !S.sel.size) { notify('Select a structure first, then isolate it'); on = false; }
  S.iso = on;
  if (S.cur) S.sel = new Set((on ? wholeOf(S.cur) : siblingsOf(S.cur)).map((r) => r.id));
  restyle(); markTree();
  if (on) focusRecs(selectionRecs());
}
const toggleIso = () => setIso(!S.iso);
$('#clearBtn').addEventListener('click', clearSel);
$('#ghostBtn').addEventListener('click', () => { S.ghost = !S.ghost; restyle(); });
$('#isoBtn').addEventListener('click', () => toggleIso());

// ------------------------------------------------------------------ export --
// Downloads exactly what is currently highlighted in the 3D view — one structure, a whole muscle, a group, or an
// arbitrary multi-selection — as a PNG or a multi-page PDF. Can step through Front/Back/Left/Right and through an
// open Motion sequence (one page/tile per view, or per view x pose), with chosen labels burned into the image.
const EXPORT_VIEWS = [['cur', 'Current'], ['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']];
const EXPORT_LABELS = [['name', 'Structure name'], ['latin', 'Latin name'], ['landmarks', 'Landmark names']];
const EXPORT = { format: 'png', views: new Set(['cur']), labels: new Set(['name']), motion: false };

// One label per structure INSTANCE (not averaged across left/right), so the text sits on that instance, not floating
// between them. Capped so a huge group selection doesn't bury the image in overlapping text.
function labelPointsFor(recs, opts) {
  const pts = [];
  if ((opts.has('name') || opts.has('latin')) && recs.length <= 40) {
    for (const r of recs) {
      let text = opts.has('name') ? nameOf(r) : '';
      if (opts.has('latin')) { const la = latinOf(r); if (la && la.toLowerCase() !== nameOf(r).toLowerCase()) text = text ? `${text} (${la})` : la; }
      if (text) pts.push({ pos: boundsOf([r]).getCenter(new THREE.Vector3()), text, color: SYS[r.system]?.[1] || '#5eead4' });
    }
  }
  if (opts.has('landmarks')) {
    const ids = new Set(recs.map((r) => r.id)), seen = new Set();
    for (const l of S.M.landmarks) {
      if (!ids.has(l.target)) continue;
      const key = l.name + (l.side || ''); if (seen.has(key)) continue; seen.add(key);
      pts.push({ pos: new THREE.Vector3(...l.pos), text: l.name, color: '#ffb020' });
    }
  }
  return pts;
}
// Pastes the WebGL frame onto a canvas with a title header and text labels, at the canvas's own (device-pixel) resolution.
function composeFrame(srcCanvas, points, title, subtitle) {
  const scale = srcCanvas.width / Math.max(stage.clientWidth, 1);
  const pad = Math.round(46 * scale);
  const c = document.createElement('canvas'); c.width = srcCanvas.width; c.height = srcCanvas.height + pad;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(srcCanvas, 0, pad);
  ctx.fillStyle = '#e6edf3'; ctx.font = `700 ${Math.round(pad * 0.36)}px system-ui, sans-serif`;
  ctx.fillText(title, 16 * scale, pad * 0.46);
  if (subtitle) { ctx.fillStyle = '#93a1b3'; ctx.font = `${Math.round(pad * 0.26)}px system-ui, sans-serif`; ctx.fillText(subtitle, 16 * scale, pad * 0.82); }
  ctx.font = `600 ${Math.round(13 * scale)}px system-ui, sans-serif`;
  // nudge labels apart that would otherwise land on top of each other (e.g. left/right pairs close together in this view)
  const sorted = [...points].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) for (let j = 0; j < i; j++) {
    if (Math.abs(sorted[i].x - sorted[j].x) < 150 && Math.abs(sorted[i].y - sorted[j].y) < 18) sorted[i].y = sorted[j].y + 18;
  }
  for (const p of sorted) {
    const x = p.x * scale, y = p.y * scale + pad;
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, 3.5 * scale, 0, Math.PI * 2); ctx.fill();
    const tw = ctx.measureText(p.text).width, bx = x + 8 * scale, by = y - 9 * scale;
    ctx.fillStyle = 'rgba(13,17,23,.82)'; ctx.fillRect(bx - 4 * scale, by - 4 * scale, tw + 8 * scale, 20 * scale);
    ctx.fillStyle = '#e6edf3'; ctx.fillText(p.text, bx, by + 11 * scale);
  }
  return c.toDataURL('image/png');
}
// Repoints the camera at recs for one plane (or leaves it where it is for 'cur'), renders, composes labels, then
// restores the camera. Synchronous end-to-end so OrbitControls never observes the temporary camera move.
// Aims the camera at recs from one of the standard planes (or leaves it alone for 'cur'). Shared by the PNG/PDF
// per-view capture and the video export's plane selection, so both frame a view the exact same way.
function positionCameraForView(recs, viewKey) {
  if (viewKey === 'cur') return;
  const dir = new THREE.Vector3(...VIEWS[viewKey]).normalize();
  const b = boundsOf(recs), c = b.getCenter(new THREE.Vector3()), r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.02);
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const dist = Math.max(r / Math.sin(Math.min(vHalf, hHalf)) * 1.15, 0.012);
  camera.position.copy(c.clone().add(dir.multiplyScalar(dist))); controls.target.copy(c); camera.lookAt(c);
}
function captureExportFrame(recs, viewKey, labelOpts, title, subtitle) {
  const savedP = camera.position.clone(), savedT = controls.target.clone();
  positionCameraForView(recs, viewKey);
  renderer.render(scene, camera);
  const pts = [];
  for (const lp of labelPointsFor(recs, labelOpts)) { const p = project(lp.pos); if (p.visible) pts.push({ x: p.x, y: p.y, text: lp.text, color: lp.color }); }
  const dataURL = composeFrame(canvas, pts, title, subtitle);
  if (viewKey !== 'cur') { camera.position.copy(savedP); controls.target.copy(savedT); camera.lookAt(savedT); }
  dirty = true;
  return dataURL;
}
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
function downloadDataURL(dataURL, filename) {
  const a = el('a', { href: dataURL, download: filename }); document.body.append(a); a.click(); a.remove();
}
// Loads a data URL into an <img>, resolving on 'load' rather than the Decode API: decode() can hang indefinitely
// in a tab that has lost focus/visibility (Chrome defers it with paint scheduling), while 'load' fires promptly
// regardless, since the data is already local (no network wait either way).
const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
function exportPNG(frames, filename) {
  if (frames.length === 1) return downloadDataURL(frames[0].dataURL, `${filename}.png`);
  const cols = frames.length > 4 ? 3 : 2, rows = Math.ceil(frames.length / cols);
  return Promise.all(frames.map((f) => loadImage(f.dataURL))).then((imgs) => {
    const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight, gap = Math.round(w * 0.02);
    const c = document.createElement('canvas'); c.width = cols * w + (cols + 1) * gap; c.height = rows * h + (rows + 1) * gap;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => ctx.drawImage(im, gap + (i % cols) * (w + gap), gap + Math.floor(i / cols) * (h + gap)));
    downloadDataURL(c.toDataURL('image/png'), `${filename}.png`);
  });
}
async function exportPDF(frames, filename) {
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
  const dims = await Promise.all(frames.map((f) => loadImage(f.dataURL).then((im) => ({ w: im.naturalWidth, h: im.naturalHeight }))));
  const doc = new jsPDF({ orientation: dims[0].w >= dims[0].h ? 'landscape' : 'portrait', unit: 'px', format: [dims[0].w, dims[0].h], compress: true });
  frames.forEach((f, i) => {
    if (i > 0) doc.addPage([dims[i].w, dims[i].h], dims[i].w >= dims[i].h ? 'landscape' : 'portrait');
    doc.addImage(f.dataURL, 'PNG', 0, 0, dims[i].w, dims[i].h);
  });
  doc.save(`${filename}.pdf`);
}
const VIDEO_FPS = 30, VIDEO_SECONDS = 4; // baseline length at 1x; motion recordings scale this by 1/speed
const VIDEO_RES_SCALE = 2, VIDEO_RES_MAX = 1920; // supersample factor and cap (px, longer side) for recordings
const VIDEO_BITRATE = 8_000_000;
// A 0->1->0 triangle wave with eased corners: the shape of one full ping-pong pass through a movement's range,
// without needing access to the Motion module's own (private) easing.
const pingpongEase = (p) => { const q = p < 0.5 ? p * 2 : (1 - p) * 2; return q * q * (3 - 2 * q); };
// Pads a step out to at least `frameMs` of real wall-clock time — a ceiling on capture rate (never more than
// ~1/frameMs frames/sec) so a fast machine doesn't over-sample, but never a floor: a step that itself takes
// longer than frameMs is left alone, so a slow render can't accumulate into the recording running over length.
async function paceStep(stepStart, frameMs) {
  const left = frameMs - (performance.now() - stepStart);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}
// Temporarily renders at a higher internal resolution than the live view for a sharper recording — the canvas's
// CSS size (and so everything on screen) is unaffected, only its internal drawing-buffer resolution grows.
// Returns a function that restores the original size/pixel ratio.
function boostResolution() {
  const cssW = stage.clientWidth, cssH = stage.clientHeight;
  const scale = Math.min(VIDEO_RES_SCALE, VIDEO_RES_MAX / Math.max(cssW, cssH, 1));
  const prevPR = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(Math.max(1, Math.round(cssW * scale)), Math.max(1, Math.round(cssH * scale)), false);
  return () => { renderer.setPixelRatio(prevPR); renderer.setSize(cssW, cssH, false); dirty = true; };
}
// Which standard anatomical plane(s) show this movement cleanly, in place of the Motion tab's own oblique
// live-study camera angle (chosen there to make the rotation axis legible, not for a clean planar view).
// Circumduction has no single plane, so it gets two: front and the side it happens on.
function standardViewsForMotion(ses) {
  const side = ses.side === 'r' ? 'right' : 'left';
  if (ses.mv?.circ) return ['front', side];
  const plane = (ses.mv?.plane || '').toLowerCase();
  if (plane.includes('sagittal')) return [side];
  return ['front'];
}
// Views to actually record: whatever the user explicitly picked (if anything besides the default "Current"),
// else the standard plane(s) for this movement.
function resolveMotionViews(ses) {
  const chosen = [...EXPORT.views].filter((v) => v !== 'cur');
  return chosen.length ? chosen : standardViewsForMotion(ses);
}
// Rotates the camera a full turn around the selection's current center over `seconds`, one explicit step at a
// time, rendering and capturing each step itself rather than relying on the ambient render loop — so it can't
// come out empty if the tab loses focus mid-recording. Restores the camera exactly as it was afterward.
async function recordOrbit(recs, track, seconds) {
  const center = boundsOf(recs).getCenter(new THREE.Vector3());
  const savedP = camera.position.clone(), savedT = controls.target.clone();
  const offset = savedP.clone().sub(center), axis = new THREE.Vector3(0, 1, 0);
  const totalMs = seconds * 1000, frameMs = 1000 / VIDEO_FPS;
  controls.target.copy(center);
  const start = performance.now();
  try {
    for (;;) {
      const t0 = performance.now(), elapsed = t0 - start;
      if (elapsed >= totalMs) break;
      camera.position.copy(center).add(offset.clone().applyAxisAngle(axis, (elapsed / totalMs) * Math.PI * 2));
      camera.lookAt(center);
      renderer.render(scene, camera);
      track.requestFrame();
      await paceStep(t0, frameMs);
    }
  } finally {
    camera.position.copy(savedP); controls.target.copy(savedT); camera.lookAt(savedT); dirty = true;
  }
}
// Draws whatever Motion labels are currently on-screen (the same "Fixed: Femur" / axis / degree captions the
// Motion tab overlays live) onto the composited recording frame, at the exact position and box size the Motion
// module itself last computed for them (ses.labels' sx/sy/w/h — set moments ago by renderPoseNow -> updateLabels).
function drawMotionLabels(ctx, ses, scale) {
  const W = stage.clientWidth, H = stage.clientHeight;
  ctx.font = `600 ${Math.round(12 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const l of ses.labels || []) {
    if (l.on === false || !l.el || l.el.style.display === 'none') continue;
    const text = l.el.textContent; if (!text) continue;
    const w = l.w ?? l.el.offsetWidth, h = l.h ?? l.el.offsetHeight;
    const x = Math.min(Math.max(l.sx, 4), Math.max(4, W - 4 - w));
    const y = Math.min(Math.max(l.sy, 4), Math.max(4, H - 4 - h));
    ctx.fillStyle = 'rgba(10,14,20,.85)';
    ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
    ctx.fillStyle = '#eef3f9';
    ctx.fillText(text, (x + 7) * scale, (y + 3) * scale);
  }
}
// Steps an open Motion session through one full pass of its range (start -> end -> start) from each of `views`
// in turn (the total `seconds` split evenly across them), one explicit pose at a time: renderPoseNow() applies
// each pose synchronously (bone transforms, decor, labels), independent of the ambient render loop's own rAF
// timing, then the frame is composited (3D view + label captions) and captured itself. This is what makes the
// recording robust to a backgrounded tab, and what lets labels appear at all — they're DOM overlays, invisible
// to a plain canvas capture.
// Each view's pose is driven by real elapsed time against that view's wall-clock deadline (not a fixed frame
// count assumed to take frameMs apiece): a slow machine — high recording resolution costs real render+readback
// time — just gets fewer, correctly-timed frames instead of a recording that runs long and whose frame timestamps
// drift out of sync with the pose actually shown (heard as the pose "lagging" behind the video's own clock).
async function recordMotionCycle(ses, track, compCtx, scale, seconds, views, recs) {
  const saved = { u: ses.u, scrub: ses.scrub, playing: ses.playing, t: ses.t };
  const savedP = camera.position.clone(), savedT = controls.target.clone();
  ses.scrub = true; ses.playing = false;
  const perViewMs = (seconds / views.length) * 1000, frameMs = 1000 / VIDEO_FPS;
  try {
    for (const viewKey of views) {
      positionCameraForView(recs, viewKey);
      const viewStart = performance.now();
      for (;;) {
        const t0 = performance.now(), elapsed = t0 - viewStart;
        if (elapsed >= perViewMs) break;
        ses.u = pingpongEase(elapsed / perViewMs);
        atlas.motion.renderPoseNow();
        renderer.render(scene, camera);
        compCtx.drawImage(canvas, 0, 0);
        drawMotionLabels(compCtx, ses, scale);
        track.requestFrame();
        await paceStep(t0, frameMs);
      }
    }
  } finally {
    ses.u = saved.u; ses.scrub = saved.scrub; ses.playing = saved.playing; ses.t = saved.t;
    camera.position.copy(savedP); controls.target.copy(savedT); camera.lookAt(savedT);
    atlas.motion.renderPoseNow(); dirty = true;
  }
}
// Records the live 3D canvas as a short MP4 (or WebM, on browsers that can't mux MP4) clip: the open Motion
// session stepping through its range once if the "include motion" box is checked and one applies here (its
// captions composited in, at 4 seconds / the session's own speed multiplier), otherwise a plain 4-second 360°
// turntable of the current selection. Frames are captured
// explicitly (captureStream in manual mode + track.requestFrame(), paced to a fixed rate) rather than continuously,
// so the result can't come out short or empty just because the tab isn't the active/visible one while it records.
async function runVideoExport(recs) {
  if (!('MediaRecorder' in window) || !canvas.captureStream) { notify('Video recording is not supported in this browser'); return; }
  // MP4 (H.264) first for universal playback — supported by Chrome/Edge/Safari's MediaRecorder — falling back to
  // WebM only on browsers (e.g. Firefox) that can't mux MP4 themselves.
  const mimeType = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=h264', 'video/mp4',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
  ].find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) { notify('Video recording is not supported in this browser'); return; }
  const isMp4 = mimeType.startsWith('video/mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const names = [...new Set(recs.map((r) => nameOf(r)))];
  const filename = `z-anatomy_${slug(names[0] || 'selection')}${names.length > 1 ? `-and-${names.length - 1}-more` : ''}`;
  const ses = atlas.motion?.session;
  const wantMotion = EXPORT.motion && ses && ses.ready && ses.rec && recs.some((r) => r.id === ses.rec.id);
  const restoreRes = boostResolution(); // record sharper than the live view; on-screen size is unaffected
  try {
    let stream, compCanvas, compCtx;
    if (wantMotion) {
      // a separate 2D canvas to composite the 3D frame + label captions onto, since captions are DOM elements the
      // WebGL canvas alone never contains
      compCanvas = document.createElement('canvas'); compCanvas.width = canvas.width; compCanvas.height = canvas.height;
      compCtx = compCanvas.getContext('2d');
      stream = compCanvas.captureStream(0); // manual mode: frames are added only via track.requestFrame()
    } else {
      stream = canvas.captureStream(0);
    }
    const track = stream.getVideoTracks()[0];
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITRATE });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { recorder.onstop = res; });
    recorder.start();
    try {
      if (wantMotion) {
        const scale = compCanvas.width / Math.max(stage.clientWidth, 1);
        const views = resolveMotionViews(ses);
        await recordMotionCycle(ses, track, compCtx, scale, VIDEO_SECONDS / (ses.speed || 1), views, recs);
      } else {
        await recordOrbit(recs, track, VIDEO_SECONDS);
      }
    } finally {
      recorder.stop();
      await stopped;
    }
    const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
    const url = URL.createObjectURL(blob);
    downloadDataURL(url, `${filename}.${ext}`);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    restoreRes();
  }
}
// Steps the camera through the chosen views (and, if requested, an open Motion session through start/mid/end pose
// per view), capturing one frame each time, then bundles them into the chosen file and downloads it.
async function runExport(format) {
  const recs = selectionRecs();
  if (!recs.length) { notify('Nothing selected to export'); return; }
  if (format === 'video') { await runVideoExport(recs); return; }
  const views = EXPORT.views.size ? [...EXPORT.views] : ['cur'];
  const names = [...new Set(recs.map((r) => nameOf(r)))];
  const systems = [...new Set(recs.map((r) => SYS[r.system]?.[0] || r.system))];
  const title = `Z-Anatomy Atlas — ${names.length <= 3 ? names.join(', ') : `${names.length} structures`}`;
  const ses = atlas.motion?.session;
  const wantMotion = EXPORT.motion && ses && ses.ready && ses.rec && recs.some((r) => r.id === ses.rec.id);
  const saved = wantMotion ? { u: ses.u, scrub: ses.scrub, playing: ses.playing } : null;
  const uSteps = wantMotion ? [0, 0.5, 1] : [null];
  const frames = [];
  try {
    for (const v of views) {
      for (const u of uSteps) {
        if (u != null) { ses.scrub = true; ses.playing = false; ses.u = u; atlas.motion.renderPoseNow(); }
        const sub = [systems.join(' · '), `${EXPORT_VIEWS.find(([k]) => k === v)?.[1]} view`, u != null ? `pose ${Math.round(u * 100)}%` : null].filter(Boolean).join(' · ');
        frames.push({ dataURL: captureExportFrame(recs, v, EXPORT.labels, title, sub) });
      }
    }
  } finally {
    if (saved) { ses.u = saved.u; ses.scrub = saved.scrub; ses.playing = saved.playing; }
  }
  const filename = `z-anatomy_${slug(names[0] || 'selection')}${names.length > 1 ? `-and-${names.length - 1}-more` : ''}`;
  if (format === 'pdf') await exportPDF(frames, filename); else await exportPNG(frames, filename);
}
// The "Export" section embedded under each structure / group / multi-selection: pick a format, which planes and
// (when a motion is open for this exact selection) motion poses to capture, and which labels to burn in, then go.
function buildExportSection() {
  const box = el('div', { className: 'export' });
  box.append(el('h3', {}, 'Export'), el('p', { className: 'fine' }, 'Downloads exactly what is highlighted in the 3D view now — as a picture, as pages moving through the chosen views/motion in a PDF, or as a short 3D motion video.'));

  const btn = el('button', { type: 'button', className: 'btn primary exp-go' }, `Download ${EXPORT.format.toUpperCase()}`);
  const videoNote = el('p', { className: 'fine', hidden: EXPORT.format !== 'video' },
    'Records a 4-second clip (scaled by the Motion tab’s ½×/2× speed) in high resolution. If "include motion" below is checked, it captures the open motion — with its captions and direction arrows — from standard anatomical views (front/back/left/right, auto-picked for the movement, or use "Views to capture" to choose); otherwise it\'s a 4-second 360° turntable of the current selection.');

  const fmtBox = el('div', { className: 'chips' });
  for (const f of ['png', 'pdf', 'video']) {
    const chip = el('button', { type: 'button', className: 'chip' + (EXPORT.format === f ? ' prime' : ''), 'aria-pressed': String(EXPORT.format === f) }, f.toUpperCase());
    chip.addEventListener('click', () => {
      EXPORT.format = f; fmtBox.querySelectorAll('.chip').forEach((b) => { b.classList.remove('prime'); b.setAttribute('aria-pressed', 'false'); });
      chip.classList.add('prime'); chip.setAttribute('aria-pressed', 'true'); btn.textContent = `Download ${f.toUpperCase()}`;
      labelsRow.hidden = f === 'video'; videoNote.hidden = f !== 'video';
    });
    fmtBox.append(chip);
  }
  const viewsBox = el('div', { className: 'chips' });
  for (const [k, label] of EXPORT_VIEWS) {
    const chip = el('button', { type: 'button', className: 'chip' + (EXPORT.views.has(k) ? ' prime' : ''), 'aria-pressed': String(EXPORT.views.has(k)) }, label);
    chip.addEventListener('click', () => {
      if (EXPORT.views.has(k)) EXPORT.views.delete(k); else EXPORT.views.add(k);
      if (!EXPORT.views.size) EXPORT.views.add('cur');
      chip.classList.toggle('prime', EXPORT.views.has(k)); chip.setAttribute('aria-pressed', String(EXPORT.views.has(k)));
    });
    viewsBox.append(chip);
  }
  const labelsBox = el('div', { className: 'chips' });
  for (const [k, label] of EXPORT_LABELS) {
    const chip = el('button', { type: 'button', className: 'chip' + (EXPORT.labels.has(k) ? ' prime' : ''), 'aria-pressed': String(EXPORT.labels.has(k)) }, label);
    chip.addEventListener('click', () => {
      if (EXPORT.labels.has(k)) EXPORT.labels.delete(k); else EXPORT.labels.add(k);
      chip.classList.toggle('prime', EXPORT.labels.has(k)); chip.setAttribute('aria-pressed', String(EXPORT.labels.has(k)));
    });
    labelsBox.append(chip);
  }
  const isVideo = EXPORT.format === 'video';
  const viewsRow = el('div', { className: 'exp-row col' }, el('span', { className: 'exp-label' }, 'Views to capture'), viewsBox);
  const labelsRow = el('div', { className: 'exp-row col', hidden: isVideo }, el('span', { className: 'exp-label' }, 'Labels to show'), labelsBox);
  box.append(
    el('div', { className: 'exp-row' }, el('span', { className: 'exp-label' }, 'Format'), fmtBox),
    viewsRow, labelsRow, videoNote,
  );

  // The Motion tab's session only finishes loading a moment after this panel is built (it awaits the skeleton
  // system), so check now and, if not ready yet, keep checking each frame until it is (or this panel is replaced).
  const motionRow = el('div'); box.append(motionRow);
  const tryFillMotion = () => {
    const ses = atlas.motion?.session, recs = selectionRecs();
    const available = !!(ses && ses.ready && ses.rec && recs.some((r) => r.id === ses.rec.id));
    if (!available) { EXPORT.motion = false; return false; }
    if (!motionRow.firstChild) {
      const cb = el('input', { type: 'checkbox', checked: EXPORT.motion });
      cb.addEventListener('change', () => { EXPORT.motion = cb.checked; });
      motionRow.append(el('label', { className: 'exp-row check' }, cb, ' Include the open motion sequence (start → mid → end, per view)'));
    }
    return true;
  };
  if (!tryFillMotion()) {
    const iv = setInterval(() => { if (!box.isConnected || tryFillMotion()) clearInterval(iv); }, 150);
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true; const was = btn.textContent; btn.textContent = EXPORT.format === 'video' ? 'Recording…' : 'Exporting…';
    try { await runExport(EXPORT.format); notify(EXPORT.format === 'video' ? 'Recording ready — check your downloads' : 'Export ready — check your downloads'); }
    catch (e) { console.error(e); notify('Export failed — see console for details'); }
    finally { btn.disabled = false; btn.textContent = was; }
  });
  box.append(btn);
  return box;
}

// -------------------------------------------------------------- info panel --
async function descFor(sys) {
  if (!S.desc.has(sys)) S.desc.set(sys, fetch(`${CFG.dataBase}desc/${sys}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return S.desc.get(sys);
}
// Splits a raw wiki-style article into typed blocks (heading levels + paragraphs), skipping bare all-caps
// title repeats. Shared by fmtDesc (renders it) and plainDesc (joins it into one string for text-to-speech).
function descBlocks(text, title) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    let m;
    if ((m = b.match(/^===\s*(.+?)\s*===$/))) out.push({ t: 'h5', text: m[1] });
    else if ((m = b.match(/^==\s*(.+?)\s*==$/))) out.push({ t: 'h4', text: m[1] });
    else if (b.toLowerCase() === (title || '').toLowerCase() || /^[A-Z0-9 ,()'’\-/&]+(\s\((MUSCLE|BONE)\))?$/.test(b) && b.length < 70) continue;
    else out.push({ t: 'p', text: b });
  }
  return out;
}
function fmtDesc(text, title) {
  const box = el('div', { className: 'desc' });
  for (const b of descBlocks(text, title)) box.append(el(b.t, {}, b.text));
  return box;
}
const plainDesc = (text, title) => descBlocks(text, title).map((b) => (b.t === 'p' ? b.text : `${b.text}.`)).join(' ');
function crumbs(rec) {
  const chain = []; let g = S.groups.get(rec.group);
  while (g) { chain.unshift(g); g = S.groups.get(g.parent); }
  const root = chain[0] && chain[0].name.toLowerCase().includes((SYS[rec.system]?.[0] || '').split(' ')[0].toLowerCase()) ? 1 : 0;
  return chain.slice(root);
}
// ------------------------------------------------------------ info tabs --
// The info panel is a header (name, pills, actions) plus tabs. Built-in tabs are registered below; the motion module
// adds "Motion" through atlas.registerTab. A tab is { id, label, order, applies(sib) -> bool, render(sib, host, ctx) }.
const TABS = [];
function registerTab(t) {
  const i = TABS.findIndex((x) => x.id === t.id); if (i >= 0) TABS.splice(i, 1);
  TABS.push(t); TABS.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  if (S.cur && S.M) showInfo(siblingsOf(S.cur));
}
const NOT_A_MUSCLE = /bursa|retinaculum|sheath|aponeurosis|tendon|fascia|septum|ligament|membrane|arch\b|tract|linea alba|trochlea|tarsus|pulley|ring/i;
const isMuscle = (rec) => rec.system === 'muscular' && !NOT_A_MUSCLE.test(rec.name);

// muscle facts: origin / insertion / action / innervation, kept short. Curated table first, then a best-effort extract of the article.
let factsP = null, vocabP = null;
const loadFacts = () => (factsP ||= fetch(`${CFG.dataBase}muscles.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
const loadVocab = () => (vocabP ||= fetch(`${CFG.dataBase}vocab.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
function resolveFacts(F, name) {
  let f = F[name], hops = 0;
  while (typeof f === 'string' && hops++ < 4) f = F[f];   // "Long head of biceps brachii": "Biceps brachii muscle"
  return f && typeof f === 'object' ? f : null;
}
const clip = (t, n = 150) => { t = t.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/[\s,;:(]+\S*$/, '') + '…' : t; };
function extractFacts(text) {
  const sents = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 400);
  const pick = (re) => { const s = sents.find((x) => re.test(x)); return s ? [clip(s)] : null; };
  return { o: pick(/\b(originates?|arises?|takes (its )?origin|origin)\b/i), i: pick(/\b(inserts?|insertion|inserted|attaches|attached)\b/i),
    a: pick(/\b(flexes|extends|abducts|adducts|rotates|elevates|depresses|function|action|moves|draws|pulls|tenses|acts)\b/i),
    n: pick(/\b(innervated|innervation|nerve supply|supplied by|nerve)\b/i), auto: true };
}
const FACT_ROWS = [['o', 'O', 'Origin'], ['i', 'I', 'Insertion'], ['a', 'A', 'Action'], ['n', 'N', 'Nerve']];
function renderFacts(sib, host, ctx) {
  const rec = sib[0];
  host.replaceChildren(el('p', { className: 'fine' }, 'Loading…'));
  Promise.all([loadFacts(), loadVocab()]).then(async ([F, V]) => {
    let f = resolveFacts(F, rec.name);
    if (!f) f = extractFacts((await descFor(rec.system))[rec.name] || '');
    if (!ctx.isCurrent()) return;
    const card = el('dl', { className: 'facts' });
    for (const [k, badge, label] of FACT_ROWS) {
      const v = [].concat(f[k] || []);
      card.append(el('div', { className: 'frow' }, el('dt', {}, el('b', {}, badge), label),
        el('dd', {}, v.length ? v.map((x) => el('span', { className: 'fv' }, x)) : el('span', { className: 'none' }, 'Not listed'))));
    }
    host.replaceChildren(card);
    const acts = f.acts || [];
    if (acts.length) {
      host.append(el('h3', {}, 'Moves the body at'));
      host.append(el('div', { className: 'chips' }, acts.map(([j, m, role]) => {
        const jl = V.joints?.[j]?.label?.replace(/ \(.*\)| joint$/g, '') || j, ml = V.movementLabels?.[m] || m;
        return el('button', { className: 'chip' + (role === 'P' ? ' prime' : ''), type: 'button', title: `${role === 'P' ? 'Prime mover' : 'Assists'}: ${ml.toLowerCase()} at the ${jl.toLowerCase()}. Click to animate.`,
          onclick: () => openMotion({ joint: j, movement: m, muscle: rec.name }) }, el('i', {}, '▶'), `${jl} · ${ml.toLowerCase()}`);
      })));
      host.append(el('p', { className: 'fine' }, 'Solid = prime mover, outline = assists. Click to see the movement in 3D.'));
    }
    const hasAtt = S.M.structures.some((r) => r.system === 'insertions' && r.name === rec.name);
    host.append(el('div', { className: 'actions' },
      hasAtt ? el('button', { className: 'btn', type: 'button', onclick: () => showAttachments(sib) }, 'Show attachments on skeleton') : null,
      el('button', { className: 'btn', type: 'button', onclick: () => { S.tab = 'text'; showInfo(sib); } }, 'Read full text')));
    if (f.auto) host.append(el('p', { className: 'fine' }, 'Auto-extracted from the article; no curated entry for this structure yet.'));
    else host.append(el('p', { className: 'fine' }, 'Standard textbook values; variants exist.'));
  });
}
function openMotion(req) {
  atlas.pendingMotion = req;
  const rec = S.cur;
  if (rec && TABS.some((t) => t.id === 'motion' && t.applies(siblingsOf(rec)))) { S.tab = 'motion'; showInfo(siblingsOf(rec)); }
  else if (atlas.motion?.open) atlas.motion.open(req);
  else notify('Motion animations are still loading…');
}
async function showAttachments(sib) {
  const ids = sib.map((r) => r.id);
  for (const r of S.M.structures) if (r.system === 'insertions' && r.name === sib[0].name) ids.push(r.id);
  S.sel = new Set(ids); S.ghost = true;
  await Promise.all(['insertions', 'skeletal'].map((k) => (S.sys.get(k)?.visible ? loadSystem(k) : setSystemVisible(k, true))));
  restyle(); markTree(); focusRecs(selectionRecs());
}
function renderText(sib, host, ctx) {
  const rec = sib[0];
  const ids = new Set(sib.map((r) => r.id));
  const lms = S.M.landmarks.filter((l) => ids.has(l.target));
  const seen = new Set(), uniq = lms.filter((l) => (seen.has(l.name + l.side) ? false : seen.add(l.name + l.side)));
  if (uniq.length) {
    host.append(el('h3', {}, `Landmarks (${uniq.length})`));
    host.append(el('div', { className: 'lm-list' }, uniq.slice(0, 60).map((l) => el('button', { onclick: () => showLandmark(l) }, l.name))));
  }
  const holder = el('div', {}, el('h3', {}, 'Description'), el('p', { className: 'fine' }, 'Loading…'));
  host.append(holder);
  descFor(rec.system).then((d) => {
    if (!ctx.isCurrent()) return;
    const t = d[rec.name];
    holder.replaceChildren(el('h3', {}, 'Description'), t ? fmtDesc(t, rec.name) : el('p', { className: 'fine' }, 'No description available for this structure.'),
      t ? el('p', { className: 'fine' }, 'Text: Wikipedia, CC BY-SA.') : null);
  });
}
registerTab({ id: 'facts', label: 'Facts', order: 10, applies: (sib) => isMuscle(sib[0]), render: renderFacts });
registerTab({ id: 'text', label: 'Description', order: 90, applies: () => true, render: renderText });

async function showInfo(sib) {
  stopSpeech();
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
    el('button', { className: 'btn', title: 'Show only this (I)', onclick: () => toggleIso() }, wholeOf(rec).length > sib.length ? 'Isolate whole muscle' : 'Isolate'),
    el('button', { className: 'btn', title: S.sel.size > sib.length ? 'Remove from the current multi-selection' : 'Add to a multi-selection to isolate several structures together', onclick: () => toggleInSelection(rec) }, S.sel.size > sib.length ? 'Remove from selection' : 'Add to selection'),
    el('button', { className: 'btn', onclick: () => { S.ghost = !S.ghost; restyle(); } }, 'Ghost others'),
    el('button', { className: 'btn', onclick: () => navigator.clipboard?.writeText(location.href) }, 'Copy link'),
    listenBtn(async () => `${nameOf(rec)}. ${plainDesc((await descFor(rec.system))[rec.name] || '', rec.name) || 'No written description is available for this structure yet.'}`,
      `Listen to the description of ${nameOf(rec)}`)));
  const tabs = TABS.filter((t) => t.applies(sib));
  const active = tabs.find((t) => t.id === S.tab) || tabs[0];
  if (tabs.length > 1) {
    box.append(el('div', { className: 'tabs', role: 'tablist' }, tabs.map((t) => el('button', {
      className: 'tab' + (t === active ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(t === active),
      onclick: () => { S.tab = t.id; showInfo(sib); },
    }, t.id === 'text' && isMuscle(rec) ? 'Full text' : t.label))));
  }
  const host = el('div', { className: 'tabpanel', role: 'tabpanel' }); box.append(host);
  box.append(buildExportSection());
  const info = $('#info'), top = info.scrollTop, same = info.dataset.cur === rec.id;
  info.replaceChildren(box); info.dataset.cur = rec.id; if (same) info.scrollTop = top;
  active.render(sib, host, { rec, isCurrent: () => S.cur === rec && info.contains(host), el, nameOf });
  window.dispatchEvent(new CustomEvent('atlas:select', { detail: { rec, sib, tab: active.id } }));
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
// A group (e.g. "Bones of pectoral girdle") is shared by several systems: the bones, but also the muscle attachments
// that sit on them. Every tree therefore filters by system, so each system only lists its own structures.
const openers = new Map(); // `${system}|${groupId}` -> open()
const itemsOf = (sys, gid) => S.items.get(`${sys}|${gid}`);
function countIn(sys, gid) {
  const key = `${sys}|${gid}`;
  if (S.counts.has(key)) return S.counts.get(key);
  let n = itemsOf(sys, gid)?.size || 0;
  for (const c of S.childGroups.get(gid) || []) n += countIn(sys, c.id);
  S.counts.set(key, n); return n;
}
function itemRow(name, recs) {
  const rec = recs[0];
  const b = el('button', { className: 'row leaf', type: 'button', title: name }, el('span', { className: 'chev' }, '›'), nameOf(rec));
  b.dataset.ids = recs.map((r) => r.id).join('|');
  const sides = [...new Set(recs.map((r) => r.side).filter(Boolean))];
  if (sides.length) b.append(el('span', { className: 'side-tag' }, sides.map((s) => s.toUpperCase()).join('·')));
  b.addEventListener('click', (e) => { (e.ctrlKey || e.metaKey || e.shiftKey) ? toggleInSelection(rec) : selectRec(rec); });
  return b;
}
function groupNode(g, sys) {
  const li = el('li'); const row = el('button', { className: 'row', type: 'button' }, el('span', { className: 'chev' }, '›'),
    S.lang === 'en' ? g.name : (S.i18n[g.name.toLowerCase()]?.[S.lang] || g.name), el('span', { className: 'n' }, String(countIn(sys, g.id))));
  row.dataset.gid = g.id;
  const ul = el('ul'); ul.hidden = true; let built = false;
  const open = (force) => {
    const want = force ?? ul.hidden;
    if (want && !built) { fillLevel(ul, g.id, sys); built = true; }
    ul.hidden = !want; row.classList.toggle('open', want);
  };
  openers.set(`${sys}|${g.id}`, open);
  row.addEventListener('click', (e) => {
    open();
    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleManyInSelection(groupStructures(sys, g.id));
    else selectGroup(g, sys);
  });
  li.append(row, ul); return li;
}
function groupStructures(sys, gid) {
  const out = [], m = itemsOf(sys, gid);
  if (m) for (const recs of m.values()) out.push(...recs);
  for (const c of S.childGroups.get(gid) || []) out.push(...groupStructures(sys, c.id));
  return out;
}
async function selectGroup(g, sys) {
  stopSpeech();
  const recs = groupStructures(sys, g.id);
  if (!recs.length) return;
  S.cur = null; S.curLm = null; S.sel = new Set(recs.map((r) => r.id));
  if (!S.sys.get(sys)?.visible) await setSystemVisible(sys, true); else await loadSystem(sys);
  restyle(); markTree(); if (S.iso) focusRecs(recs);
  const color = SYS[sys]?.[1] || '#888', chain = []; let p = S.groups.get(g.parent);
  while (p) { chain.unshift(p); p = S.groups.get(p.parent); }
  const gname = (x) => (S.lang === 'en' ? x.name : (S.i18n[x.name.toLowerCase()]?.[S.lang] || x.name));
  const box = el('div', { style: `--dot:${color}` }, el('h2', {}, gname(g)));
  if (chain.length > 1) box.append(el('div', { className: 'crumbs' }, chain.slice(1).flatMap((c) => [gname(c), ' › ']), gname(g)));
  box.append(el('div', { className: 'pills' }, el('span', { className: 'pill sys' }, SYS[sys]?.[0] || sys), el('span', { className: 'pill' }, `${recs.length} structures`)));
  box.append(el('div', { className: 'actions' },
    el('button', { className: 'btn primary', onclick: () => focusRecs(recs) }, 'Focus'),
    el('button', { className: 'btn', onclick: () => toggleIso() }, 'Isolate'),
    el('button', { className: 'btn', title: 'Add every structure in this group to a multi-selection', onclick: () => toggleManyInSelection(recs) }, 'Add group to selection'),
    el('button', { className: 'btn', onclick: () => { S.ghost = !S.ghost; restyle(); } }, 'Ghost others'),
    el('button', { className: 'btn', onclick: clearSel }, 'Clear')));
  const holder = el('div', {}); box.append(holder);
  box.append(buildExportSection());
  $('#info').replaceChildren(box);
  const t = (await descFor(g.system))[g.name];
  if (t) {
    holder.append(el('h3', {}, 'Description'), fmtDesc(t, g.name), el('p', { className: 'fine' }, 'Text: Wikipedia, CC BY-SA.'),
      listenBtn(() => `${gname(g)}. ${plainDesc(t, g.name)}`, `Listen to the description of ${gname(g)}`));
  }
}
function appendItems(ul, sys, gid) {
  const m = itemsOf(sys, gid);
  if (!m) return;
  for (const n of [...m.keys()].sort((a, b) => a.localeCompare(b))) ul.append(el('li', {}, itemRow(n, m.get(n))));
}
function fillLevel(ul, gid, sys) {
  for (const g of S.childGroups.get(gid) || []) if (countIn(sys, g.id) > 0) ul.append(groupNode(g, sys)); // skips empty classification headings
  appendItems(ul, sys, gid);
}
function fillTop(ul, sys) {
  const roots = S.rootGroups.filter((g) => countIn(sys, g.id) > 0);
  if (roots.length === 1) fillLevel(ul, roots[0].id, sys); // a sole root heading is the system itself: show its children directly
  else for (const g of roots) ul.append(groupNode(g, sys));
  appendItems(ul, sys, ''); // structures that sit outside any group
}
// Shows a short spoken-friendly explanation of a whole category (body system) in the info panel; paired with
// the speaker button in the sidebar so a category can be introduced by ear before diving into its structures.
function showCategoryInfo(k) {
  stopSpeech();
  const [label, color] = SYS[k] || [k, '#888'];
  const box = el('div', { className: 'empty', style: `--dot:${color}` }, el('h2', {}, label));
  box.append(listenBtn(() => SYS_BLURB[k] || label, `Listen to an explanation of ${label}`));
  box.append(el('p', {}, SYS_BLURB[k] || 'No explanation is available yet for this category.'));
  $('#info').replaceChildren(box);
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
    const listen = el('button', { className: 'listen-ico', type: 'button', 'aria-pressed': 'false',
      title: `Listen to an explanation of ${label}`, 'aria-label': `Listen to an explanation of ${label}` }, speakerIcon());
    listen.addEventListener('click', () => {
      if (listen.classList.contains('speaking')) { stopSpeech(); return; }
      showCategoryInfo(k); speak(SYS_BLURB[k] || label, listen);
    });
    head.append(th, name, el('div', { className: 'sys-controls' }, eye, listen));
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
  document.querySelectorAll('.row.leaf').forEach((n) => {
    if (n.dataset.ids && n.dataset.ids.split('|').some((id) => S.sel.has(id))) n.classList.add('sel');
  });
}
function revealInTree(rec) {
  const li = document.querySelector(`.sys[data-key="${rec.system}"]`); if (!li || !li._ensureTree) return;
  li._ensureTree();
  const chain = []; let g = S.groups.get(rec.group);
  while (g) { chain.unshift(g.id); g = S.groups.get(g.parent); }
  for (const gid of chain) openers.get(`${rec.system}|${gid}`)?.(true);
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
    b.addEventListener('click', async (e) => {
      const target = it.kind === 'landmark' ? S.byId.get(it.lm.target) : r;
      if (e.ctrlKey || e.metaKey || e.shiftKey) { if (target) toggleInSelection(target); return; }
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
  const p = new URLSearchParams(); if (vis) p.set('s', vis); if (S.sel.size) p.set('sel', [...S.sel].join(',')); if (S.lang !== 'en') p.set('lang', S.lang);
  history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname + location.search);
}
async function restoreHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('lang')) { S.lang = p.get('lang'); $('#lang').value = S.lang; }
  const list = (p.get('s') || 'skeletal').split(',').filter((k) => S.M.systems.some((s) => s.key === k));
  await Promise.all(list.map((k) => setSystemVisible(k, true)));
  const ids = (p.get('sel') || '').split(',').filter(Boolean).map((id) => S.byId.get(id)).filter(Boolean);
  if (ids.length === 1) { await selectRec(ids[0]); revealInTree(ids[0]); }
  else if (ids.length > 1) selectMany(ids);
  else fitVisible();
}

// -------------------------------------------------------------------- init --
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'Escape') clearSel();
  else if (e.key === 'g' || e.key === 'G') { S.ghost = !S.ghost; restyle(); }
  else if (e.key === 'i' || e.key === 'I') toggleIso();
  else if (e.key === 'f' || e.key === 'F') { S.sel.size ? focusRecs([...S.sel].map((id) => S.byId.get(id))) : fitVisible(); }
  else if (e.key === 'l' || e.key === 'L') triggerListen();
});
$('#menuBtn').addEventListener('click', () => { const o = document.body.classList.toggle('nav-open'); $('#menuBtn').setAttribute('aria-expanded', o); });
$('#lang').addEventListener('change', () => { stopSpeech(); S.lang = $('#lang').value; buildSystems(); syncOn(); runSearch(); if (S.cur) showInfo(siblingsOf(S.cur)); saveHash(); });
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
  for (const g of S.M.groups) { S.groups.set(g.id, g); S.childGroups.set(g.id, []); }
  for (const g of S.M.groups) {
    if (g.parent && S.groups.has(g.parent)) S.childGroups.get(g.parent).push(g);
    else S.rootGroups.push(g);
  }
  for (const r of S.M.structures) {
    S.byId.set(r.id, r);
    const sk = `${r.system}|${r.group}|${r.name}`;
    if (!S.siblings.has(sk)) S.siblings.set(sk, []); S.siblings.get(sk).push(r);
    const ik = `${r.system}|${S.groups.has(r.group) ? r.group : ''}`;
    if (!S.items.has(ik)) S.items.set(ik, new Map());
    const m = S.items.get(ik); if (!m.has(r.name)) m.set(r.name, []); m.get(r.name).push(r);
    const pb = r.system === 'muscular' && partBase(r.name);
    if (pb) { const wk = `${r.system}|${pb}`; if (!S.wholes.has(wk)) S.wholes.set(wk, []); S.wholes.get(wk).push(r); }
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
  window.dispatchEvent(new CustomEvent('atlas:ready'));
}

// ---------------------------------------------------------------- public API --
// Everything the study (quiz) and motion modules may use. Those modules live in their own files (js/quiz.js, js/motion.js)
// and must not edit this one: wait for `await atlas.ready`, then use only what is listed here.
const atlas = window.atlas = {
  S, THREE, scene, camera, controls, renderer, canvas, stage, world, CFG, SYS,
  el, $, nameOf, latinOf, siblingsOf, notify, debounce,
  render: () => { dirty = true; },                       // ask for a redraw (after you moved a mesh / changed a material)
  onFrame: (fn) => { frameHooks.add(fn); return () => frameHooks.delete(fn); },       // fn(dt, nowMs) -> true if it changed the scene
  onAfterRender: (fn) => { afterHooks.add(fn); return () => afterHooks.delete(fn); }, // fn(rendered) after the draw: position DOM labels here
  project,                                               // project(THREE.Vector3, out?) -> { x, y, visible } in px relative to #stage
  loadSystem, setSystemVisible,                          // system keys: skeletal, joints, insertions, muscular, ...
  meshesOf: (id) => S.meshes.get(id) || [],              // meshes are only present once their system is loaded
  recsByName: (system, name) => S.M.structures.filter((r) => r.system === system && r.name === name),   // all sides / duplicates of a named structure
  selectRec, selectMany, clearSel, focusRecs, flyTo, restyle, setIso, toggleIso, selectionRecs, showInfo,
  toggleInSelection, toggleManyInSelection,              // build/shrink a multi-structure selection (isolate several tissue types together)
  wholeOf,                                               // wholeOf(rec) -> every record of the anatomical unit (all heads/parts, both sides of a paired name)
  groupStructures,                                       // groupStructures(system, groupId) -> records under that group, sub-groups included
  registerTab, openMotion, isMuscle, loadFacts, loadVocab,
  speak, stopSpeech, plainDesc,                          // text-to-speech: speak(text, btn?) toggles that button's "speaking" state
  movePinTo, rebuildPins,                                // keep a bone's landmark pins glued to it during an animation; rebuildPins() puts them back at rest
  pickHandler: null,    // set fn(rec|null, landmark|null, pointerEvent) to receive canvas clicks instead of the normal selection; hover names are suppressed while set
  pendingMotion: null,  // set by the muscle "Moves the body at" chips: { joint, movement, muscle }; the motion tab consumes it
  motion: null,         // motion.js assigns { open(req), play(...), stop() }
  quiz: null,           // quiz.js assigns its own API
  ready: null,
};
atlas.ready = init();
