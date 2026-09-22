// Study mode: diagram quizzes for every atlas section. Built only on window.atlas (the public API block at the end of app.js).
//
// Modes: Label the diagram (numbered pins on the live 3D model + word bank), Identify (one structure highlighted),
// Locate (click the named structure); muscular adds Facts (origin / insertion / action / nerve / prime movers),
// joints adds Movements. Progress and misses are kept in localStorage (Leitner boxes) when it is available.
const atlas = window.atlas;
await (atlas?.ready ?? Promise.reject(new Error('atlas API missing')));
if (atlas.S.M) boot();

function boot() {
const { S, THREE, camera, controls, stage, canvas } = atlas;
const panel = document.getElementById('study'), overlay = document.getElementById('overlay'), studyBtn = document.getElementById('studyBtn');
if (!panel || !overlay || !studyBtn) return;

// ------------------------------------------------------------------ helpers --
const h = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const moveMs = () => (reduced() ? 80 : 720);           // flyTo takes 600 ms
const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let rand = Math.random;
const seed = (s) => { let a = s >>> 0; rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const byName = (a, b) => a.name.localeCompare(b.name);
const disp = (u) => atlas.nameOf({ name: u.name });
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DIRS = { front: V3(0, 0, 1), back: V3(0, 0, -1), left: V3(1, 0, 0), right: V3(-1, 0, 0) };

// ------------------------------------------------------------- persistence --
const KEY = 'zatlas.quiz.v1';
let P = { s: {} };
try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.s) P = j; } catch { /* private window / blocked storage: keep in memory */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* ignore */ } };
const stat = (sys) => (P.s[sys] ||= { seen: {}, best: {}, plays: 0 });
// Leitner boxes: 0 unseen, 1 missed last time, 2 answered right once, 3 right at least twice in a row
function mark(sys, key, ok) {
  const st = stat(sys), a = st.seen[key] || [0, 0, 0];
  if (ok) { a[0]++; a[2] = Math.min(3, Math.max(a[2], 1) + 1); } else { a[1]++; a[2] = 1; }
  st.seen[key] = a;
}
const boxOf = (sys, key) => stat(sys).seen[key]?.[2] || 0;

