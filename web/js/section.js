// Cross-section tool: cut the model with a sagittal, coronal or transverse plane and move it through the body, to see what
// lies inside at each level (imaging-style thinking). Built only on window.atlas.
//
// A global renderer clipping plane removes everything on one side; while cutting, materials render both faces so the cut
// shows the inside of each structure instead of an empty shell. Picking ignores the removed side (S.clipPlane in app.js).
// The state is part of the shareable link: #cut=<axis><position 0-1>[f]  e.g. cut=y0.620 (transverse, 62% of the height).
const atlas = window.atlas;
await (atlas?.ready ?? Promise.reject(new Error('atlas API missing')));
const { S, THREE, renderer, scene, $ } = atlas;
// element helper that sets attributes (aria-*, data-*, role) rather than properties
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};

// the plane keeps the side its normal points to: by default the part nearer the default camera / viewer is removed
const AXES = {
  x: { label: 'Sagittal', key: 'S', normal: [-1, 0, 0], hint: 'Cuts left from right; view from the left side' },
  z: { label: 'Coronal', key: 'C', normal: [0, 0, -1], hint: 'Cuts front from back; view from the front' },
  y: { label: 'Transverse', key: 'T', normal: [0, -1, 0], hint: 'Cuts top from bottom; view from above' },
};
const ST = { on: false, axis: 'y', pos: 0.62, flip: false };
const plane = new THREE.Plane();

// body bounds from the manifest (all structures), so the slider spans the whole body whatever is loaded
const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
for (const r of S.M.structures) { lo.min(new THREE.Vector3(...r.min)); hi.max(new THREE.Vector3(...r.max)); }
const coord = (axis, f) => lo[axis] + (hi[axis] - lo[axis]) * f;

// outline of the cutting plane, drawn just on the kept side so it is never clipped itself
const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.85 }));
outline.visible = false; outline.renderOrder = 10; scene.add(outline);

function corners(axis, v) {
  const a = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }[axis], pad = 0.04, pts = [];
  for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const p = new THREE.Vector3(); p[axis] = v;
    p[a[0]] = (s ? hi[a[0]] + pad : lo[a[0]] - pad); p[a[1]] = (t ? hi[a[1]] + pad : lo[a[1]] - pad);
    pts.push(p);
  }
  return pts;
}

// ---------------------------------------------------- both faces while cut -
const touched = new Set();
function doubleSide(on) {
  const set = (m) => {
    if (!m || m.side === undefined) return;
    if (on && m.side !== THREE.DoubleSide) { m.userData.side0 ??= m.side; m.side = THREE.DoubleSide; m.needsUpdate = true; touched.add(m); }
    if (!on && m.userData.side0 !== undefined) { m.side = m.userData.side0; delete m.userData.side0; m.needsUpdate = true; }
  };
  if (on) { for (const list of S.meshes.values()) for (const mesh of list) { set(mesh.material); set(mesh.userData.m0); } }
  else { for (const m of touched) set(m); touched.clear(); }
}
let tick = 0;
// materials are swapped by selection styling and new systems load later: keep them double-sided while cutting
atlas.onFrame(() => { if (ST.on && ++tick % 20 === 0) doubleSide(true); return false; });

// ---------------------------------------------------------------- apply ----
function apply() {
  if (ST.on) {
    const v = coord(ST.axis, ST.pos), n = new THREE.Vector3(...AXES[ST.axis].normal).multiplyScalar(ST.flip ? -1 : 1);
    const p = new THREE.Vector3(); p[ST.axis] = v;
    plane.setFromNormalAndCoplanarPoint(n, p);
    renderer.clippingPlanes = [plane]; S.clipPlane = plane;
    outline.geometry.setFromPoints(corners(ST.axis, v + n.getComponent('xyz'.indexOf(ST.axis)) * 0.0008));
    outline.visible = UI.showPlane.checked;
    doubleSide(true);
  } else {
    renderer.clippingPlanes = []; S.clipPlane = null; outline.visible = false;
    doubleSide(false);
  }
  btn.setAttribute('aria-pressed', String(ST.on));
  panel.hidden = !ST.on;
  syncUI();
  atlas.render(); atlas.saveHash();
}
function viewAlong() {   // turn the camera to face the cut surface: it looks from the removed side towards the kept one
  const t = atlas.controls.target, d = atlas.camera.position.distanceTo(t);
  atlas.flyTo(t.clone(), d / 2.6, plane.normal.clone().negate());
}

