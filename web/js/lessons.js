// Guided lessons: short, region-based walkthroughs that set up the 3D scene step by step (systems, highlighted structures,
// camera, cross-section, motion) beside a concise explanation, and end with a matching quiz. Built only on window.atlas.
//
// Data: data/lessons.json (see its _about). Progress is kept in this browser; #lesson=<id>.<step> links to a step.
const atlas = window.atlas;
await (atlas?.ready ?? Promise.reject(new Error('atlas API missing')));
const { S, THREE, $ } = atlas;

const DATA = await fetch(`${atlas.CFG.dataBase}lessons.json`).then((r) => (r.ok ? r.json() : { lessons: [] })).catch(() => ({ lessons: [] }));
const LESSONS = DATA.lessons || [];
const KEY = 'zatlas.lessons.v1';
let progress = {};
try { progress = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* storage unavailable: progress lasts for this visit */ }
const saveProgress = () => { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* ignore */ } };
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const VIEWS = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0.08] };

// --------------------------------------------------------- scene per step --
// structure names, or "group:<system>:<group id>"; a side limits paired structures to that side (midline ones always stay)
function resolve(step) {
  const out = [];
  for (const item of step.select || []) {
    let recs;
    if (item.startsWith('group:')) { const [, sys, gid] = item.split(':'); recs = atlas.groupStructures(sys, gid.includes('.g') ? gid : `${gid}.g`); }
    else recs = S.M.structures.filter((r) => r.name === item && (!step.systems || step.systems.includes(r.system)));
    if (step.side) recs = recs.filter((r) => !r.side || r.side === step.side);
    out.push(...recs);
  }
  return [...new Map(out.map((r) => [r.id, r])).values()];
}
function frameRecs(recs, step) {
  const dir = new THREE.Vector3(...(Array.isArray(step.view) ? step.view : VIEWS[step.view] || VIEWS.front)).normalize();
  const box = new THREE.Box3();
  if (recs.length) for (const r of recs) { box.expandByPoint(new THREE.Vector3(...r.min)); box.expandByPoint(new THREE.Vector3(...r.max)); }
  else {   // nothing highlighted: frame the trunk around the cutting plane, or the whole body
    const cut = step.cut, lo = new THREE.Vector3(-0.25, 0.75, -0.2), hi = new THREE.Vector3(0.25, 1.55, 0.2);
    if (cut?.axis === 'y') { const y = atlas.section?.levelOf?.('y', cut.pos) ?? 1.2; lo.y = y - 0.18; hi.y = y + 0.18; }
    box.set(lo, hi);
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  atlas.flyTo(sphere.center, Math.max(sphere.radius, 0.03) * (step.zoom || 1), dir);
}
async function applyStep(lesson, i) {
  const step = lesson.steps[i];
  atlas.motion?.stop?.();
  if (atlas.quiz?.isOpen?.()) await atlas.quiz.close();
  const want = new Set(step.systems || ['skeletal']);
  for (const s of S.M.systems) {
    const on = want.has(s.key), vis = !!S.sys.get(s.key)?.visible;
    if (on !== vis) await atlas.setSystemVisible(s.key, on);
  }
  await Promise.all([...want].map((k) => atlas.loadSystem(k)));
  atlas.section?.set(step.cut ? { on: true, axis: step.cut.axis, pos: step.cut.pos, flip: !!step.cut.flip } : { on: false });
  const recs = resolve(step);
  S.ghost = !!step.ghost;
  if (recs.length && atlas.isOneStructure(recs)) await atlas.selectRec(recs[0], { focus: false });
  else if (recs.length) { S.cur = null; S.sel = new Set(recs.map((r) => r.id)); S.iso = !!step.iso; atlas.restyle(); infoFor(lesson, step, recs); }
  else atlas.clearSel();
  frameRecs(recs, step);
  if (step.motion) setTimeout(() => { if (cur && cur.lesson === lesson && cur.i === i) atlas.motion?.open?.({ ...step.motion, side: step.side || 'l' }); }, reduced() ? 50 : 900);
  progress[lesson.id] = { step: i, done: progress[lesson.id]?.done || i === lesson.steps.length - 1 };
  saveProgress(); atlas.saveHash();
}
// info panel while several structures are highlighted: a clickable list, so each can be opened for its details
function infoFor(lesson, step, recs) {
  const names = [...new Map(recs.map((r) => [r.name, r])).values()].sort((a, b) => atlas.nameOf(a).localeCompare(atlas.nameOf(b)));
  $('#info').replaceChildren(el('div', { className: 'empty' },
    el('h2', {}, step.title), el('p', {}, `Highlighted in this step of “${lesson.title}”. Open any structure for its facts and description.`),
    el('div', { className: 'kchips lchips' }, names.map((r) => el('button', { type: 'button', className: 'kchip', onclick: () => atlas.selectRec(r) }, atlas.nameOf(r))))));
}

// ----------------------------------------------------------------- player --
let cur = null;   // { lesson, i }
const card = el('section', { className: 'lcard', hidden: true, 'aria-label': 'Lesson', 'aria-live': 'polite' });
$('#stage').append(card);
function renderCard() {
  if (!cur) { card.hidden = true; document.body.classList.remove('lesson-open'); return; }
  const { lesson, i } = cur, step = lesson.steps[i], last = i === lesson.steps.length - 1;
  document.body.classList.add('lesson-open'); card.hidden = false;
  card.replaceChildren(...[   // (replaceChildren would print a null as text)
    el('header', { className: 'lhead' },
      el('div', {}, el('small', {}, `${lesson.title} · step ${i + 1} of ${lesson.steps.length}`), el('h2', { tabindex: '-1' }, step.title)),
      el('button', { type: 'button', className: 'vnote-x', title: 'Exit the lesson', 'aria-label': 'Exit the lesson', onclick: exitLesson }, '×')),
    el('div', { className: 'ldots', role: 'presentation' }, lesson.steps.map((_, k) => el('i', { className: k === i ? 'on' : k < i ? 'done' : '' }))),
    el('p', { className: 'ltext' }, step.text),
    step.motion ? el('p', { className: 'fine' }, 'The movement plays on the model; use its caption to pause or close it.') : null,
    step.cut ? el('p', { className: 'fine' }, 'Move the cross-section slider to explore above and below this level.') : null,
    el('div', { className: 'lnav' },
      el('button', { type: 'button', className: 'btn', disabled: i === 0, onclick: () => go(i - 1) }, '‹ Back'),
      last ? el('button', { type: 'button', className: 'btn primary', onclick: () => finish() }, 'Finish') : el('button', { type: 'button', className: 'btn primary', 'data-next': '', onclick: () => go(i + 1) }, 'Next ›'))].filter(Boolean));
  card.querySelector('h2').focus({ preventScroll: true });
}
async function go(i) {
  if (!cur) return;
  cur.i = Math.max(0, Math.min(cur.lesson.steps.length - 1, i));
  renderCard();
  await applyStep(cur.lesson, cur.i);
}
function startLesson(lesson, i = 0) { openList(false); cur = { lesson, i }; go(i); }
function exitLesson() { atlas.motion?.stop?.(); cur = null; renderCard(); atlas.saveHash(); }
function finish() {
  const { lesson } = cur;
  progress[lesson.id] = { step: lesson.steps.length - 1, done: true }; saveProgress();
  card.replaceChildren(
    el('header', { className: 'lhead' }, el('div', {}, el('small', {}, lesson.title), el('h2', { tabindex: '-1' }, 'Lesson complete')),
      el('button', { type: 'button', className: 'vnote-x', 'aria-label': 'Close', onclick: exitLesson }, '×')),
    el('p', { className: 'ltext' }, 'Now test yourself: the quiz opens on the same topic, on the live model. Structures you answer come back for spaced review.'),
    el('div', { className: 'lnav' },
      el('button', { type: 'button', className: 'btn', onclick: () => go(0) }, 'Start again'),
      el('button', { type: 'button', className: 'btn', onclick: () => { exitLesson(); openList(true); } }, 'All lessons'),
      lesson.quiz && atlas.quiz ? el('button', { type: 'button', className: 'btn primary', onclick: () => testYourself(lesson) }, 'Test yourself') : null));
  card.querySelector('h2').focus({ preventScroll: true });
}
async function testYourself(lesson) {
  const q = lesson.quiz; exitLesson();
  await atlas.quiz.open();
  const sec = atlas.quiz.sections().find((s) => s.key === q.section); if (!sec) return;
  Object.assign(atlas.quiz.state().cfg, { mode: q.mode || 'identify', group: q.group || '', level: q.level || 'all', exam: false });
  atlas.quiz.select(sec);
}

// ------------------------------------------------------------------- list --
const btn = el('button', { id: 'learnBtn', className: 'mode-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'lessonsPanel', title: 'Guided lessons' }, 'Learn');
($('#viewsBtn') || $('#studyBtn'))?.before(btn);
const panel = el('section', { id: 'lessonsPanel', className: 'vpanel', hidden: true, 'aria-label': 'Guided lessons' });
document.body.append(panel);
function renderList() {
  panel.replaceChildren(
    el('header', { className: 'vhead' }, el('h2', {}, 'Guided lessons'), el('button', { type: 'button', className: 'vnote-x', 'aria-label': 'Close', onclick: () => openList(false) }, '×')),
    el('div', { className: 'vbody' },
      el('p', { className: 'fine' }, 'Each lesson walks through a region on the 3D model in a few short steps, then offers a quiz on the same topic.'),
      el('ul', { className: 'vlist', role: 'list' }, LESSONS.map((l) => {
        const p = progress[l.id];
        return el('li', {},
          el('div', { className: 'vmeta' }, el('b', {}, l.title), el('small', {}, `${l.region} · ${l.steps.length} steps · about ${l.minutes} min${p?.done ? ' · completed ✓' : p ? ` · at step ${p.step + 1}` : ''}`),
            el('small', { className: 'vprev' }, l.summary)),
          el('div', { className: 'vrow' },
            el('button', { type: 'button', className: 'btn primary', onclick: () => startLesson(l, 0) }, p?.done ? 'Start again' : 'Start'),
            p && !p.done ? el('button', { type: 'button', className: 'btn', onclick: () => startLesson(l, p.step) }, 'Continue') : null));
      }))));
}
function openList(on) {
  panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); btn.classList.toggle('on', on);
  if (on) { document.getElementById('viewsPanel')?.setAttribute('hidden', ''); renderList(); panel.querySelector('button.primary')?.focus({ preventScroll: true }); }
}
btn.addEventListener('click', () => openList(panel.hidden));
window.addEventListener('keydown', (e) => {
  if (!cur || e.target.matches?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowRight' && cur.i < cur.lesson.steps.length - 1) { e.preventDefault(); go(cur.i + 1); }
  else if (e.key === 'ArrowLeft' && cur.i > 0) { e.preventDefault(); go(cur.i - 1); }
});

atlas.registerHashPart({
  key: 'lesson',
  get: () => (cur ? `${cur.lesson.id}.${cur.i + 1}` : ''),
  set: (v) => { const [id, n] = String(v).split('.'); const l = LESSONS.find((x) => x.id === id); if (l) startLesson(l, Math.max(0, (+n || 1) - 1)); },
});
atlas.lessons = { list: () => LESSONS, start: (id, step = 0) => { const l = LESSONS.find((x) => x.id === id); if (l) startLesson(l, step); }, go, exit: exitLesson, current: () => cur && { id: cur.lesson.id, step: cur.i }, resolve };
