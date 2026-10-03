// Saved views and annotations: save what is on screen (systems, selection, ghost / isolate, cross-section, camera) with a
// note, reopen it later, or share it as a link; place labelled note pins on the model. Built only on window.atlas.
//
// Link parameters added here: cam=<px,py,pz,tx,ty,tz> (camera position + target), note=<text>, pins=<x~y~z~label|...>.
// Saved views live in this browser (localStorage); a link carries the same state to anyone.
const atlas = window.atlas;
await (atlas?.ready ?? Promise.reject(new Error('atlas API missing')));
const { S, THREE, camera, controls, canvas, $ } = atlas;

const KEY = 'zatlas.views.v1', MAX_PINS = 20, MAX_NOTE = 600;
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const store = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } };
let views = load();

// ----------------------------------------------------------------- camera ---
const r4 = (x) => Math.round(x * 10000) / 10000;
const camString = () => [...camera.position.toArray(), ...controls.target.toArray()].map(r4).join(',');
function applyCam(v) {
  const n = String(v || '').split(',').map(Number);
  if (n.length !== 6 || n.some((x) => !Number.isFinite(x))) return;
  const pos = new THREE.Vector3(n[0], n[1], n[2]), tgt = new THREE.Vector3(n[3], n[4], n[5]);
  // flyTo frames a sphere; pick the radius that lands the camera exactly at the saved distance
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const radius = (pos.distanceTo(tgt) * Math.sin(Math.min(vHalf, hHalf))) / 1.15;
  atlas.flyTo(tgt, radius, pos.clone().sub(tgt));
}

// ------------------------------------------------------------------- pins ---
let pins = [];   // { p: Vector3, label }
const layer = el('div', { className: 'vpins', 'aria-hidden': 'false' });
$('#stage').append(layer);
const _v = new THREE.Vector3(), _o = {};
atlas.onAfterRender(() => {
  if (!pins.length) { if (layer.childElementCount) layer.replaceChildren(); return; }
  if (layer.childElementCount !== pins.length) layer.replaceChildren(...pins.map((p, i) => el('div', { className: 'vpin', title: p.label }, el('i', {}, String(i + 1)), el('span', {}, p.label))));
  pins.forEach((p, i) => {
    const node = layer.children[i], o = atlas.project(_v.copy(p.p), _o);
    const hidden = !o.visible || (S.clipPlane && S.clipPlane.distanceToPoint(p.p) < -0.001);
    node.style.display = hidden ? 'none' : '';
    if (!hidden) node.style.transform = `translate(${o.x}px, ${o.y}px)`;
    node.querySelector('span').textContent = p.label;
  });
});
const pinsString = () => pins.map((p) => [...p.p.toArray().map(r4), p.label.replace(/[|~]/g, ' ')].join('~')).join('|');
function setPins(v) {
  pins = String(v || '').split('|').filter(Boolean).slice(0, MAX_PINS).map((s) => {
    const [x, y, z, ...l] = s.split('~');
    return { p: new THREE.Vector3(+x, +y, +z), label: l.join(' ').slice(0, 80) || 'Note' };
  }).filter((p) => [p.p.x, p.p.y, p.p.z].every(Number.isFinite));
  layer.replaceChildren(); atlas.render(); renderPanel();
}
// place a pin where the next click hits the model (the cut-away side of a cross-section does not count)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitPoint(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const roots = [...S.sys.values()].filter((s) => s.visible && s.loaded).map((s) => s.group);
  return ray.intersectObjects(roots, true).find((h) => h.object.isMesh && h.object.visible && h.object.material.opacity > 0.2 &&
    (!S.clipPlane || S.clipPlane.distanceToPoint(h.point) >= 0)) || null;
}
let placing = false, prevHandler = null;
function startPlacing() {
  if (pins.length >= MAX_PINS) { atlas.notify(`At most ${MAX_PINS} pins`); return; }
  placing = true; prevHandler = atlas.pickHandler;
  atlas.pickHandler = (rec, lm, e) => {
    const hit = hitPoint(e);
    if (!hit) { atlas.notify('Click on a structure to place the pin'); return; }
    const near = S.byId.get(hit.object.userData.zid);
    pins.push({ p: hit.point.clone(), label: near ? atlas.nameOf(near) : `Note ${pins.length + 1}` });
    stopPlacing(); atlas.saveHash(); atlas.render(); open(true);
    panel.querySelector('.vpin-row:last-child input')?.select();
  };
  canvas.classList.add('placing'); atlas.notify('Click on the model to place a note pin (Esc to cancel)'); renderPanel();
}
function stopPlacing() { if (!placing) return; placing = false; atlas.pickHandler = prevHandler; prevHandler = null; canvas.classList.remove('placing'); renderPanel(); }