// ------------------------------------------------------------------- units --
// A unit is one answer: every head/part of a muscle and both sides of a paired structure form ONE unit named once.
const WHOLE_GROUP = /^(?!Muscles).+ muscle$|^Levator ani$/i;   // same rule as wholeOf() in app.js
const usable = (r) => r.name.trim() && !/^[( ]/.test(r.name);  // "(Name)" = anatomical variant, leading space = stray export name
function mkUnit(sys, key, name, recs, facts) {
  // ids cover both sides of a pair, but framing / neighbours / size use the right side only so a pair does not span the whole chest
  const one = recs.filter((r) => r.side === 'r'), fr = one.length && one.length < recs.length ? one : recs, box = new THREE.Box3();
  for (const r of fr) { box.expandByPoint(V3(...r.min)); box.expandByPoint(V3(...r.max)); }
  return { sys, key, name, recs, ids: new Set(recs.map((r) => r.id)), box, c: box.getCenter(V3(0, 0, 0)), diag: box.getSize(V3(0, 0, 0)).length(), group: recs[0].group, facts };
}
function wholeName(r) {
  const g = S.groups.get(r.group);
  if (g && WHOLE_GROUP.test(g.name)) return g.name;
  const m = r.name.match(/^[^(]+? (?:head|part|belly) of (.+)$/i);
  return m ? cap(m[1].replace(/ muscle$/i, '')) : r.name;
}
const unitCache = new Map();
function sectionUnits(sys) {
  if (unitCache.has(sys)) return unitCache.get(sys);
  const units = [], taken = new Set(), names = new Set();
  for (const r of S.M.structures) {
    if (r.system !== sys || taken.has(r.id) || !usable(r) || (sys === 'muscular' && !atlas.isMuscle(r))) continue;
    const recs = atlas.wholeOf(r).filter((x) => x.system === sys);
    recs.forEach((x) => taken.add(x.id)); taken.add(r.id);
    const name = recs.length > atlas.siblingsOf(r).length ? wholeName(r) : r.name;
    if (names.has(name.toLowerCase())) continue;          // the same name in two groups would be ambiguous as an answer
    names.add(name.toLowerCase());
    units.push(mkUnit(sys, `${sys}|${name}`, name, recs.length ? recs : [r]));
  }
  unitCache.set(sys, units); return units;
}
const descendants = (gid, out = new Set()) => { out.add(gid); for (const c of S.childGroups.get(gid) || []) descendants(c.id, out); return out; };
function applyFilter(units, { group, level }) {
  let u = units;
  if (group) { const ok = descendants(group); u = u.filter((x) => ok.has(x.group)); }
  if (level === 'major' && u.length) {
    const n = Math.max(Math.min(12, u.length), Math.ceil(u.length * 0.4));
    u = [...u].sort((a, b) => b.diag - a.diag).slice(0, n);
  }
  return u;
}
function topicOptions(units) {
  const own = new Map(); for (const u of units) own.set(u.group, (own.get(u.group) || 0) + 1);
  const count = (gid) => (own.get(gid) || 0) + (S.childGroups.get(gid) || []).reduce((a, c) => a + count(c.id), 0);
  const out = [], total = units.length;
  const walk = (g, depth, parentN) => {
    const n = count(g.id); if (!n) return;
    const show = n >= 4 && n !== parentN && n < total;
    if (show) out.push({ id: g.id, label: g.name, n, depth });
    if (depth < 3) for (const c of [...(S.childGroups.get(g.id) || [])].sort(byName)) walk(c, show ? depth + 1 : depth, n);
  };
  for (const g of [...S.rootGroups].sort(byName)) walk(g, 0, total);
  return out;
}
const parentOf = (gid) => S.groups.get(gid)?.parent || '';
function nearby(unit, list, k) {   // spatially nearest units
  return list.filter((u) => u !== unit).map((u) => [u.c.distanceTo(unit.c), u]).sort((a, b) => a[0] - b[0]).slice(0, k).map((x) => x[1]);
}
const norm = (s) => s.toLowerCase().replace(/ muscle$/, '');
function distractors(unit, pool, all, k, text = disp) {
  const clash = (u) => u === unit || [...u.ids].some((id) => unit.ids.has(id)) || norm(u.name).includes(norm(unit.name)) || norm(unit.name).includes(norm(u.name));
  const rank = (u) => (u.group === unit.group ? 0 : parentOf(u.group) === parentOf(unit.group) ? 1 : 2) * 10 + u.c.distanceTo(unit.c);
  let cand = pool.filter((u) => !clash(u));
  if (cand.length < k + 3) cand = [...cand, ...all.filter((u) => !clash(u) && !cand.includes(u))];
  cand.sort((a, b) => rank(a) - rank(b));
  const seen = new Set([text(unit)]), out = [];
  for (const u of shuffle(cand.slice(0, k * 4))) { const t = text(u); if (!seen.has(t)) { seen.add(t); out.push(u); if (out.length === k) break; } }
  return out;
}

// -------------------------------------------------------------- muscle facts --
let F = null, VOC = null;
const resolveFacts = (name) => { let f = F[name], n = 0; while (typeof f === 'string' && n++ < 4) f = F[f]; return f && typeof f === 'object' ? f : null; };
let factCache = null;
function factItems() {
  if (factCache) return factCache;
  const items = [], taken = new Set();
  for (const r of S.M.structures) {
    if (r.system !== 'muscular' || taken.has(r.id) || !usable(r) || !atlas.isMuscle(r)) continue;
    const f = resolveFacts(r.name); if (!f || !f.o?.length || !f.i?.length || !f.a?.length) continue;
    const sib = atlas.siblingsOf(r); sib.forEach((x) => taken.add(x.id));
    items.push(mkUnit('muscular', `f:${r.name}`, r.name, sib, f));
  }
  return (factCache = items);
}
let moveIdx = null;
function moves() {
  if (moveIdx) return moveIdx;
  const combos = new Map(), byJoint = new Map();
  for (const it of factItems()) for (const [j, m, role] of it.facts.acts || []) {
    const k = `${j}.${m}`; if (!combos.has(k)) combos.set(k, { j, m, prime: [] }); if (role === 'P') combos.get(k).prime.push(it);
    if (!byJoint.has(j)) byJoint.set(j, new Set()); byJoint.get(j).add(it);
  }
  return (moveIdx = { combos, byJoint });
}
const jointCache = new Map();
function jointRecs(slug) {
  if (jointCache.has(slug)) return jointCache.get(slug);
  const seen = new Map();
  for (const g of S.M.groups) if (g.system === 'joints' && VOC.manifestGroups?.[g.name]?.includes(slug)) for (const r of atlas.groupStructures('joints', g.id)) seen.set(r.id, r);
  const out = [...seen.values()]; jointCache.set(slug, out); return out;
}
const jointLabel = (j) => (VOC.joints?.[j]?.label || j).replace(/ \(.*\)| joint$/g, '');
const moveLabel = (m) => VOC.movementLabels?.[m] || cap(m.replace(/-/g, ' '));

// -------------------------------------------------------------------- state --
const SKIP = {
  insertions: 'muscle attachment patches repeat the muscle names and are too small to pick',
  reference: 'reference lines and movement arrows are not anatomical structures',
};
const BLURB = {
  skeletal: 'Bones, teeth and cartilages', joints: 'Ligaments, capsules and discs', muscular: 'Muscles, heads and compartments',
  cardiovascular: 'Heart, arteries and veins', nervous: 'Brain, cord, nerves and sense organs', visceral: 'Respiratory, digestive, urinary, genital, endocrine',
  lymphoid: 'Lymph nodes and lymphoid organs', fascia: 'Fasciae and septa', regions: 'Surface regions of the body',
};
const MODES = {
  label: { title: 'Label the diagram', icon: '①②', blurb: 'Numbered pins on the 3D model. Fill each from the word bank.' },
  identify: { title: 'Identify', icon: '?', blurb: 'One structure is highlighted. Pick its name.' },
  locate: { title: 'Locate', icon: '⌖', blurb: 'A name is given. Click that structure on the model.' },
  facts: { title: 'Facts', icon: 'O·I', blurb: 'Origin, insertion, action, nerve and prime movers of a highlighted muscle.' },
  moves: { title: 'Movements', icon: '↻', blurb: 'Which muscle is the prime mover of a joint movement.' },
};
const sections = () => S.M.systems.filter((s) => !SKIP[s.key]).map((s) => ({ key: s.key, label: atlas.SYS[s.key]?.[0] || s.label, color: atlas.SYS[s.key]?.[1] || '#888', blurb: BLURB[s.key] || '' }));
const modesFor = (sec) => ['label', 'identify', 'locate', ...(sec.key === 'muscular' ? ['facts'] : []), ...(sec.key === 'joints' ? ['moves'] : [])];
const CTX = { facts: ['muscular', 'skeletal', 'joints'], moves: ['joints', 'skeletal'] };   // systems shown for the fact / movement modes

const Q = { open: false, busy: false, view: 'menu', section: null, cfg: { mode: 'identify', group: '', level: 'major', len: 10, pins: 8, instant: true }, round: null, snap: null, token: 0, scene: '', tags: [], pins: [] };

// ------------------------------------------------------------------- scene --
function snapshot() {
  return { vis: new Map([...S.sys].map(([k, s]) => [k, s.visible])), cur: S.cur, sel: new Set(S.sel), ghost: S.ghost, iso: S.iso, pins: S.pins,
    p: camera.position.clone(), t: controls.target.clone() };
}
const flyToPose = (p, t) => {   // animated camera move to an exact pose (uses the same distance rule as flyTo, so the result is identical)
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const d = p.distanceTo(t), radius = ((d / 1.15) * Math.sin(Math.min(vHalf, hHalf)));
  atlas.flyTo(t.clone(), radius, p.clone().sub(t));
};
async function restoreScene(snap) {
  S.cur = snap.cur; S.sel = new Set(snap.sel); S.ghost = snap.ghost; S.iso = snap.iso;
  for (const [k, was] of snap.vis) if (S.sys.get(k)?.visible !== was) await atlas.setSystemVisible(k, was);
  atlas.restyle();
  if (snap.pins && !S.pins) document.getElementById('pinsBtn')?.click();
  if (S.cur) atlas.showInfo(atlas.siblingsOf(S.cur)); else document.getElementById('info').replaceChildren(document.getElementById('info-empty').content.cloneNode(true));
  flyToPose(snap.p, snap.t);
}
async function enterScene(key, systems) {
  if (Q.scene === `${key}|${systems.join()}`) return;
  S.cur = null; S.curLm = null; S.sel = new Set(); S.ghost = false; S.iso = false;
  const need = new Set(systems);
  for (const [k, st] of S.sys) if (!need.has(k) && st.visible) await atlas.setSystemVisible(k, false);
  for (const k of systems) await atlas.setSystemVisible(k, true);
  atlas.restyle(); Q.scene = `${key}|${systems.join()}`;
}
const highlight = (recs, ghost = true) => { S.sel = new Set(recs.map((r) => r.id)); S.ghost = ghost; S.iso = false; atlas.restyle(); };
const unhighlight = () => { S.sel = new Set(); S.ghost = false; S.iso = false; atlas.restyle(); };
const zMid = () => (zMid.v ??= (() => { const z = S.M.structures.filter((r) => r.system === 'skeletal').map((r) => r.c[2]).sort((a, b) => a - b); return z[z.length >> 1]; })());
const dirFor = (u) => (u.c.z >= zMid() ? 'front' : 'back');
const dirOrder = (u) => { const f = dirFor(u); return f === 'front' ? ['front', 'back', 'left', 'right'] : ['back', 'front', 'left', 'right']; };
const roots = () => [...S.sys.values()].filter((s) => s.visible && s.loaded).map((s) => s.group);
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const firstHit = (targets) => ray.intersectObjects(targets || roots(), true).find((x) => x.object.isMesh && x.object.visible);
// A raycast against the whole visible system (hundreds to low thousands of meshes) is the dominant cost of the label-diagram
// search, and it is paid on every single sample point. `regionTargets` computes a much smaller mesh list -- once per search
// region, not once per raycast -- restricted to structures actually near the candidate cluster (padded generously so real
// nearby occluders, e.g. skin over a deep muscle, are still included).
function regionTargets(units, pad = 4, minR = 0.15) {
  const box = boxOfUnits(units), c = box.getCenter(V3(0, 0, 0)), r = Math.max((box.getSize(V3(0, 0, 0)).length() / 2) * pad, minR), r2 = r * r, v = V3(0, 0, 0);
  // a candidate's own meshes must always be raycastable, even when the candidate is spatially large (a long nerve, a
  // muscle spanning the whole cluster) and so has parts outside the padded radius -- only OTHER structures are distance-filtered
  const always = new Set(units.flatMap((u) => u.recs.map((r) => r.id)));
  const out = [];
  for (const [id, meshes] of S.meshes) {
    const rec = S.byId.get(id);
    if (!rec || !S.sys.get(rec.system)?.visible) continue;
    if (!always.has(id) && c.distanceToSquared(v.set(...rec.c)) > r2) continue;
    for (const m of meshes) if (m.visible) out.push(m);
  }
  return out;
}

// camera pose that frames a bounding sphere, identical to atlas.flyTo()
function poseFor(center, radius, dir) {
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const dist = Math.max(radius / Math.sin(Math.min(vHalf, hHalf)) * 1.15, 0.012);
  return { p: center.clone().add(dir.clone().normalize().multiplyScalar(dist)), t: center.clone(), center, radius, dir };
}
const boxOfUnits = (units) => { const b = new THREE.Box3(); for (const u of units) b.union(u.box); return b; };
const poseForUnits = (units, dir) => { const b = boxOfUnits(units); return poseFor(b.getCenter(V3(0, 0, 0)), Math.max(b.getSize(V3(0, 0, 0)).length() / 2, 0.02), dir); };
function withPose(pose, fn) {   // evaluate something with the camera temporarily at `pose` (synchronous: no frame runs in between)
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  camera.position.copy(pose.p); controls.target.copy(pose.t); camera.lookAt(pose.t); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  try { return fn(); } finally { camera.position.copy(p0); controls.target.copy(t0); camera.lookAt(t0); camera.updateMatrixWorld(true); }
}
async function goTo(pose) { atlas.flyTo(pose.center, pose.radius, pose.dir); await sleep(moveMs()); await frames(2); }

// a surface point of `unit` that is really visible from the current camera (first hit of a ray through a sampled vertex)
function samplePts(meshes, n) {
  const per = Math.max(1, Math.floor(n / meshes.length)), out = [], v = V3(0, 0, 0);
  for (const m of meshes) {
    const pos = m.geometry.attributes.position; if (!pos) continue;
    m.updateWorldMatrix(true, false);
    const step = Math.max(1, Math.floor(pos.count / per));
    for (let i = 0; i < pos.count; i += step) out.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
  }
  return out;
}
function tryAnchor(unit, taken, { gap = 34, margin = 26, strict = false, deadline = Infinity, points = 180, nbrs = 4, targets = null } = {}) {
  const meshes = unit.recs.flatMap((r) => atlas.meshesOf(r.id)).filter((m) => m.visible);
  if (!meshes.length) return null;
  camera.updateMatrixWorld(true);
  const W = stage.clientWidth, H = stage.clientHeight, o = {};
  const pts = samplePts(meshes, points).map((p) => { atlas.project(p, o); return { p, x: o.x, y: o.y, ok: o.visible && o.x > margin && o.x < W - margin && o.y > margin && o.y < H - margin }; }).filter((q) => q.ok);
  if (!pts.length) return null;
  const mx = pts.map((q) => q.x).sort((a, b) => a - b)[pts.length >> 1], my = pts.map((q) => q.y).sort((a, b) => a - b)[pts.length >> 1];
  pts.sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my));
  const hits = (x, y) => { ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(ndc, camera); return firstHit(targets); };
  const NBRS = [[3, 0], [-3, 0], [0, 3], [0, -3]].slice(0, nbrs);
  for (const robust of strict ? [true] : [true, false]) {   // first insist the point is not on a silhouette edge, then (unless strict) settle for any visible point
    let tries = 0;
    for (const q of pts) {
      if (performance.now() > deadline) return null;   // a single unit's search must not itself blow past the caller's time budget
      if (taken.some((t) => Math.hypot(t.x - q.x, t.y - q.y) < gap)) continue;
      if (tries++ > 11) break;
      const hit = hits(q.x, q.y);
      if (!hit || !unit.ids.has(hit.object.userData.zid)) continue;
      if (robust && NBRS.some(([dx, dy]) => !unit.ids.has(hits(q.x + dx, q.y + dy)?.object.userData.zid))) continue;
      return { unit, point: hit.point.clone(), x: q.x, y: q.y };
    }
  }
  return null;
}
function occluded(pin) {
  const from = camera.position, d = pin.point.clone().sub(from), dist = d.length();
  ray.set(from, d.normalize());
  const hit = firstHit();
  return !!hit && !pin.unit.ids.has(hit.object.userData.zid) && hit.distance < dist - Math.max(0.0008, dist * 0.004);
}