// ------------------------------------------------------------------- UI ----
const btn = el('button', { id: 'sectionBtn', type: 'button', 'aria-pressed': 'false', title: 'Cross-section: cut through the body (X)' }, 'Section');
$('.toolbar')?.insertBefore(btn, $('#clearBtn'));
const UI = {};
const panel = el('div', { id: 'sectionPanel', className: 'sec-panel', role: 'group', 'aria-label': 'Cross-section controls', hidden: true });
UI.axes = el('div', { className: 'seg sec-axes', role: 'radiogroup', 'aria-label': 'Plane' }, Object.entries(AXES).map(([k, a]) =>
  el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', title: a.hint, 'data-axis': k, onclick: () => { ST.axis = k; apply(); } }, a.label)));
UI.slider = el('input', { type: 'range', min: 0, max: 1000, step: 1, className: 'sec-slider', 'aria-label': 'Position of the cutting plane' });
UI.slider.addEventListener('input', () => { ST.pos = UI.slider.value / 1000; apply(); });
UI.level = el('span', { className: 'sec-level', 'aria-live': 'polite' });
UI.showPlane = el('input', { type: 'checkbox', checked: true, onchange: () => apply() });
panel.append(
  el('div', { className: 'sec-row' }, el('b', {}, 'Cross-section'), UI.axes,
    el('button', { type: 'button', className: 'sec-x', title: 'Close the cross-section (X)', 'aria-label': 'Close the cross-section', onclick: () => { ST.on = false; apply(); } }, '×')),
  el('div', { className: 'sec-row' }, UI.slider, UI.level),
  el('div', { className: 'sec-row' },
    el('button', { type: 'button', className: 'btn', title: 'Keep the other side of the plane', onclick: () => { ST.flip = !ST.flip; apply(); } }, 'Flip side'),
    el('button', { type: 'button', className: 'btn', title: 'Turn the camera to face the cut', onclick: viewAlong }, 'Face the cut'),
    el('label', { className: 'check' }, UI.showPlane, ' Plane outline')));
$('#stage').append(panel);

function syncUI() {
  for (const b of UI.axes.children) b.setAttribute('aria-checked', String(b.dataset.axis === ST.axis));
  UI.slider.value = Math.round(ST.pos * 1000);
  const v = coord(ST.axis, ST.pos);
  // describe the level in words: height from the floor, or distance left / right / in front of the midline
  UI.level.textContent = ST.axis === 'y' ? `${Math.round(v * 100)} cm from the floor`
    : ST.axis === 'x' ? (Math.abs(v) < 0.005 ? 'midline' : `${Math.round(Math.abs(v) * 100)} cm ${v > 0 ? 'left' : 'right'} of midline`)
      : Math.abs(v) < 0.005 ? 'centre of the body (front to back)' : `${Math.round(Math.abs(v) * 100)} cm ${v > 0 ? 'in front of' : 'behind'} the body's centre`;
}
btn.addEventListener('click', () => {
  if (ST.on && document.body.classList.contains('lesson-open') && getComputedStyle(panel).display === 'none') { panel.style.display = 'grid'; return; }   // phones hide it during lessons
  panel.style.display = ''; ST.on = !ST.on; apply(); if (ST.on) atlas.notify(`${AXES[ST.axis].label} section — drag the slider to move through the body`); });
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'x' || e.key === 'X') { ST.on = !ST.on; apply(); }
});

atlas.registerHashPart({
  key: 'cut',
  get: () => (ST.on ? `${ST.axis}${ST.pos.toFixed(3)}${ST.flip ? 'f' : ''}` : ''),
  set: (v) => {
    const m = /^([xyz])([0-9.]+)(f?)$/.exec(v || '');
    if (!m) return;
    Object.assign(ST, { on: true, axis: m[1], pos: Math.min(1, Math.max(0, +m[2])), flip: !!m[3] });
    apply();
  },
});
atlas.section = {
  get: () => ({ ...ST }),
  set: (o) => { Object.assign(ST, o); apply(); },   // { on, axis: 'x'|'y'|'z', pos: 0..1, flip }
  levelOf: coord,                                   // levelOf(axis, 0..1) -> coordinate in metres
};
syncUI();