// ------------------------------------------------------------------- note ---
let note = '';
const noteCard = el('aside', { className: 'vnote', hidden: true, 'aria-label': 'Note for this view' });
$('#stage').append(noteCard);
function showNote(text) {
  note = String(text || '').slice(0, MAX_NOTE);
  noteCard.hidden = !note;
  noteCard.replaceChildren(el('b', {}, 'Note'), el('p', {}, note),
    el('button', { type: 'button', className: 'vnote-x', 'aria-label': 'Hide note', title: 'Hide note', onclick: () => { showNote(''); atlas.saveHash(); } }, '×'));
}


// --------------------------------------------------------------- the link ---
function linkFor(extra = {}) {
  atlas.saveHash();
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('cam', camString());
  for (const [k, v] of Object.entries(extra)) { if (v) p.set(k, v); else p.delete(k); }
  return `${location.origin}${location.pathname}#${p}`;
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); atlas.notify(okMsg); }
  catch { history.replaceState(null, '', text.slice(text.indexOf('#'))); atlas.notify('Copying is blocked here: the link is now in the address bar'); }
}
async function openView(v) {
  const p = new URLSearchParams(v.hash);
  history.replaceState(null, '', `#${p}`);
  // apply everything the normal page load would: systems, selection, ghost / isolate, then the module parts
  for (const k of [...S.sys.keys()]) if (!(p.get('s') || '').split(',').includes(k) && S.sys.get(k).visible) await atlas.setSystemVisible(k, false);
  for (const k of (p.get('s') || 'skeletal').split(',')) if (S.sys.has(k) || S.M.systems.some((s) => s.key === k)) await atlas.setSystemVisible(k, true);
  const recs = (p.get('sel') || '').split(',').map((id) => S.byId.get(id)).filter(Boolean);
  if (recs.length && atlas.isOneStructure(recs)) await atlas.selectRec(recs[0], { focus: false }); else if (recs.length) atlas.selectMany(recs); else atlas.clearSel();
  S.ghost = p.get('g') === '1'; if (p.get('i') === '1' && S.sel.size) atlas.setIso(true); else { S.iso = false; atlas.restyle(); }
  atlas.section?.set(/^([xyz])([0-9.]+)(f?)$/.test(p.get('cut') || '') ? { on: true, axis: p.get('cut')[0], pos: +p.get('cut').slice(1).replace('f', ''), flip: p.get('cut').endsWith('f') } : { on: false });
  setPins(p.get('pins') || ''); showNote(p.get('note') || '');
  applyCam(p.get('cam'));
  atlas.saveHash();
}