// ------------------------------------------------------- overlay: pins, tags --
let hookOff = null, lastSig = '', movedAt = 0, needOcc = false;
function drawOverlay(rendered) {
  if (!Q.pins.length && !Q.tags.length) return;
  const sig = `${camera.position.x.toFixed(5)},${camera.position.y.toFixed(5)},${camera.position.z.toFixed(5)},${controls.target.x.toFixed(5)},${controls.target.y.toFixed(5)},${stage.clientWidth}x${stage.clientHeight}`;
  const moved = sig !== lastSig;
  if (moved) { lastSig = sig; movedAt = performance.now(); needOcc = true; }
  if (needOcc && !moved && performance.now() - movedAt > 180 && !Q.flying) {
    needOcc = false;
    for (const p of Q.pins) p.behind = occluded(p);
  }
  if (!moved && !rendered && !Q.pinDirty) return;
  Q.pinDirty = false;
  const o = {};
  for (const p of Q.pins) {
    atlas.project(p.point, o);
    p.node.style.display = o.visible && !Q.flying ? '' : 'none';
    p.node.style.transform = `translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px)`;
    p.node.classList.toggle('behind', !!p.behind);
  }
  for (const t of Q.tags) {
    atlas.project(t.point, o);
    t.node.classList.toggle('flip', o.x > stage.clientWidth - 200); t.node.classList.toggle('below', o.y < 46);
    t.node.style.display = o.visible && !Q.flying ? '' : 'none';
    t.node.style.transform = `translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px)`;
  }
}
function clearOverlay() { overlay.replaceChildren(); Q.pins = []; Q.tags = []; }
function layoutPins(pins) {   // pick a leader direction for every number badge so badges do not overlap each other or leave the stage
  const W = stage.clientWidth, H = stage.clientHeight, L = 30, angles = [-45, 45, -135, 135, 0, 180, -90, 90].map((d) => (d * Math.PI) / 180), placed = [];
  for (const p of pins) {
    let best = null;
    for (const a of angles) {
      const bx = p.x + Math.cos(a) * L, by = p.y + Math.sin(a) * L;
      const worst = Math.min(...placed.map((q) => Math.hypot(q.bx - bx, q.by - by)), 999, ...pins.filter((q) => q !== p).map((q) => Math.hypot(q.x - bx, q.y - by)));
      const inside = bx > 16 && bx < W - 16 && by > 16 && by < H - 16;
      const score = (inside ? 1000 : 0) + worst;
      if (!best || score > best.score) best = { a, bx, by, score };
    }
    p.off = { dx: Math.cos(best.a) * L, dy: Math.sin(best.a) * L, a: best.a }; placed.push(best);
  }
}
function makePins(slots, onPick) {
  clearOverlay();
  slots.forEach((s, i) => {
    const node = h('div', { class: 'qpin', style: `--dx:${s.off.dx.toFixed(1)}px;--dy:${s.off.dy.toFixed(1)}px;--ang:${s.off.a.toFixed(3)}rad` },
      h('span', { class: 'qdot' }), h('span', { class: 'qlead' }),
      h('button', { class: 'qbadge', type: 'button', tabindex: '-1', onclick: (e) => { e.stopPropagation(); onPick(i); } }, String(i + 1)));
    s.node = node; overlay.append(node); Q.pins.push(s);
  });
  Q.pinDirty = true; needOcc = true; movedAt = performance.now(); lastSig = '';
  for (const s of slots) s.node.style.display = 'none';
  drawOverlay(true);
}
function addTag(unit, text) {
  const node = h('div', { class: 'qtag' }, h('span', { class: 'qtag-dot' }), h('span', { class: 'qtag-text' }, text));
  overlay.append(node);
  const t = { node, point: unit.c.clone() };
  Q.tags.push(t); Q.pinDirty = true;
  return t;
}
async function tagUnit(unit, text) {   // name tag on a visible surface point of the unit (falls back to its centre)
  overlay.querySelectorAll('.qtag').forEach((n) => n.remove()); Q.tags = [];
  const t = addTag(unit, text);
  const a = tryAnchor(unit, [], { gap: 0, margin: 20 });
  if (a) t.point.copy(a.point);
  Q.pinDirty = true;
}

// ---------------------------------------------------------------- panel UI ---
const focusHead = () => { const n = panel.querySelector('[data-focus]'); if (n) n.focus({ preventScroll: true }); };
function frame(...kids) {   // standard panel skeleton: sticky header, scrolling body
  panel.replaceChildren(h('div', { class: 'qs', style: `--dot:${Q.section?.color || 'var(--accent)'}` }, ...kids));
  panel.scrollTop = 0;
}
const head = (title, { back, sub } = {}) => h('header', { class: 'qs-head' },
  back ? h('button', { class: 'qs-back', type: 'button', 'aria-label': 'Back', onclick: back }, '‹') : null,
  h('div', { class: 'qs-titles' }, h('h2', { class: 'qs-title', tabindex: '-1', 'data-focus': '' }, title), sub ? h('div', { class: 'qs-sub' }, sub) : null),
  h('button', { class: 'qs-exit', type: 'button', onclick: () => closeStudy() }, 'Exit study'));