// ------------------------------------------------------------------ panel ---
const btn = el('button', { id: 'viewsBtn', className: 'mode-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'viewsPanel', title: 'Save, share and annotate views' }, 'Views');
$('#studyBtn')?.before(btn);
const panel = el('section', { id: 'viewsPanel', className: 'vpanel', hidden: true, 'aria-label': 'Saved views and notes' });
document.body.append(panel);
const suggestName = () => (S.cur ? atlas.nameOf(S.cur) : S.sel.size ? `${S.sel.size} structures` : `View ${views.length + 1}`);
function renderPanel() {
  if (panel.hidden) return;
  const name = el('input', { type: 'text', className: 'vin', maxlength: '80', value: suggestName(), 'aria-label': 'Name of the view' });
  const text = el('textarea', { className: 'vin', rows: '2', maxlength: String(MAX_NOTE), placeholder: 'Note (optional): shown to whoever opens the link', 'aria-label': 'Note' });
  text.value = note;
  const save = () => {
    const v = { id: Date.now().toString(36), name: name.value.trim() || suggestName(), note: text.value.trim(), ts: Date.now(),
      hash: new URLSearchParams(linkFor({ note: text.value.trim() }).split('#')[1]).toString() };
    views = [v, ...views].slice(0, 50);
    atlas.notify(store(views) ? `Saved “${v.name}”` : 'Saved for this session only (browser storage is unavailable)');
    showNote(v.note); atlas.saveHash(); renderPanel();
  };
  panel.replaceChildren(
    el('header', { className: 'vhead' }, el('h2', {}, 'Views & notes'),
      el('button', { type: 'button', className: 'vnote-x', 'aria-label': 'Close', onclick: () => open(false) }, '×')),
    el('div', { className: 'vbody' },
      el('h3', {}, 'This view'), name, text,
      el('div', { className: 'vrow' },
        el('button', { type: 'button', className: 'btn primary', onclick: save }, 'Save view'),
        el('button', { type: 'button', className: 'btn', onclick: () => copy(linkFor({ note: text.value.trim() }), 'Link to this view copied') }, 'Copy link')),
      el('h3', {}, `Note pins (${pins.length})`),
      pins.length ? el('div', { className: 'vpin-list' }, pins.map((p, i) => el('div', { className: 'vpin-row' }, el('b', {}, String(i + 1)),
        el('input', { type: 'text', className: 'vin', maxlength: '80', value: p.label, 'aria-label': `Label of pin ${i + 1}`, oninput: (e) => { p.label = e.target.value || 'Note'; atlas.render(); }, onchange: () => atlas.saveHash() }),
        el('button', { type: 'button', className: 'vnote-x', 'aria-label': `Remove pin ${i + 1}`, onclick: () => { pins.splice(i, 1); layer.replaceChildren(); atlas.saveHash(); atlas.render(); renderPanel(); } }, '×')))) : null,
      el('div', { className: 'vrow' },
        el('button', { type: 'button', className: 'btn', 'aria-pressed': String(placing), onclick: () => (placing ? stopPlacing() : startPlacing()) }, placing ? 'Click the model… (cancel)' : 'Add note pin'),
        pins.length ? el('button', { type: 'button', className: 'btn', onclick: () => { setPins(''); atlas.saveHash(); } }, 'Clear pins') : null),
      el('h3', {}, `Saved views (${views.length})`),
      views.length ? el('ul', { className: 'vlist', role: 'list' }, views.map((v) => el('li', {},
        el('div', { className: 'vmeta' }, el('b', {}, v.name), el('small', {}, new Date(v.ts).toLocaleDateString()), v.note ? el('small', { className: 'vprev' }, v.note) : null),
        el('div', { className: 'vrow' },
          el('button', { type: 'button', className: 'btn', onclick: () => openView(v) }, 'Open'),
          el('button', { type: 'button', className: 'btn', onclick: () => copy(`${location.origin}${location.pathname}#${v.hash}`, 'Link copied') }, 'Link'),
          el('button', { type: 'button', className: 'btn', 'aria-label': `Delete ${v.name}`, onclick: () => { views = views.filter((x) => x !== v); store(views); renderPanel(); } }, 'Delete')))))
        : el('p', { className: 'fine' }, 'Saved views stay in this browser. Use “Copy link” to share one.')));
}
function open(on) {
  panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); btn.classList.toggle('on', on);
  if (on) { renderPanel(); panel.querySelector('input')?.focus({ preventScroll: true }); } else stopPlacing();
}
btn.addEventListener('click', () => open(panel.hidden));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (placing) { stopPlacing(); e.stopPropagation(); } else if (!panel.hidden && panel.contains(document.activeElement)) { open(false); btn.focus(); }
}, true);

atlas.views = { list: () => views, open: openView, link: linkFor, pins: () => pins, setPins, note: () => note, showNote };
// registered last: on a page opened from a link these apply immediately and need the panel above
atlas.registerHashPart({ key: 'pins', get: () => (pins.length ? pinsString() : ''), set: setPins });
atlas.registerHashPart({ key: 'note', get: () => note, set: showNote });
atlas.registerHashPart({ key: 'cam', get: () => '', set: (v) => setTimeout(() => applyCam(v), 700) });   // after the selection's own fly-to