const bar = (frac) => h('div', { class: 'qbar', role: 'presentation' }, h('i', { style: `width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }));
const busy = (text) => { frame(head('Study'), h('div', { class: 'qs-body' }, h('p', { class: 'qs-load', role: 'status' }, text))); };

function sectionProgress(sec) {
  const units = sectionUnits(sec.key), st = stat(sec.key);
  const learned = units.filter((u) => (st.seen[u.key]?.[2] || 0) >= 2).length;
  const missed = units.filter((u) => st.seen[u.key]?.[2] === 1).length;
  const best = Math.max(0, ...Object.values(st.best));
  return { total: units.length, learned, missed, best, plays: st.plays };
}
function showMenu() {
  Q.view = 'menu'; Q.round = null; Q.section = null; clearOverlay(); atlas.pickHandler = onPick;
  const cards = sections().map((sec) => {
    const pr = sectionProgress(sec);
    return h('button', { class: 'qcard', type: 'button', style: `--dot:${sec.color}`, onclick: () => showSetup(sec) },
      h('span', { class: 'qcard-dot' }),
      h('span', { class: 'qcard-main' }, h('b', {}, sec.label), h('small', {}, sec.blurb),
        bar(pr.total ? pr.learned / pr.total : 0),
        h('small', { class: 'qcard-stat' }, `${pr.learned} / ${pr.total} learned${pr.best ? ` · best ${pr.best}%` : ''}${pr.missed ? ` · ${pr.missed} to review` : ''}`)));
  });
  frame(head('Study: diagram quizzes', { sub: 'Pick a section' }),
    h('div', { class: 'qs-body' },
      h('p', { class: 'qs-lead' }, 'Every section has its own quiz on the live 3D model: label pins, identify a highlighted structure, or find a named one.'),
      h('div', { class: 'qcards' }, cards),
      h('p', { class: 'qs-fine' }, `Not quizzed: ${Object.entries(SKIP).map(([k, v]) => `${atlas.SYS[k]?.[0] || k} (${v})`).join('; ')}.`)));
  focusHead();
}
function showSetup(sec) {
  Q.view = 'setup'; Q.section = sec; Q.round = null; clearOverlay(); atlas.pickHandler = onPick;
  const modes = modesFor(sec);
  if (!modes.includes(Q.cfg.mode)) Q.cfg.mode = 'identify';
  if ((Q.cfg.mode === 'facts' || Q.cfg.mode === 'moves') && !F) { busy('Loading muscle facts…'); ensureData(Q.cfg.mode).then(() => { if (Q.open && Q.view === 'setup') showSetup(sec); }); return; }
  const all = sectionUnits(sec.key), st = stat(sec.key), cfg = Q.cfg;
  const topics = topicOptions(all);
  if (cfg.group && !topics.some((t) => t.id === cfg.group)) cfg.group = '';
  const refresh = () => { const n = poolFor(sec, cfg).pool.length; poolInfo.textContent = `${n} structure${n === 1 ? '' : 's'} in this pool`; go.disabled = n < (cfg.mode === 'label' ? 3 : 4); };
  const poolInfo = h('p', { class: 'qs-fine', role: 'status' });
  const go = h('button', { class: 'btn primary qgo', type: 'button', onclick: () => startRound(false) }, 'Start quiz');
  const review = missedCount(sec, cfg);
  const sel = (id, label, opts, value, onchange) => h('label', { class: 'qfield', for: id }, h('span', {}, label),
    h('select', { id, onchange: (e) => { onchange(e.target.value); refresh(); } }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
  frame(head(sec.label, { back: showMenu, sub: 'Quiz setup' }),
    h('div', { class: 'qs-body' },
      h('div', { class: 'qmodes', role: 'radiogroup', 'aria-label': 'Quiz mode' }, modes.map((m) =>
        h('button', { class: 'qmode', type: 'button', role: 'radio', 'aria-checked': String(cfg.mode === m), onclick: () => { cfg.mode = m; showSetup(sec); } },
          h('span', { class: 'qmode-icon', 'aria-hidden': 'true' }, MODES[m].icon), h('span', {}, h('b', {}, MODES[m].title), h('small', {}, MODES[m].blurb))))),
      cfg.mode === 'facts' || cfg.mode === 'moves' ? null : sel('qTopic', 'Topic', [['', `Whole section (${all.length})`], ...topics.map((t) => [t.id, `${' '.repeat(t.depth)}${t.label} (${t.n})`])], cfg.group, (v) => { cfg.group = v; }),
      cfg.mode === 'facts' || cfg.mode === 'moves' ? sel('qTopic', 'Topic', [['', 'All curated muscles'], ...topicOptions(factItemsOrEmpty()).map((t) => [t.id, `${' '.repeat(t.depth)}${t.label} (${t.n})`])], cfg.group, (v) => { cfg.group = v; }) : null,
      sel('qLevel', 'Difficulty', [['major', 'Major structures (largest 40%)'], ['all', 'Everything']], cfg.level, (v) => { cfg.level = v; }),
      cfg.mode === 'label'
        ? [sel('qPins', 'Pins per diagram', [[5, '5'], [8, '8'], [12, '12']], cfg.pins, (v) => { cfg.pins = +v; }),
          h('label', { class: 'qcheck' }, h('input', { type: 'checkbox', checked: cfg.instant, onchange: (e) => { cfg.instant = e.target.checked; } }), 'Check each answer as I go (otherwise check at the end)')]
        : sel('qLen', 'Questions', [[5, '5'], [10, '10'], [20, '20']], cfg.len, (v) => { cfg.len = +v; }),
      poolInfo,
      h('div', { class: 'qs-actions' }, go,
        review ? h('button', { class: 'btn', type: 'button', onclick: () => startRound(true) }, `Review misses (${review})`) : null),
      h('p', { class: 'qs-fine' }, st.plays ? `Played ${st.plays} time${st.plays === 1 ? '' : 's'} · ${Object.entries(st.best).map(([m, p]) => `${MODES[m]?.title || m} best ${p}%`).join(' · ')}` : 'Progress is saved in this browser.')));
  refresh(); focusHead();
}
const factItemsOrEmpty = () => (F ? factItems() : []);
function missedCount(sec, cfg) {
  const st = stat(sec.key), facts = cfg.mode === 'facts' || cfg.mode === 'moves';
  return Object.entries(st.seen).filter(([k, a]) => a[2] === 1 && k.startsWith('f:') === facts).length;
}
function poolFor(sec, cfg, review = false) {
  const facts = cfg.mode === 'facts' || cfg.mode === 'moves';
  const all = facts ? factItemsOrEmpty() : sectionUnits(sec.key);
  let pool = applyFilter(all, review ? { group: '', level: 'all' } : cfg);
  if (review) { const st = stat(sec.key); pool = pool.filter((u) => st.seen[u.key]?.[2] === 1); }
  return { pool, all };
}

// ------------------------------------------------------------------- rounds --
async function ensureData(mode) {
  if ((mode === 'facts' || mode === 'moves') && !F) { [F, VOC] = await Promise.all([atlas.loadFacts(), atlas.loadVocab()]); }
}
async function startRound(review) {
  const sec = Q.section, cfg = { ...Q.cfg }; if (Q.busy) return; Q.busy = true;
  const token = ++Q.token;
  try {
    if (review && cfg.mode === 'label') cfg.mode = 'identify';
    busy('Loading the 3D model…');
    await ensureData(cfg.mode);
    await enterScene(sec.key, CTX[cfg.mode] || [sec.key]);
    if (token !== Q.token) return;
    const { pool, all } = poolFor(sec, cfg, review);
    if (pool.length < (review ? 1 : cfg.mode === 'label' ? 3 : 4)) { Q.busy = false; showSetup(sec); return; }
    const r = Q.round = { sec, cfg, review, mode: cfg.mode, pool, all, log: [], i: 0, score: 0, queue: [], spare: [], q: null, token };
    if (cfg.mode === 'label') { r.total = 0; await newDiagram(); }
    else { const s = shuffle(pool); r.queue = s.slice(0, cfg.len); r.spare = s.slice(cfg.len); r.total = r.queue.length; await showQuestion(); }
  } catch (e) { console.error(e); busy('Something went wrong while building the quiz. Go back and try another topic.'); }
  finally { Q.busy = false; }
}
function recordAnswer(u, ok, extra = {}) {
  const r = Q.round; r.log.push({ u, ok, ...extra }); if (ok) r.score++;
  mark(r.sec.key, u.key, ok); save();
}

// ----- Identify / Locate / Facts (one question at a time) -----
async function showQuestion() {
  const r = Q.round; if (!r) return;
  if (r.i >= r.queue.length) return showResults();
  const item = r.queue[r.i];
  atlas.pickHandler = onPick; clearOverlay();
  r.q = { item, answered: false };
  let q = r.q;
  if (r.mode === 'identify') {
    q.opts = shuffle([item, ...distractors(item, r.pool, r.all, 3)]).map((u) => ({ u, text: () => disp(u), correct: u === item }));
    highlight(item.recs, true); { const ps = poseForUnits([item], DIRS[dirFor(item)]); atlas.flyTo(ps.center, ps.radius, ps.dir); }
  } else if (r.mode === 'locate') {
    busy('Setting up the view…'); await frames(2);
    const ok = await prepareLocate(item);
    if (!ok) { const alt = r.spare.shift(); if (!alt) { r.queue.splice(r.i, 1); r.total = r.queue.length; return showQuestion(); } r.queue[r.i] = alt; return showQuestion(); }
  } else {
    q = r.q = Object.assign(makeFactQuestion(item, r), { answered: false });
    highlight(q.highlight || item.recs, true); atlas.flyTo(q.frame.center, q.frame.radius, q.frame.dir);
  }
  renderQuestion();
}
async function prepareLocate(u) {
  const r = Q.round, all = sectionUnits(r.sec.key);
  const region = [u, ...nearby(u, all, 7)];
  unhighlight();
  let found = null;
  for (const d of dirOrder(u)) {
    const pose = poseForUnits(region, DIRS[d]);
    if (withPose(pose, () => !!tryAnchor(u, [], { gap: 0, margin: 30, strict: true }))) { found = pose; break; }
    await sleep(0);
  }
  if (!found) return false;
  Q.flying = true; await goTo(found); Q.flying = false;
  r.q.pose = found; return true;
}
function makeFactQuestion(item, r) {
  const f = item.facts, all = r.all, mv = moves();
  const canMove = (f.acts || []).some((a) => a[2] === 'P');
  const roll = rand();
  if (r.mode === 'moves' || roll < 0.22) {
    const combos = [...mv.combos.values()].filter((c) => c.prime.length && jointRecs(c.j).length && all.filter((x) => !mv.byJoint.get(c.j)?.has(x)).length >= 3);
    if (r.mode === 'moves' || !canMove || rand() < 0.5) {   // which muscle moves this joint
      if (combos.length) {
        const c = pick(combos), right = pick(c.prime), jr = jointRecs(c.j);
        const wrong = shuffle(all.filter((x) => !mv.byJoint.get(c.j)?.has(x) && x.name !== right.name)).slice(0, 3);
        const one = jr.filter((x) => x.side === 'r'), b = new THREE.Box3();   // frame one side of a paired joint
        for (const x of one.length ? one : jr) { b.expandByPoint(V3(...x.min)); b.expandByPoint(V3(...x.max)); }
        return { item: right, kind: 'moveA', fact: 'prime mover', stem: () => `Which muscle is a prime mover for ${moveLabel(c.m).toLowerCase()} at the ${VOC.joints?.[c.j]?.label || c.j}?`,
          opts: shuffle([right, ...wrong]).map((u) => ({ u, text: () => disp(u), correct: u === right })), highlight: jr, reveal: [...jr, ...(r.sec.key === 'muscular' ? right.recs : [])], tag: r.sec.key === 'muscular',
          frame: poseFor(b.getCenter(V3(0, 0, 0)), Math.max(b.getSize(V3(0, 0, 0)).length() / 2, 0.03) * 1.6, DIRS[dirFor({ c: b.getCenter(V3(0, 0, 0)) })]) };
      }
    }
    const pr = (f.acts || []).filter((a) => a[2] === 'P');
    if (pr.length) {   // which movement does this highlighted muscle produce
      const label = ([j, m]) => `${jointLabel(j)} · ${moveLabel(m).toLowerCase()}`;
      const right = pick(pr), own = new Set((f.acts || []).map((a) => `${a[0]}.${a[1]}`));
      const pool = shuffle([...mv.combos.values()].filter((c) => !own.has(`${c.j}.${c.m}`)));
      const wrong = []; const seen = new Set([label(right)]);
      for (const c of pool) { const t = label([c.j, c.m]); if (!seen.has(t) && !/circumduction/.test(c.m)) { seen.add(t); wrong.push(t); if (wrong.length === 3) break; } }
      return { item, kind: 'moveB', fact: 'movement', stem: () => 'The highlighted muscle is a prime mover for which movement?', hideName: true, highlight: item.recs,
        opts: shuffle([label(right), ...wrong]).map((t) => ({ t, text: () => t, correct: t === label(right) })), frame: poseForUnits([item], DIRS[dirFor(item)]) };
    }
  }
  const kinds = [['o', 'origin'], ['i', 'insertion'], ['a', 'action'], ['n', 'nerve']]
    .filter(([k]) => [].concat(f[k] || []).length);
  const [k, label] = pick(kinds);
  const text = (x) => [].concat(x.facts[k] || []).join('; ');
  const right = text(item);
  const rank = (u) => (u.group === item.group ? 0 : parentOf(u.group) === parentOf(item.group) ? 1 : 2) * 10 + u.c.distanceTo(item.c);
  const seen = new Set([right]), wrong = [];
  for (const u of shuffle(all.filter((x) => x !== item && text(x)).sort((a, b) => rank(a) - rank(b)).slice(0, 24))) {
    const t = text(u); if (!seen.has(t)) { seen.add(t); wrong.push(t); if (wrong.length === 3) break; }
  }
  const STEM = { o: 'Which is the origin of', i: 'Which is the insertion of', a: 'Which action best describes', n: 'Which nerve supplies' };
  return { item, kind: 'fact', fact: label, stem: () => `${STEM[k]} ${disp(item)}?`,
    highlight: item.recs, opts: shuffle([right, ...wrong]).map((t) => ({ t, text: () => t, correct: t === right })), frame: poseForUnits([item], DIRS[dirFor(item)]) };
}
function renderQuestion() {
  const r = Q.round, q = r.q, item = q.item, n = r.i + 1;
  const locate = r.mode === 'locate';
  const stem = locate ? h('p', { class: 'qstem' }, 'Click the ', h('b', { class: 'qname' }, disp(item)), ' on the model.')
    : h('p', { class: 'qstem' }, q.stem ? q.stem() : 'What is the highlighted structure?');
  const body = [h('div', { class: 'qprog' }, h('span', {}, `Question ${n} of ${r.queue.length}`), h('span', {}, `Score ${r.score}`)), bar((n - 1) / r.queue.length), stem];
  if (!locate) {
    body.push(h('div', { class: 'qopts', role: 'group', 'aria-label': 'Answers' }, q.opts.map((o, i) => {
      const cls = 'qopt' + (q.answered ? (o.correct ? ' ok' : q.chosen === i ? ' bad' : ' dim') : '');
      return h('button', { class: cls, type: 'button', disabled: q.answered, 'data-i': i, onclick: () => choose(i) }, h('kbd', {}, String(i + 1)), h('span', {}, o.text()));
    })));
  } else if (!q.answered) {
    body.push(h('p', { class: 'qs-fine' }, 'Drag to rotate or scroll to zoom if you need a better look. Then click once on the structure.'),
      h('div', { class: 'qs-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => resetView() }, 'Reset view'), h('button', { class: 'btn', type: 'button', onclick: () => giveUp() }, 'Show me')));
  }
  if (q.answered) body.push(feedback(q), h('div', { class: 'qs-actions' }, h('button', { class: 'btn primary', type: 'button', 'data-primary': '', onclick: () => { r.i++; showQuestion(); } }, r.i + 1 >= r.queue.length ? 'See results' : 'Next')));
  frame(head(`${MODES[r.mode].title} · ${r.sec.label}`, { sub: r.review ? 'Reviewing missed structures' : topicName(r) }),
    h('div', { class: 'qs-body' }, ...body, h('div', { class: 'qs-actions foot' }, quitButton())));
  if (q.answered) { const b = panel.querySelector('[data-primary]'); b?.focus(); b?.scrollIntoView({ block: 'nearest' }); } else focusHead();
}
const topicName = (r) => (r.cfg.group ? S.groups.get(r.cfg.group)?.name : 'Whole section');
function quitButton() {
  return h('button', { class: 'btn ghost', type: 'button', onclick: (e) => {
    const box = e.currentTarget.parentElement;
    box.replaceChildren(h('span', { class: 'qs-fine' }, 'Leave this round? '), h('button', { class: 'btn', type: 'button', onclick: () => finishEarly() }, 'Leave'), h('button', { class: 'btn primary', type: 'button', onclick: () => renderCurrent() }, 'Keep going'));
    box.querySelector('.primary').focus();
  } }, 'Quit round');
}
function renderCurrent() { if (Q.round?.mode === 'label') renderLabel(); else if (Q.round?.q) renderQuestion(); }
function finishEarly() { atlas.pickHandler = onPick; unhighlight(); clearOverlay(); showSetup(Q.section); }
function feedback(q) {
  const r = Q.round, item = q.item, box = h('div', { class: 'qfeed ' + (q.ok ? 'ok' : 'bad'), role: 'status' });
  box.append(h('p', { class: 'qfeed-head' }, q.ok ? '✓ Correct' : q.picked === 'giveup' ? 'Here it is' : '✗ Not quite'));
  if (r.mode === 'identify' || r.mode === 'locate') {
    box.append(h('p', {}, h('b', {}, disp(item))));
    const lat = atlas.latinOf(item.recs[0]); if (lat && atlas.S.lang === 'en') box.append(h('p', { class: 'qs-fine latin' }, lat));
    const chain = []; let g = S.groups.get(item.group); while (g) { chain.unshift(g.name); g = S.groups.get(g.parent); }
    if (chain.length) box.append(h('p', { class: 'qs-fine' }, chain.slice(-3).join(' › ')));
    if (r.mode === 'locate' && q.clicked && !q.ok) box.append(h('p', { class: 'qs-fine' }, `You clicked: ${q.clicked}`));
  } else {
    const f = item.facts, row = (k, t) => [].concat(f[k] || []).length ? h('div', { class: 'qf' }, h('b', {}, t), [].concat(f[k]).join('; ')) : null;
    if (q.kind === 'moveA') box.append(h('p', {}, h('b', {}, disp(q.item))));
    else box.append(h('p', {}, h('b', {}, disp(item))));
    box.append(h('div', { class: 'qfacts' }, row('o', 'Origin'), row('i', 'Insertion'), row('a', 'Action'), row('n', 'Nerve')));
  }
  return box;
}
function choose(i) {
  const r = Q.round, q = r?.q; if (!q || q.answered) return;
  const o = q.opts[i]; if (!o) return;
  q.answered = true; q.chosen = i; q.ok = !!o.correct;
  recordAnswer(q.item, q.ok, { text: disp(q.item) });
  revealScene(q);
  renderQuestion();
}
function giveUp() {
  const r = Q.round, q = r?.q; if (!q || q.answered) return;
  q.answered = true; q.ok = false; q.picked = 'giveup';
  recordAnswer(q.item, false, { text: disp(q.item) }); revealScene(q); renderQuestion();
}
function revealScene(q) {
  const r = Q.round, item = q.item;
  highlight(q.reveal || item.recs, false);
  if (q.kind !== 'moveA' || q.tag) tagUnit(item, disp(item));
}
function onPick(rec, lm) {
  const r = Q.round; if (!Q.open || !r || r.mode !== 'locate' || !r.q || r.q.answered) return;
  const target = lm ? S.byId.get(lm.target) : rec;
  if (!target) return;
  const q = r.q, ok = q.item.ids.has(target.id);
  q.answered = true; q.ok = ok; q.clicked = ok ? '' : atlas.nameOf(target);
  recordAnswer(q.item, ok, { text: disp(q.item), clicked: q.clicked });
  revealScene(q); renderQuestion();
}
function resetView() { const q = Q.round?.q; if (q?.pose) goTo(q.pose); }

// ----- Label the diagram -----
// Anchor search is expensive (each candidate unit resamples its mesh and raycasts against the whole visible system), so every
// level below takes a hard `deadline` (performance.now() ms) and checks it inside its own innermost loop: a single slow
// attempt can only ever run until the deadline, never past it, no matter how many candidates or points remain.
function placeAnchors(list, N, opts) {
  const out = [];
  for (const u of list) {
    if (out.length >= N || performance.now() > opts.deadline) break;
    const a = tryAnchor(u, out, opts); if (a) out.push(a);
  }
  return out;
}
function planDir(cands, N, dirVec, opts) {   // frame the cluster from direction dirVec, pin what is visible, then tighten the frame onto the structures that got a pin
  // Scoped once per region (not per raycast, which is where nearly all of this search's cost otherwise goes): only the
  // meshes actually near this cluster are considered occluders, instead of the whole visible system.
  const scoped = { ...opts, targets: opts.targets || regionTargets(cands) };
  const pose = poseForUnits(cands.slice(0, Math.min(cands.length, N + 2)), dirVec);
  const placed = withPose(pose, () => placeAnchors(cands, N, scoped));
  if (placed.length < 3 || performance.now() > scoped.deadline) return { pose, placed };   // no slack left for a second pass
  const box = new THREE.Box3().setFromPoints(placed.map((a) => a.point));   // frame the pinned region, not the full extent of every structure
  const tight = poseFor(box.getCenter(V3(0, 0, 0)), Math.max((box.getSize(V3(0, 0, 0)).length() / 2) * 1.3, 0.025), dirVec);
  const again = withPose(tight, () => {
    // units already anchored are re-checked at their OWN point first (one raycast) before falling back to a full resample,
    // since a modest reframe usually still sees the same spot -- this is what makes the tightening pass cheap
    const out = [];   // holds only successful anchors (never null) -- it doubles as the `taken` gap-check list passed into tryAnchor below
    for (const a of placed) {
      if (out.length >= N || performance.now() > scoped.deadline) break;
      ndc.set((a.x / stage.clientWidth) * 2 - 1, -(a.y / stage.clientHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
      const hit = firstHit(scoped.targets);
      const got = hit && a.unit.ids.has(hit.object.userData.zid) ? { unit: a.unit, point: hit.point.clone(), x: a.x, y: a.y } : tryAnchor(a.unit, out, scoped);
      if (got) out.push(got);
    }
    return [...out, ...placeAnchors(cands.filter((u) => !placed.some((a) => a.unit === u)), N - out.length, scoped)];
  });
  return again.length >= Math.min(N, placed.length) ? { pose: tight, placed: again } : { pose, placed };
}
const DIAGS = { 'front-left': V3(0.7, 0, 0.7), 'front-right': V3(-0.7, 0, 0.7), 'back-left': V3(0.7, 0, -0.7), 'back-right': V3(-0.7, 0, -0.7) };
// One full search pass: many candidates (deep muscles, vessels behind others) turn out to be occluded from any one view,
// so this is bounded by a wall-clock deadline threaded into every nested loop (not just checked between attempts) -- it
// always returns at or before the deadline with the best plan found, however deep the cutoff happens. Dense pools
// (muscular, nervous: many small, layered, mutually-occluding structures) turn out to need MORE tries at LOWER cost each
// far more than they need any one try to be thorough -- a seed simply is or isn't framable from a given angle, and extra
// sample points / neighbour rays rarely change that outcome. So every attempt is deliberately cheap and tries all 8 view
// angles (4 cardinal + 4 diagonal), which lets far more seeds be tried inside the deadline.
async function searchPlan(pool, N, deadline) {
  let plan = null, best = null;
  for (let attempt = 0; attempt < 16 && !plan && performance.now() < deadline; attempt++) {
    const seedU = pick(pool);
    const cands = [seedU, ...nearby(seedU, pool, Math.min(pool.length - 1, N * 2 + 4))];
    // regionTargets scans every loaded structure once per candidate cluster, so it is computed ONCE per attempt here and
    // reused across all 8 directions below, instead of once per direction (an 8x saving on that scan alone)
    const opts = { deadline, points: 110, nbrs: 2, targets: regionTargets(cands) };
    for (const d of [...dirOrder(seedU), ...Object.keys(DIAGS)]) {
      if (performance.now() > deadline) break;
      await sleep(0);
      const got = planDir(cands, N, DIRS[d] || DIAGS[d], opts);
      if (!best || got.placed.length > best.placed.length) best = { ...got, seedU };
      if (got.placed.length >= Math.max(3, N - 1)) { plan = best; break; }
    }
  }
  return { plan, best };
}
async function newDiagram() {
  const r = Q.round, N = Math.min(r.cfg.pins, r.pool.length);
  Q.busy = true; busy('Building the diagram…'); clearOverlay(); unhighlight(); Q.flying = true;
  await frames(2);   // let the message paint before the (synchronous) ray work starts
  // A single search pass can legitimately whiff on a dense pool even after many internal attempts, since attempts within
  // one pass are budget-bound, not count-bound. Failures across independent passes are close to independent draws, so
  // retrying the WHOLE search fresh (new random seeds, new sub-budget) compounds multiplicatively -- roughly 30% per pass
  // becomes roughly 9% after one retry, roughly 3% after two -- without touching the underlying search/raycast algorithm.
  // Total wall time is capped so a hard pool never leaves "Building the diagram…" up for more than ~7s.
  const overallDeadline = performance.now() + 6000;   // leaves headroom for the goTo() camera tween (~720ms) plus some per-pass check-granularity overshoot
  let plan = null, best = null;
  for (let pass = 0; pass < 3 && !plan && performance.now() < overallDeadline; pass++) {
    const passDeadline = Math.min(overallDeadline, performance.now() + 3000);
    const got = await searchPlan(r.pool, N, passDeadline);
    if (got.plan) plan = got.plan;
    else if (got.best && (!best || got.best.placed.length > best.placed.length)) best = got.best;
  }
  if (!plan && best && best.placed.length >= 2) plan = best;   // ran out of budget or attempts: settle for the best partial diagram (even a small one beats an error)
  if (!plan) {
    Q.flying = false; Q.busy = false;
    busy('This topic is heavily overlapped from every angle right now. Try a smaller topic, or Identify / Locate instead.');
    await sleep(50); showSetup(r.sec); return;
  }
  // pins are numbered in reading order
  const slots = plan.placed.sort((a, b) => a.y - b.y || a.x - b.x).map((a, i) => ({ ...a, i, answer: null, state: 'empty', missed: false, tried: new Set() }));
  withPose(plan.pose, () => layoutPins(slots));
  const clash = (u) => slots.some((s) => s.unit === u || norm(s.unit.name).includes(norm(u.name)) || norm(u.name).includes(norm(s.unit.name)));
  const extra = shuffle(nearby(plan.seedU, r.all.length > r.pool.length + 3 ? r.all : r.pool, 40).filter((u) => !clash(u))).slice(0, 3);
  r.dia = { slots, pose: plan.pose, bank: [...slots.map((s) => s.unit), ...extra].sort((a, b) => disp(a).localeCompare(disp(b))), active: 0, done: false, checked: false, filter: '' };
  await goTo(plan.pose);
  Q.flying = false; makePins(slots, (i) => activate(i, true));
  Q.busy = false; renderLabel(); activate(0, false);
}
function activate(i, fromPin) {
  const d = Q.round?.dia; if (!d) return;
  d.active = i; syncPins(); refreshLabel();
  if (fromPin) panel.querySelectorAll('.qslot')[i]?.scrollIntoView({ block: 'nearest' });
}
function syncPins() {
  const d = Q.round?.dia; if (!d) return;
  for (const s of d.slots) { const n = s.node; if (!n) continue; n.dataset.state = s.state; n.classList.toggle('active', s.i === d.active && !d.done); n.querySelector('.qbadge').textContent = d.done && s.state === 'ok' ? '✓' : d.done && s.state !== 'ok' ? '✗' : String(s.i + 1); }
}
function assign(unitKey) {
  const r = Q.round, d = r.dia; if (!d || d.done) return;
  const s = d.slots[d.active]; if (!s || s.state === 'ok') return;
  const u = d.bank.find((x) => x.key === unitKey); if (!u) return;
  for (const o of d.slots) if (o !== s && o.answer === unitKey && o.state !== 'ok') { o.answer = null; o.state = 'empty'; }
  s.answer = unitKey; s.state = 'filled';
  if (r.cfg.instant) {
    if (u === s.unit) s.state = 'ok';
    else { s.missed = true; s.tried.add(unitKey); s.state = 'bad'; s.answer = null; setTimeout(() => { if (s.state === 'bad' && !d.done) { s.state = 'empty'; syncPins(); refreshLabel(); } }, 900); }
  }
  if (s.state !== 'bad') { const nx = d.slots.find((o) => o.i > s.i && !o.answer && o.state !== 'ok') || d.slots.find((o) => !o.answer && o.state !== 'ok'); if (nx) d.active = nx.i; }
  syncPins();
  if (r.cfg.instant && d.slots.every((o) => o.state === 'ok')) { d.allOk = true; renderLabel(); } else refreshLabel();
}
function unassign(i) { const d = Q.round.dia, s = d.slots[i]; if (d.done || s.state === 'ok') return; s.answer = null; s.state = 'empty'; d.active = i; syncPins(); refreshLabel(); }
function checkAnswers() {
  const d = Q.round.dia; if (d.done) return;
  for (const s of d.slots) { if (s.state === 'ok') continue; s.state = s.answer === s.unit.key ? 'ok' : 'bad'; if (s.state === 'bad') s.missed = true; }
  d.checked = true; d.done = true; finishDiagramStats(); syncPins(); renderLabel();
}
function revealAll() {
  const d = Q.round.dia; if (d.done) return;
  for (const s of d.slots) if (s.state !== 'ok') { s.missed = true; s.state = 'bad'; }
  d.done = true; finishDiagramStats(); syncPins(); renderLabel();
}
function finishDiagramStats() {
  const r = Q.round, d = r.dia;
  for (const s of d.slots) { const ok = s.state === 'ok' && !s.missed; recordAnswer(s.unit, ok, { text: disp(s.unit), pin: s.i + 1 }); }
  r.total += d.slots.length; d.stats = true;
}
function paintBank() {
  const d = Q.round?.dia, box = panel.querySelector('.qbank'); if (!d || !box) return;
  const f = d.filter.trim().toLowerCase(), act = d.slots[d.active];
  const used = new Map(d.slots.filter((s) => s.answer).map((s) => [s.answer, s.i]));
  box.replaceChildren(...d.bank.filter((u) => !f || disp(u).toLowerCase().includes(f)).map((u) => {
    const tried = act?.tried.has(u.key), u1 = used.get(u.key);
    return h('button', { class: 'qchip' + (u1 != null ? ' used' : '') + (tried ? ' tried' : ''), type: 'button', disabled: d.done || tried || act?.state === 'ok', 'data-key': u.key,
      onclick: () => assign(u.key) }, u1 != null ? h('i', {}, String(u1 + 1)) : null, disp(u));
  }));
}
function refreshLabel() {   // partial update: keeps the type-ahead input and its focus
  const d = Q.round?.dia; if (!d) return;
  renderSlots(); paintBank();
  const ok = d.slots.filter((s) => s.state === 'ok').length;
  const c = panel.querySelector('.qprog span:last-child'); if (c) c.textContent = `${ok} / ${d.slots.length} right`;
  const b = panel.querySelector('.qbar i'); if (b) b.style.width = `${Math.round((ok / d.slots.length) * 100)}%`;
}
function renderSlots() {
  const d = Q.round?.dia, box = panel.querySelector('.qslots'); if (!d || !box) return;
  box.replaceChildren(...d.slots.map((s) => {
    const ans = s.answer ? d.bank.find((u) => u.key === s.answer) : null;
    const text = d.done ? disp(s.unit) : s.state === 'ok' ? disp(s.unit) : ans ? disp(ans) : '';
    return h('div', { class: `qslot ${s.state}${s.i === d.active && !d.done ? ' active' : ''}`, 'data-state': s.state },
      h('button', { class: 'qslot-main', type: 'button', 'aria-label': `Pin ${s.i + 1}${text ? `: ${text}` : ', empty'}`, onclick: () => { if (d.done) return revealSlot(s); activate(s.i, false); } },
        h('span', { class: 'qnum' }, String(s.i + 1)), h('span', { class: 'qans' }, text || h('em', {}, s.state === 'bad' ? 'Not that one, try again' : 'Choose a name')),
        d.done ? h('span', { class: 'qmark' }, s.state === 'ok' && !s.missed ? '✓' : '✗') : s.state === 'ok' ? h('span', { class: 'qmark' }, '✓') : null),
      !d.done && s.answer && s.state === 'filled' ? h('button', { class: 'qslot-x', type: 'button', 'aria-label': `Clear pin ${s.i + 1}`, onclick: () => unassign(s.i) }, '×') : null);
  }));
}
function revealSlot(s) {   // after the round: highlight the structure behind a pin and name it
  highlight(s.unit.recs, false); tagUnit(s.unit, disp(s.unit));
}
function renderLabel() {
  const r = Q.round, d = r.dia; if (!d) return;
  const ok = d.slots.filter((s) => s.state === 'ok').length;
  const filterVal = d.filter;
  const input = h('input', { class: 'qfilter', type: 'search', placeholder: 'Type to filter the word bank…', 'aria-label': 'Filter the word bank', value: filterVal,
    oninput: (e) => { d.filter = e.target.value; paintBank(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const c = panel.querySelector('.qchip:not([disabled])'); if (c) { c.click(); e.target.select(); } } } });
  frame(head(`Label the diagram · ${r.sec.label}`, { sub: `${d.slots.length} pins · ${topicName(r)}` }),
    h('div', { class: 'qs-body' },
      h('div', { class: 'qprog' }, h('span', {}, d.done ? 'Diagram finished' : 'Select a pin, then pick its name'), h('span', {}, `${ok} / ${d.slots.length} right`)),
      bar(ok / d.slots.length),
      h('div', { class: 'qslots', role: 'list' }),
      d.done ? null : [input, h('div', { class: 'qbank', role: 'group', 'aria-label': 'Word bank' })],
      h('div', { class: 'qs-actions' },
        d.done ? h('button', { class: 'btn primary', type: 'button', 'data-primary': '', onclick: () => showResults() }, 'See results')
          : [r.cfg.instant ? (d.allOk ? h('button', { class: 'btn primary', type: 'button', 'data-primary': '', onclick: () => { d.done = true; finishDiagramStats(); syncPins(); renderLabel(); } }, 'Finish') : null)
            : h('button', { class: 'btn primary', type: 'button', onclick: () => checkAnswers() }, 'Check answers'),
          h('button', { class: 'btn', type: 'button', onclick: () => goTo(d.pose) }, 'Reset view'),
          h('button', { class: 'btn', type: 'button', onclick: () => revealAll() }, 'Show answers')]),
      d.done ? h('p', { class: 'qs-fine' }, 'Click a row to see that structure highlighted and named on the model.') : null,
      h('div', { class: 'qs-actions foot' }, quitButton())));
  renderSlots(); paintBank();
  if (d.allOk && !d.done) panel.querySelector('[data-primary]')?.focus({ preventScroll: true }); else focusHead();
}

// ------------------------------------------------------------------- results --
async function showResults() {
  const r = Q.round; if (!r) return;
  Q.view = 'results'; atlas.pickHandler = onPick;
  const total = r.mode === 'label' ? r.log.length : r.queue.length, pct = total ? Math.round((r.score / total) * 100) : 0;
  const st = stat(r.sec.key); st.plays++; st.best[r.mode] = Math.max(st.best[r.mode] || 0, pct); st.last = { mode: r.mode, pct, ts: Date.now() }; save();
  const missed = r.log.filter((l) => !l.ok);
  const list = h('ul', { class: 'qres', role: 'list' }, r.log.map((l) => h('li', {}, h('button', { class: 'qres-row ' + (l.ok ? 'ok' : 'bad'), type: 'button', onclick: () => showUnit(l.u) },
    h('span', { class: 'qmark' }, l.ok ? '✓' : '✗'), h('span', {}, l.text || disp(l.u)), l.clicked ? h('small', {}, `you clicked ${l.clicked}`) : null))));
  frame(head('Results', { sub: `${MODES[r.mode].title} · ${r.sec.label}` }),
    h('div', { class: 'qs-body' },
      h('div', { class: 'qscore' }, h('b', {}, `${r.score} / ${total}`), h('span', {}, `${pct}%`)), bar(pct / 100),
      h('p', { class: 'qs-lead' }, pct >= 90 ? 'Excellent.' : pct >= 70 ? 'Solid. A few to revisit.' : pct >= 40 ? 'Getting there. Review the misses below.' : 'Keep at it: try again on Major structures first.'),
      missed.length ? h('p', { class: 'qs-fine' }, 'Click any row to see it in 3D with its name.') : null,
      list,
      h('div', { class: 'qs-actions' },
        h('button', { class: 'btn primary', type: 'button', 'data-primary': '', onclick: () => startRound(r.review) }, 'Try again'),
        missed.length && r.mode !== 'label' ? h('button', { class: 'btn', type: 'button', onclick: () => { Q.cfg = { ...Q.cfg, mode: r.mode }; startRound(true); } }, `Review ${missed.length} missed`) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { unhighlight(); showSetup(r.sec); } }, 'Change quiz'),
        h('button', { class: 'btn', type: 'button', onclick: () => { unhighlight(); showMenu(); } }, 'All sections'))));
  panel.querySelector('[data-primary]')?.focus({ preventScroll: true });
}
async function showUnit(u) {
  highlight(u.recs, false); Q.flying = false;
  { const ps = poseForUnits([u], DIRS[dirFor(u)]); atlas.flyTo(ps.center, ps.radius, ps.dir); }
  await sleep(moveMs()); await frames(2);
  tagUnit(u, disp(u));
}

// ------------------------------------------------------------- open / close --
let closing = null;
async function openStudy() {
  await closing;
  if (Q.open || Q.busy) return; Q.open = true; Q.busy = true;
  Q.snap = snapshot(); Q.scene = ''; Q.token++;
  document.body.classList.add('study-open'); panel.hidden = false; studyBtn.setAttribute('aria-pressed', 'true');
  if (S.pins) document.getElementById('pinsBtn')?.click();          // landmark dots belong to the normal atlas
  S.cur = null; S.curLm = null; S.sel = new Set(); S.ghost = false; S.iso = false; atlas.restyle();
  atlas.pickHandler = onPick;
  hookOff = atlas.onAfterRender(drawOverlay);
  Q.busy = false; showMenu();
  await frames(2);
}
function closeStudy() { if (!Q.open) return closing; return (closing = closeNow()); }
async function closeNow() {
  Q.open = false; Q.token++; Q.busy = false;
  hookOff?.(); hookOff = null; clearOverlay(); atlas.pickHandler = null; Q.round = null; Q.flying = false;
  document.body.classList.remove('study-open'); panel.hidden = true; panel.replaceChildren(); studyBtn.setAttribute('aria-pressed', 'false');
  await restoreScene(Q.snap); Q.scene = '';
  { const [k, was] = [...Q.snap.vis][0]; await atlas.setSystemVisible(k, was); }   // re-writes the URL hash with the restored selection
  studyBtn.focus({ preventScroll: true });
}
studyBtn.addEventListener('click', () => (Q.open ? closeStudy() : openStudy()));

// keyboard: keep the atlas shortcuts (Esc clears, I isolates, G ghosts, F focuses) from touching the quiz state, and add 1-9 for answers
window.addEventListener('keydown', (e) => {
  if (!Q.open || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target.matches?.('input, textarea, select');
  if (!typing && ['/', 'Escape', 'g', 'G', 'i', 'I', 'f', 'F'].includes(e.key)) { e.stopPropagation(); return; }
  if (typing) return;
  const r = Q.round;
  if (/^[1-9]$/.test(e.key) && r) {
    const i = +e.key - 1;
    if (r.mode === 'label' && r.dia && !r.dia.done) { if (r.dia.slots[i]) { activate(i, false); e.preventDefault(); } }
    else if (r.q && r.mode !== 'locate') { choose(i); e.preventDefault(); }
  } else if (e.key === 'Enter' && r?.q?.answered && e.target === document.body) { panel.querySelector('[data-primary]')?.click(); }
  else if ((e.key === 'r' || e.key === 'R') && r) { if (r.mode === 'label' && r.dia) goTo(r.dia.pose); else resetView(); }
}, true);
document.getElementById('lang')?.addEventListener('change', () => { if (Q.open) { if (Q.view === 'menu') showMenu(); else if (Q.view === 'setup') showSetup(Q.section); else if (Q.view === 'results') showResults(); else renderCurrent(); } });

// ---------------------------------------------------------------------- API --
atlas.quiz = {
  open: openStudy, close: closeStudy, isOpen: () => Q.open, state: () => Q, seed, sections, modesFor, units: sectionUnits,
  pool: (key, cfg) => poolFor(sections().find((s) => s.key === key), { mode: 'identify', group: '', level: 'all', ...cfg }).pool,
  select: showSetup, start: (cfg) => { Object.assign(Q.cfg, cfg); return startRound(false); },
  choose, activate, assign, checkAnswers, revealAll, storageKey: KEY, stats: () => P,
};
window.dispatchEvent(new CustomEvent('atlas:quiz-ready'));
}
