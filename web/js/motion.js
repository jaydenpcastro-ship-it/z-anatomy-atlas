// Joint / muscle motion animations: osteokinematics (how the bone swings) and arthrokinematics (how the joint surfaces move),
// drawn with labels on the 3D model. Data: data/motions.json (baked from the real meshes by tools/export_motions.py).
//
// A motion is a chain of ops ordered outer -> inner (a rotation about a pivot/axis, or a translation). A bone's transform is the
// product of the ops whose moving set contains it, so coupled movements (scapulohumeral rhythm, spine levels, MCP+PIP+DIP) compose.
// Everything the module changes on the scene (transforms, materials, visibility, muscle vertices) is put back by stop().
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const atlas = window.atlas;
await atlas.ready;
const { el, S: AS, scene, camera, stage, controls } = atlas;
const V3 = THREE.Vector3, M4 = THREE.Matrix4, DEG = Math.PI / 180;
const $ = (s, r = document) => r.querySelector(s);

const [MO, FACTS, VO] = await Promise.all([
  fetch(`${atlas.CFG.dataBase}motions.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  atlas.loadFacts(), atlas.loadVocab(),
]);
if (!MO) {
  atlas.motion = { open: () => atlas.notify('Motion data is not available'), stop() {}, play() {}, pause() {} };
} else boot();

function boot() {
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const jointLabel = (j) => VO.joints?.[j]?.label?.replace(/ \(.*\)$/, '') || j;
  const moveLabel = (m) => VO.movementLabels?.[m] || m;
  const stripSide = (id) => id.replace(/\.(l|r)$/, '');
  const sideOf = (rec) => (rec?.side === 'r' ? 'r' : 'l');
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------ indexes -----
  const LEVEL = MO.levels || {};
  const idsOfSite = (st) => {
    const s = new Set(st.mov || []);
    if (st.upTo != null) for (const [id, l] of Object.entries(LEVEL)) if (l <= st.upTo) s.add(id);
    return s;
  };
  const siteOf = (joint, key, side) => { const s = MO.joints[joint].sites[key]; return s[side] || s.m; };
  // bone (base name) -> joints it takes part in, via the fixed / moving sets of each joint's main site
  const boneJoints = new Map();
  const addBone = (id, joint) => { const b = stripSide(id); if (!boneJoints.has(b)) boneJoints.set(b, new Set()); boneJoints.get(b).add(joint); };
  for (const [joint, J] of Object.entries(MO.joints)) {
    const mains = new Set(Object.values(J.moves).map((m) => m.main));
    for (const key of mains) {
      const s = J.sites[key]; if (!s) continue;
      for (const st of Object.values(s)) {
        for (const id of st.fix || []) addBone(id, joint);
        if (st.upTo == null) for (const id of st.mov || []) addBone(id, joint);
      }
    }
    // spinal chains: the vertebra above / below every level belongs to the joint
    if (/spine/.test(joint)) for (const s of Object.values(J.sites)) { const st = s.m; if (st?.upTo != null) for (const id of Object.keys(LEVEL)) if (LEVEL[id] === st.upTo && /Vertebra|Atlas|Axis/.test(id)) addBone(id, joint); }
  }
  const groupJoints = VO.manifestGroups || {};
  const discJoint = (name) => { const m = name.match(/^Intervertebral disc ([CTL])/); return m ? { C: 'cervical-spine', T: 'thoracic-spine', L: 'lumbar-spine' }[m[1]] : null; };

  const resolveFacts = (name) => { let f = FACTS[name], n = 0; while (typeof f === 'string' && n++ < 4) f = FACTS[f]; return f && typeof f === 'object' ? f : null; };
  const hasMotion = (j, m) => !!MO.joints[j]?.moves?.[m];

  // What the Motion tab can show for a structure: [{ joint, moves: [{ m, role }] }]
  function targetsFor(rec) {
    if (!rec) return [];
    let joints = [];
    if (atlas.isMuscle(rec)) {
      const f = resolveFacts(rec.name);
      const by = new Map();
      for (const [j, m, role] of f?.acts || []) if (hasMotion(j, m)) { if (!by.has(j)) by.set(j, []); by.get(j).push({ m, role }); }
      return [...by].map(([joint, moves]) => ({ joint, moves }));
    }
    if (rec.system === 'skeletal') joints = [...(boneJoints.get(rec.name) || [])];
    else if (rec.system === 'joints') {
      const g = (rec.group || '').replace(/\.g$/, '');
      joints = discJoint(rec.name) ? [discJoint(rec.name)] : (groupJoints[g] || []);
    }
    return joints.filter((j) => MO.joints[j]).map((joint) => ({ joint, moves: Object.keys(MO.joints[joint].moves).map((m) => ({ m, role: '' })) }));
  }

  // ------------------------------------------------------- scene helpers ----
  const decor = new THREE.Group(); decor.name = 'motion-decor'; decor.renderOrder = 20; scene.add(decor);
  const skelGroup = () => AS.sys.get('skeletal');
  const boneMeshes = (id) => atlas.meshesOf(id);
  const matCache = new Map();
  function roleMat(base, role) {
    const key = role; let per = matCache.get(base); if (!per) matCache.set(base, per = {});
    if (per[key]) return per[key];
    const m = base.clone();
    if (role === 'ghost') { m.transparent = true; m.opacity = 0.09; m.depthWrite = false; }
    else if (role === 'ghostfix') { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; }
    else if (role === 'moving') { m.color = m.color.clone().lerp(new THREE.Color('#79b6ff'), 0.38); m.emissive = new THREE.Color('#2d8cff').multiplyScalar(0.12); }
    else if (role === 'muscle') { m.emissive = base.color.clone().multiplyScalar(0.5); }
    else if (role === 'fixed') { m.emissive = new THREE.Color('#ffffff').multiplyScalar(0.07); }
    per[key] = m; return m;
  }
  const px2world = (pos, px) => {
    const d = camera.position.distanceTo(pos), h = Math.max(stage.clientHeight, 1);
    return (px * 2 * d * Math.tan(camera.fov * DEG / 2)) / h;
  };

  // ------------------------------------------------------------- session ----
  let SES = null, uid = 0;
  const listeners = new Set();           // panel refreshers
  const worldOf = (mesh) => { mesh.updateWorldMatrix(true, false); return mesh.matrixWorld; };

  function opMatrix(op, val, out) {
    if (op.kind === 't') return out.makeTranslation(op.axis.x * val, op.axis.y * val, op.axis.z * val);
    out.makeRotationAxis(op.axis, val * DEG);
    const e = out.elements, p = op.p;
    e[12] = p.x - (e[0] * p.x + e[4] * p.y + e[8] * p.z);
    e[13] = p.y - (e[1] * p.x + e[5] * p.y + e[9] * p.z);
    e[14] = p.z - (e[2] * p.x + e[6] * p.y + e[10] * p.z);
    return out;
  }

  async function startSession(cfg) {
    stopSession(true);
    const id = ++uid;
    const J = MO.joints[cfg.joint], mv = J?.moves[cfg.movement];
    if (!mv) return null;
    const side = cfg.side || 'l';
    const S0 = {
      id, cfg, joint: cfg.joint, movement: cfg.movement, side, mv, J, view: cfg.view || 'bone', rec: cfg.rec || null,
      playing: !reduceMotion(), speed: cfg.speed || 1, mode: 'pingpong', t: 0, u: reduceMotion() ? 1 : 0, scrub: false,
      ops: [], boneOps: new Map(), touched: [], enforce: [], labels: [], objs: [], polys: [], ready: false, dirty: true, key: cfg.key, standalone: !!cfg.standalone,
    };
    SES = S0;
    // ops with per-side signs
    const si = side === 'l' ? 4 : 5;
    if (mv.circ) {
      const c = mv.circ[side];
      for (const tag of ['a', 'b']) {
        const [key, ax, sg] = c[tag], st = siteOf(cfg.joint, key, side);
        S0.ops.push({ key, kind: 'r', w: 1, sign: sg, circ: tag, site: st, p: new V3(...st.p), axis: new V3(...st.ax[ax]).normalize(), ids: idsOfSite(st), axName: ax });
      }
    } else {
      for (const o of mv.ops) {
        const st = siteOf(cfg.joint, o[0], side);
        S0.ops.push({ key: o[0], kind: o[2], w: o[3], sign: o[si], site: st, p: new V3(...st.p), axis: new V3(...st.ax[o[1]]).normalize(), ids: idsOfSite(st), axName: o[1] });
      }
    }
    S0.primary = Math.max(0, S0.ops.findIndex((o) => o.key === mv.main && o.kind !== 'c'));
    if (S0.ops[S0.primary]?.kind === 'c') S0.primary = Math.max(0, S0.ops.findIndex((o) => o.kind !== 'c'));
    S0.site = S0.ops[S0.primary].site;
    S0.range = mv.range; S0.off = mv.off || 0; S0.mag = mv.mag || 1;
    S0.fixIds = new Set(S0.ops.filter((o) => o.key === mv.main).flatMap((o) => o.site.fix || []));
    if (!S0.fixIds.size) for (const o of S0.ops) for (const f of o.site.fix || []) S0.fixIds.add(f);
    S0.movIds = new Set(); for (const o of S0.ops) for (const i of o.ids) S0.movIds.add(i);
    // per-op matrices + which ops move each bone (outer -> inner order is the array order)
    S0.opM = S0.ops.map(() => new M4());
    S0.tmp = new M4();
    // load what the view needs, without touching the atlas' own visibility state
    const need = ['skeletal']; if (cfg.muscle) need.push('muscular', 'insertions');
    await Promise.all(need.map((k) => atlas.loadSystem(k)));
    if (uid !== id || SES !== S0) return null;
    prepareScene(S0);
    S0.ready = true;
    for (const f of listeners) f('start');
    return S0;
  }

  function stopSession(silent) {
    const S0 = SES; SES = null; uid++;
    if (!S0) return;
    for (const rec of S0.touched) {
      const m = rec.mesh;
      m.matrixAutoUpdate = rec.auto; m.matrix.copy(rec.local0); m.matrixWorldNeedsUpdate = true; m.frustumCulled = rec.cull;
      if (rec.p0) { m.geometry.attributes.position.array.set(rec.p0); m.geometry.attributes.position.needsUpdate = true; if (rec.n0) { m.geometry.attributes.normal.array.set(rec.n0); m.geometry.attributes.normal.needsUpdate = true; } }
    }
    for (const [k, v] of S0.groupVis || []) { const st = AS.sys.get(k); if (st) st.group.visible = v; }
    for (const o of S0.objs) { decor.remove(o); if (!o.userData.keepGeo) o.geometry?.dispose?.(); o.material?.dispose?.(); }
    for (const l of S0.labels) l.el.remove();
    S0.hud?.remove();
    atlas.restyle();       // materials + visibility back to the atlas' own selection styling
    atlas.rebuildPins();   // landmark pins on any bone this session moved go back to their rest position
    atlas.render();
    if (!silent) for (const f of listeners) f('stop');
  }

  // ------------------------------------------------------------ scene prep ---
  function prepareScene(S0) {
    // 1. system groups: only skeleton (+ the muscle and its attachments) are shown while a motion plays
    S0.groupVis = new Map();
    const show = new Set(['skeletal']); if (S0.cfg.muscle) { show.add('muscular'); show.add('insertions'); }
    for (const [k, st] of AS.sys) { S0.groupVis.set(k, st.visible); }
    S0.showSys = show;
    // 2. bones: role per skeletal structure; remember every mesh's local matrix
    const bones = AS.M.structures.filter((r) => r.system === 'skeletal' && atlas.meshesOf(r.id).length);
    S0.boneRecs = bones;
    for (const r of bones) {
      const moving = S0.movIds.has(r.id), fixed = S0.fixIds.has(r.id);
      const ops = []; S0.ops.forEach((o, i) => { if (o.ids.has(r.id)) ops.push(i); });
      S0.boneOps.set(r.id, { ops, moving, fixed, m: new M4() });
      for (const mesh of atlas.meshesOf(r.id)) {
        mesh.updateWorldMatrix(true, false);
        const rec = { mesh, id: r.id, local0: mesh.matrix.clone(), auto: mesh.matrixAutoUpdate, cull: mesh.frustumCulled, P: mesh.parent ? mesh.parent.matrixWorld.clone() : new M4() };
        rec.Pinv = rec.P.clone().invert();
        S0.touched.push(rec);
        mesh.matrixAutoUpdate = false;
        rec.role = ops.length ? 'moving' : fixed ? 'fixed' : 'ghost';
      }
    }
    S0.boneRecsTouched = S0.touched.slice();
    // 3. muscle + attachments
    if (S0.cfg.muscle) prepareMuscle(S0);
    S0.mode = 'pingpong';
    zeroFrame(S0);
    applyView(S0);
    frame(S0);
    buildDecor(S0);
    buildHud(S0);
    flyToView(S0);
    evaluate(S0); applyBones(S0); enforce(S0); updateDecor(S0); updateHud(S0);
    S0.dirty = true;
  }

  // Which meshes are visible / how they are drawn, per view. Re-applied every frame because restyle() may run at any time.
  function applyView(S0) {
    S0.enforce = [];
    const surfaces = S0.view === 'surface';
    const near = new Set();
    if (surfaces) {
      const p = S0.site.p, R = Math.max(0.05, S0.site.r * 2.6 + 0.03), pv = new V3(...p);
      for (const r of S0.boneRecs) if (S0.movIds.has(r.id) || S0.fixIds.has(r.id)) {
        const box = new THREE.Box3(); for (const m of atlas.meshesOf(r.id)) box.expandByObject(m);
        if (box.distanceToPoint(pv) < R * 0.55) near.add(r.id);
      }
      S0.near = near;
    }
    for (const rec of S0.boneRecsTouched) {
      const base = rec.mesh.userData.m0;
      let role = rec.role, vis = true;
      if (surfaces) {
        if (!near.has(rec.id)) vis = false;
        else if (S0.fixIds.has(rec.id) && !S0.movIds.has(rec.id)) role = 'ghostfix';
        else role = 'moving';
      }
      S0.enforce.push({ mesh: rec.mesh, mat: roleMat(base, role), vis });
    }
    for (const e of S0.muscleEnforce || []) S0.enforce.push(surfaces && !e.always ? { ...e, vis: false } : e);
  }
  function enforce(S0) {
    for (const k of AS.sys.keys()) { const st = AS.sys.get(k); const want = S0.showSys.has(k); if (st.group.visible !== want) st.group.visible = want; }
    for (const e of S0.enforce) { if (e.mesh.material !== e.mat) e.mesh.material = e.mat; if (e.mesh.visible !== e.vis) e.mesh.visible = e.vis; }
  }

  atlas.motion = {
    open: (req) => openMotion(req), play: () => setPlaying(true), pause: () => setPlaying(false), stop: () => stopSession(),
    get session() { return SES; }, data: MO,
    // Runs the whole per-frame pipeline (pose, bone transforms, decor, labels) synchronously for whatever S0.u
    // currently is, independent of the ambient render loop's own rAF timing. Used by the video export to step
    // through poses deterministically instead of hoping a background tab's rAF happens to tick in time.
    renderPoseNow: () => {
      const S0 = SES; if (!S0 || !S0.ready) return;
      evaluate(S0); applyBones(S0); enforce(S0); updateDecor(S0); updateHud(S0); updateLandmarkPins(S0); updateLabels(S0);
    },
  };
  window.__motion = { get ses() { return SES; }, MO, startSession, stopSession, targetsFor };

  // ----------------------------------------------------------- muscle prep ---
  const bonePtsCache = new Map();
  function bonePts(id) {
    if (bonePtsCache.has(id)) return bonePtsCache.get(id);
    const pts = [], v = new V3();
    for (const m of atlas.meshesOf(id)) {
      const a = m.geometry.attributes.position, mw = worldOf(m), step = Math.max(1, Math.floor(a.count / 120));
      for (let i = 0; i < a.count; i += step) pts.push(v.fromBufferAttribute(a, i).applyMatrix4(mw).clone());
    }
    bonePtsCache.set(id, pts); return pts;
  }
  function ownerOf(S0, pt) {
    let best = null, bd = 1e9;
    for (const r of S0.boneRecs) for (const q of bonePts(r.id)) { const d = q.distanceToSquared(pt); if (d < bd) { bd = d; best = r.id; } }
    return best;
  }
  const isEnd = (r) => /\.e\d*[lr]$/.test(r.id);
  function prepareMuscle(S0) {
    const mrec = S0.cfg.muscle, side = mrec.side || '';
    const whole = atlas.wholeOf(mrec).filter((r) => !r.side || r.side === side);
    S0.muscleRecs = whole; S0.muscleEnforce = [];
    const names = new Set(whole.map((r) => r.name));
    const g = AS.groups.get(mrec.group); if (g && /^(?!Muscles).+ muscle$/i.test(g.name)) names.add(g.name);
    // attachment markers (origin = orange, insertion = blue) share the muscle's name in the insertions system
    const att = AS.M.structures.filter((r) => r.system === 'insertions' && names.has(r.name) && (!side || r.side === side));
    const O = [], I = [];
    for (const r of att) {
      const meshes = atlas.meshesOf(r.id); if (!meshes.length) continue;
      const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m);
      const c = box.getCenter(new V3()), owner = ownerOf(S0, c);
      for (const m of meshes) {
        const rec = { mesh: m, id: r.id, ownerId: owner, local0: m.matrix.clone(), auto: m.matrixAutoUpdate, cull: m.frustumCulled, P: m.parent.matrixWorld.clone(), role: 'pin' };
        rec.Pinv = rec.P.clone().invert(); S0.touched.push(rec); m.matrixAutoUpdate = false;
        S0.muscleEnforce.push({ mesh: m, mat: m.userData.m0, vis: true, always: false });
      }
      (isEnd(r) ? I : O).push({ pt: c, owner, id: r.id });
    }
    // the muscle meshes: highlighted, and deformed between the bones that carry the origin and the insertion
    const mm = whole.flatMap((r) => atlas.meshesOf(r.id));
    const all = new THREE.Box3(); for (const m of mm) all.expandByObject(m);
    if (!O.length || !I.length) {        // no attachment markers for this structure: use the two ends of the muscle along its longest axis
      const sz = all.getSize(new V3()), c = all.getCenter(new V3()), ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
      const a = c.clone(), b = c.clone(); a[ax] = all.min[ax]; b[ax] = all.max[ax];
      const fixedC = new V3(...S0.site.p), near = a.distanceTo(fixedC) < b.distanceTo(fixedC) ? [a, b] : [b, a];
      if (!O.length) O.push({ pt: near[0], owner: ownerOf(S0, near[0]), id: 'end' });
      if (!I.length) I.push({ pt: near[1], owner: ownerOf(S0, near[1]), id: 'end' });
    }
    const shown = new Set([...whole.map((r) => r.id), ...att.map((r) => r.id)]);       // every other muscle / attachment marker is hidden while this one is animated
    for (const r of AS.M.structures) if ((r.system === 'muscular' || r.system === 'insertions') && !shown.has(r.id)) for (const m of atlas.meshesOf(r.id)) S0.muscleEnforce.push({ mesh: m, mat: m.userData.m0, vis: false, always: true });
    const mean = (L) => L.reduce((a, o) => a.add(o.pt), new V3()).multiplyScalar(1 / L.length);
    const Om = mean(O), Im = mean(I), Lm = Math.max(Om.distanceTo(Im), 1e-4), axisU = Im.clone().sub(Om).normalize();
    S0.pull = { O, I, Om, Im, L0: Lm };
    S0.skin = { ownerO: O[0].owner, ownerI: I[0].owner };
    for (const m of mm) {
      const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, n = pos.count, mw = worldOf(m).clone();
      const rec = { mesh: m, id: 'muscle', local0: m.matrix.clone(), auto: m.matrixAutoUpdate, cull: m.frustumCulled, P: new M4(), Pinv: new M4(), role: 'muscle', skin: true,
        p0: pos.array.slice(), n0: nor ? nor.array.slice() : null };
      const wpos = new Float32Array(n * 3), wnor = new Float32Array(n * 3), wt = new Float32Array(n);
      const v = new V3(), nn = new V3(), nm = new THREE.Matrix3().getNormalMatrix(mw);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mw); wpos[i * 3] = v.x; wpos[i * 3 + 1] = v.y; wpos[i * 3 + 2] = v.z;
        wt[i] = smooth(0.08, 0.92, v.clone().sub(Om).dot(axisU) / Lm);
        if (nor) { nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); wnor[i * 3] = nn.x; wnor[i * 3 + 1] = nn.y; wnor[i * 3 + 2] = nn.z; }
      }
      rec.wpos = wpos; rec.wnor = wnor; rec.wt = wt; rec.inv = mw.clone().invert(); rec.mw = mw;
      m.frustumCulled = false; S0.touched.push(rec);
      S0.muscleEnforce.push({ mesh: m, mat: roleMat(m.userData.m0, 'muscle'), vis: true, always: false });
    }
  }
  const _A = new M4();
  function skinMuscle(S0) {
    const ownerM = (id) => S0.boneOps.get(id)?.m || _A.identity();
    const a = ownerM(S0.skin.ownerO).elements, b = ownerM(S0.skin.ownerI).elements;
    for (const rec of S0.touched) {
      if (!rec.skin) continue;
      const pos = rec.mesh.geometry.attributes.position, nor = rec.mesh.geometry.attributes.normal, n = pos.count, arr = pos.array, iv = rec.inv.elements, mw = rec.mw.elements;
      for (let i = 0; i < n; i++) {
        const x = rec.wpos[i * 3], y = rec.wpos[i * 3 + 1], z = rec.wpos[i * 3 + 2], w = rec.wt[i], w0 = 1 - w;
        const px = w0 * (a[0] * x + a[4] * y + a[8] * z + a[12]) + w * (b[0] * x + b[4] * y + b[8] * z + b[12]);
        const py = w0 * (a[1] * x + a[5] * y + a[9] * z + a[13]) + w * (b[1] * x + b[5] * y + b[9] * z + b[13]);
        const pz = w0 * (a[2] * x + a[6] * y + a[10] * z + a[14]) + w * (b[2] * x + b[6] * y + b[10] * z + b[14]);
        arr[i * 3] = iv[0] * px + iv[4] * py + iv[8] * pz + iv[12];
        arr[i * 3 + 1] = iv[1] * px + iv[5] * py + iv[9] * pz + iv[13];
        arr[i * 3 + 2] = iv[2] * px + iv[6] * py + iv[10] * pz + iv[14];
        if (nor && rec.n0) {
          const nx = rec.wnor[i * 3], ny = rec.wnor[i * 3 + 1], nz = rec.wnor[i * 3 + 2];
          const qx = w0 * (a[0] * nx + a[4] * ny + a[8] * nz) + w * (b[0] * nx + b[4] * ny + b[8] * nz);
          const qy = w0 * (a[1] * nx + a[5] * ny + a[9] * nz) + w * (b[1] * nx + b[5] * ny + b[9] * nz);
          const qz = w0 * (a[2] * nx + a[6] * ny + a[10] * nz) + w * (b[2] * nx + b[6] * ny + b[10] * nz);
          const lx = mw[0] * qx + mw[1] * qy + mw[2] * qz, ly = mw[4] * qx + mw[5] * qy + mw[6] * qz, lz = mw[8] * qx + mw[9] * qy + mw[10] * qz, l = Math.hypot(lx, ly, lz) || 1;
          nor.array[i * 3] = lx / l; nor.array[i * 3 + 1] = ly / l; nor.array[i * 3 + 2] = lz / l;
        }
      }
      pos.needsUpdate = true; if (nor) nor.needsUpdate = true;
    }
  }

  // ----------------------------------------------------------- evaluation ----
  function cycle(p, circ) {
    const e = (t) => t * t * (3 - 2 * t);
    if (circ) return p;
    if (p < 0.1) return 0; if (p < 0.45) return e((p - 0.1) / 0.35); if (p < 0.6) return 1; if (p < 0.95) return 1 - e((p - 0.6) / 0.35); return 0;
  }
  function evaluate(S0) {
    const mv = S0.mv, u = S0.u;
    S0.disp = mv.range[0] + (mv.range[1] - mv.range[0]) * u;
    S0.ops.forEach((o, i) => {
      let val;
      if (o.kind === 'c') val = o.sign * o.w;
      else if (o.circ) { const th = 2 * Math.PI * u, env = smooth(0, 0.12, u) * smooth(1, 0.88, u); val = o.sign * mv.circ.amp * env * (o.circ === 'a' ? Math.sin(th) : Math.cos(th)); }
      else val = o.sign * o.w * (S0.disp - S0.off) * S0.mag;
      o.val = val; opMatrix(o, val, S0.opM[i]);
    });
    for (const b of S0.boneOps.values()) if (b.ops.length) { b.m.identity(); for (const i of b.ops) b.m.multiply(S0.opM[i]); }
  }
  function applyBones(S0) {
    for (const rec of S0.touched) {
      if (rec.skin) continue;
      const b = S0.boneOps.get(rec.ownerId || rec.id); if (!b || !b.ops.length) continue;
      rec.mesh.matrix.copy(rec.Pinv).multiply(b.m).multiply(rec.P).multiply(rec.local0); rec.mesh.matrixWorldNeedsUpdate = true;
    }
    if (S0.pull) skinMuscle(S0);
  }
  // Landmark pins are a flat point cloud owned by app.js, not part of the bone hierarchy, so they don't move with
  // a bone on their own; glue any pin on a bone this session is actually swinging to that bone's current transform.
  function updateLandmarkPins(S0) {
    if (!AS.pins) return;
    for (const [boneId, b] of S0.boneOps) {
      if (!b.ops.length) continue;
      const lms = AS.lmByTarget.get(boneId); if (!lms) continue;
      for (const l of lms) atlas.movePinTo(l.id, new V3(...l.pos).applyMatrix4(b.m));
    }
  }
  const pointVia = (S0, boneId, q, out = new V3()) => out.copy(q).applyMatrix4(S0.boneOps.get(boneId)?.m || _A.identity());

  // The base pose (movement ops at zero, pre-poses applied): pivot, axis, reference direction and the material probe point.
  function zeroFrame(S0) {
    S0.ops.forEach((o, i) => opMatrix(o, o.kind === 'c' ? o.sign * o.w : 0, S0.opM[i]));
    const prim = S0.ops[S0.primary], first = [...prim.ids][0];
    const Mo0 = new M4(); for (let i = 0; i < S0.primary; i++) if (S0.ops[i].ids.has(first)) Mo0.multiply(S0.opM[i]);
    S0.pivot0 = prim.p.clone().applyMatrix4(Mo0); S0.axis0 = prim.axis.clone().transformDirection(Mo0);
    const pr = new V3(...S0.mv.pr[S0.side]), Mb = new M4();
    for (let i = 0; i < S0.ops.length; i++) if (S0.ops[i].ids.has(first)) Mb.multiply(S0.opM[i]);
    S0.q0 = pr.clone().applyMatrix4(Mb.clone().invert()); S0.probeBone = first; S0.pr0 = pr;
    let r0 = perpTo(pr.clone().sub(S0.pivot0), S0.axis0);
    if (r0.length() < 0.012) { r0 = perpTo(new V3(0, 1, 0), S0.axis0); if (r0.length() < 0.1) r0 = perpTo(new V3(1, 0, 0), S0.axis0); }
    S0.reach0 = r0.length(); S0.ref0 = r0.normalize();
    // rotation sense of the primary op as the animation goes from its start to its end
    const dsign = Math.sign(S0.range[1] - S0.range[0]) || 1;
    S0.spin = prim.kind === 'r' ? S0.axis0.clone().multiplyScalar((prim.circ ? 1 : prim.sign) * dsign) : S0.axis0.clone();
    // arthrokinematics: contact normal (pivot -> contact on the fixed surface), roll / glide directions
    const ar = S0.mv.arth || {}, ct = new V3(...S0.site.ct);
    const n = ct.clone().sub(S0.pivot0); if (n.length() < 1e-4) n.set(0, 0, 1); n.normalize();
    const cr = S0.spin.clone().cross(n).normalize();
    const roll = ar.cv === 'm' ? cr.clone().negate() : cr.clone();       // convex moving: the contact travels against the surface velocity; concave moving: with it
    S0.arth = { ...ar, n, ct, roll, glide: ar.cv === 'm' ? roll.clone().negate() : roll.clone(), cr };
  }
  const tipBoneOf = (S0) => {
    const p = new V3(...S0.site.p); let best = null, bd = 0;
    for (const r of S0.boneRecs) if (S0.movIds.has(r.id)) {
      const box = new THREE.Box3(); for (const m of atlas.meshesOf(r.id)) box.expandByObject(m);
      const far = new V3(Math.abs(box.min.x - p.x) > Math.abs(box.max.x - p.x) ? box.min.x : box.max.x, Math.abs(box.min.y - p.y) > Math.abs(box.max.y - p.y) ? box.min.y : box.max.y, Math.abs(box.min.z - p.z) > Math.abs(box.max.z - p.z) ? box.min.z : box.max.z);
      const d = far.distanceTo(p); if (d > bd) { bd = d; best = { id: r.id, pt: far }; }
    }
    return best;
  };
  // ---------------------------------------------------------------- camera ---
  function viewDir(S0) {
    const s = S0.side === 'l' ? 1 : -1, ax = S0.axis0;
    const aX = Math.abs(ax.x), aZ = Math.abs(ax.z), aY = Math.abs(ax.y);
    // oblique views (about 35 deg off the axis) so the axis reads as a line and the arc as an ellipse
    if (S0.ops[S0.primary].kind === 't') return new V3(s * 0.9, 0.25, 0.4).normalize();
    if (aX > 0.7) return new V3(s * 1, 0.3, 0.55).normalize();                    // sagittal-plane movement: from the side and a little in front
    if (aZ > 0.7) return new V3(0.55 * s, 0.3, 1).normalize();                    // frontal-plane movement: from the front and a little to the side
    if (aY > 0.7) return new V3(0.45 * s, 0.85, 0.5).normalize();                 // rotation about a vertical axis: from above and in front
    return new V3(0.6 * s, -0.4 * Math.sign(ax.y || -1), 0.7).normalize();       // rotation about a limb's long axis
  }
  function frame(S0) {
    const save = S0.u; S0.u = 1; evaluate(S0);
    const tb = tipBoneOf(S0), pts = [new V3(...S0.site.p)];
    if (tb) pts.push(tb.pt.clone(), pointVia(S0, tb.id, tb.pt));
    if (S0.pull) for (const o of [...S0.pull.O, ...S0.pull.I]) pts.push(o.pt.clone(), pointVia(S0, o.owner, o.pt));
    S0.u = save; evaluate(S0);
    const box = new THREE.Box3().setFromPoints(pts);
    S0.frameC = box.getCenter(new V3()); S0.frameR = Math.max(box.getSize(new V3()).length() / 2, 0.06);
  }
  function flyToView(S0) {
    const site = S0.site, pv = new V3(...site.p);
    if (S0.view === 'surface') atlas.flyTo(pv.clone().lerp(new V3(...site.ct), 0.5), Math.max(0.035, site.r * 3.2 + 0.02), viewDir(S0));
    else atlas.flyTo(S0.frameC, S0.frameR * 0.98 + 0.03, viewDir(S0));
  }

  // ------------------------------------------------------------ draw helpers ---
  const COLORS = { axis: '#ffd166', arc: '#ff6b6b', zero: '#9fb3c8', roll: '#3ddc97', glide: '#ff9f43', spin: '#c792ea', pull: '#ff8a80', origin: '#ff7a3d', ins: '#4aa3ff', pivot: '#ffd166' };
  class Poly {
    constructor(S0, n, color, width, { dashed = false, opacity = 0.95 } = {}) {
      this.n = n; this.geo = new LineGeometry(); this.geo.setPositions(new Float32Array(n * 3 + 6));
      this.mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthTest: false, dashed, dashSize: 0.012, gapSize: 0.008 });
      this.line = new Line2(this.geo, this.mat); this.line.renderOrder = 30; this.line.frustumCulled = false; this.dashed = dashed;
      decor.add(this.line); S0.objs.push(this.line); S0.polys.push(this);
    }
    set(pts) {
      const d = this.geo.attributes.instanceStart.data, a = d.array, last = pts[pts.length - 1];
      for (let i = 0; i < this.n - 1; i++) {
        const p = pts[Math.min(i, pts.length - 1)] || last, q = pts[Math.min(i + 1, pts.length - 1)] || last, o = i * 6;
        a[o] = p.x; a[o + 1] = p.y; a[o + 2] = p.z; a[o + 3] = q.x; a[o + 4] = q.y; a[o + 5] = q.z;
      }
      d.needsUpdate = true; if (this.dashed) this.line.computeLineDistances(); this.line.visible = true;
    }
    hide() { this.line.visible = false; }
  }
  class Dot {
    constructor(S0, color, px) {
      this.px = px; this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      this.mesh.renderOrder = 31; this.mesh.frustumCulled = false; decor.add(this.mesh); S0.objs.push(this.mesh);
    }
    set(p) { this.mesh.position.copy(p); this.mesh.scale.setScalar(px2world(p, this.px)); this.mesh.visible = true; }
    hide() { this.mesh.visible = false; }
  }
  const _up = new V3(0, 1, 0);
  class Arrow {
    constructor(S0, color, width = 4, head = 12) {
      this.poly = new Poly(S0, 2, color, width); this.head = head;
      this.cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 14), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.98 }));
      this.cone.renderOrder = 31; this.cone.frustumCulled = false; decor.add(this.cone); S0.objs.push(this.cone);
    }
    set(a, b) {
      const d = b.clone().sub(a), len = d.length(); if (len < 1e-6) return this.hide();
      const hl = Math.min(px2world(b, this.head), len * 0.7); d.normalize();
      this.poly.set([a, b.clone().addScaledVector(d, -hl * 0.55)]);
      this.cone.position.copy(b).addScaledVector(d, -hl / 2); this.cone.scale.set(hl * 0.9, hl, hl * 0.9); this.cone.quaternion.setFromUnitVectors(_up, d); this.cone.visible = true;
    }
    hide() { this.poly.hide(); this.cone.visible = false; }
  }
  function label(S0, text, cls, extra = {}) {
    const e = el('div', { className: `mo-lab ${cls || ''}` }, text);
    $('#overlay').append(e);
    // w/h are the label's actual rendered box (not a guessed constant): measured lazily in updateLabels, the one
    // place it's guaranteed visible (display != none) and holding its current text, and re-measured only when the
    // text changes (`dirty`) so a long line ("Moving: Humerus and forearm") clamps against its real width instead
    // of a fixed margin that's wrong for anything shorter or longer than the guess.
    const l = { el: e, pos: new V3(), dx: extra.dx ?? 10, dy: extra.dy ?? -10, on: true, prio: extra.prio || 0, sx: 0, sy: 0, txt: text, w: null, h: null, dirty: true };
    S0.labels.push(l); return l;
  }
  const setText = (l, t) => { if (l.txt !== t) { l.txt = t; l.el.textContent = t; l.dirty = true; } };
  function perpTo(v, ax) { return v.clone().sub(ax.clone().multiplyScalar(v.dot(ax))); }
  const signedAngle = (a, b, ax) => Math.atan2(ax.dot(a.clone().cross(b)), a.dot(b));
  const rotAbout = (v, ax, ang) => v.clone().applyAxisAngle(ax, ang);
  const dirWord = (v, side) => {
    const s = side === 'l' ? 1 : -1;
    const c = [[v.x * s, 'lateral', 'medial'], [v.y, 'superior', 'inferior'], [v.z, 'anterior', 'posterior']].map(([x, p, n]) => [Math.abs(x), x >= 0 ? p : n]).sort((a, b) => b[0] - a[0]);
    return c[1][0] > 0.55 * c[0][0] && c[1][0] > 0.25 ? `${c[0][1]}-${c[1][1]}` : c[0][1];
  };

  // ------------------------------------------------------------------ decor ---
  const NARC = 40;
  function buildDecor(S0) {
    const d = S0.dec = { pull: [], dots: [] }, prim = S0.ops[S0.primary], surf = S0.view === 'surface', circ = !!S0.mv.circ, isT = prim.kind === 't';
    const info = S0.J.info || {}, ar = S0.arth;
    d.pivot = new Dot(S0, COLORS.pivot, surf ? 4 : 6);
    if (!isT) d.axis = new Poly(S0, 2, COLORS.axis, surf ? 2.5 : 3.5);
    if (!isT && !circ && !surf) {
      d.zero = new Poly(S0, 2, COLORS.zero, 2.5, { dashed: true }); d.cur = new Poly(S0, 2, COLORS.arc, 3.5);
      d.endm = new Poly(S0, 2, COLORS.arc, 2, { dashed: true, opacity: 0.55 }); d.arc = new Poly(S0, NARC + 1, COLORS.arc, 4.5); d.arcTip = new Arrow(S0, COLORS.arc, 4.5, 13);
    }
    if (circ) d.trail = new Poly(S0, 100, COLORS.arc, 3.5, { opacity: 0.8 }), S0.trail = [];
    if (isT && !surf) d.travel = new Arrow(S0, COLORS.axis, 4.5, 13);
    // labels
    if (!surf) {
      if (d.axis) d.lAxis = label(S0, S0.mv.axis || 'Axis', 'ax', { dx: 8, dy: -22, prio: 3 });
      if (d.arc) { d.lTheta = label(S0, '', 'theta', { dx: 6, dy: -12, prio: 5 }); d.lZero = label(S0, '0°', 'dim', { dx: 6, dy: 0 }); d.lEnd = label(S0, '', 'dim', { dx: 6, dy: 0 }); }
      if (isT) d.lTheta = label(S0, '', 'theta', { dx: 8, dy: -12, prio: 5 });
      if (circ) d.lTheta = label(S0, 'Circumduction: cone of movement', 'theta', { dx: 8, dy: -14, prio: 5 });
      d.lFixed = label(S0, `Fixed: ${info.fixed || 'proximal segment'}`, 'fixed', { dx: -8, dy: 12, prio: 2 });
      d.lMoving = label(S0, `Moving: ${info.moving || 'distal segment'}`, 'moving', { dx: 8, dy: 12, prio: 2 });
      d.lPivot = label(S0, 'Joint centre', 'dim', { dx: 8, dy: 6 });
    }
    // muscle: origin / insertion pins and the line of pull
    if (S0.pull) {
      for (const o of S0.pull.O) d.dots.push({ dot: new Dot(S0, COLORS.origin, 6), o });
      for (const o of S0.pull.I) d.dots.push({ dot: new Dot(S0, COLORS.ins, 6), o });
      for (let i = 0; i < S0.pull.O.length; i++) d.pull.push(new Poly(S0, 2, COLORS.pull, 4));
      d.lOrigin = label(S0, 'Origin', 'origin', { dx: 8, dy: -14, prio: 4 }); d.lIns = label(S0, 'Insertion', 'ins', { dx: 8, dy: -14, prio: 4 });
      d.lPull = label(S0, '', 'pull', { dx: 8, dy: 2, prio: 4 });
    }
    // joint-surface view: articular surface ring, contact point, roll / glide / spin arrows
    if (surf) {
      d.ring = new Poly(S0, 49, '#8fb7ff', 2.5, { opacity: 0.85 });
      d.contact = new Dot(S0, '#ffffff', 5);
      const k = ar.k;
      if (k === 'rg' || k === 'rgs') { d.roll = new Arrow(S0, COLORS.roll, 5, 14); d.glide = new Arrow(S0, COLORS.glide, 5, 14); d.lRoll = label(S0, 'ROLL', 'roll', { dx: 8, dy: -6, prio: 6 }); d.lGlide = label(S0, 'GLIDE', 'glide', { dx: 8, dy: 6, prio: 6 }); }
      if (k === 'spin' || k === 'rs' || k === 'rgs') { d.spinArc = new Poly(S0, 33, COLORS.spin, 5); d.spinTip = new Arrow(S0, COLORS.spin, 5, 14); d.lSpin = label(S0, 'SPIN', 'spin', { dx: 8, dy: -6, prio: 6 }); }
      if (k === 'slide' || k === 'rs') { d.slide = new Arrow(S0, COLORS.glide, 5, 14); d.lSlide = label(S0, 'GLIDE', 'glide', { dx: 8, dy: 6, prio: 6 }); }
      d.lConvex = label(S0, '', 'convex', { dx: -6, dy: 8, prio: 3 }); d.lConcave = label(S0, '', 'concave', { dx: 8, dy: -4, prio: 3 });
      d.lContact = label(S0, 'Articular contact', 'dim', { dx: 8, dy: 10 });
      // roll-alone ghost: what pure rolling would do (the convex bone rides out of the socket); glide brings it back
      if (ar.cv === 'm' && (k === 'rg' || k === 'rgs')) {
        d.ghosts = [];
        const gm = new THREE.MeshBasicMaterial({ color: '#3ddc97', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
        for (const rec of S0.boneRecsTouched) if (S0.near.has(rec.id) && S0.boneOps.get(rec.id).ops.length) {
          const g = new THREE.Mesh(rec.mesh.geometry, gm); g.matrixAutoUpdate = false; g.frustumCulled = false; g.userData.keepGeo = true; g.renderOrder = 25;
          decor.add(g); S0.objs.push(g); d.ghosts.push({ g, rec });
        }
        d.lGhost = label(S0, 'Roll alone would carry it out of the socket', 'ghost', { dx: 8, dy: 4, prio: 2 });
      }
    }
    // dynamic label anchors that do not move
    const fixId = [...S0.fixIds][0];
    if (fixId) { const box = new THREE.Box3(); for (const m of atlas.meshesOf(fixId)) box.expandByObject(m); S0.fixAnchor = box.getCenter(new V3()); }
    else S0.fixAnchor = new V3(...S0.site.p);
    S0.romEnd = Math.abs(S0.range[0]) > Math.abs(S0.range[1]) ? S0.range[0] : S0.range[1];
  }

  const _pv = new V3();
  function updateDecor(S0) {
    const d = S0.dec, prim = S0.ops[S0.primary], surf = S0.view === 'surface', isT = prim.kind === 't', circ = !!S0.mv.circ, ar = S0.arth, site = S0.site;
    const Mo = new M4(); for (let i = 0; i < S0.primary; i++) if (S0.ops[i].ids.has(S0.probeBone)) Mo.multiply(S0.opM[i]);
    const pivotW = prim.p.clone().applyMatrix4(Mo), axisW = prim.axis.clone().transformDirection(Mo);
    const prW = pointVia(S0, S0.probeBone, S0.q0);
    const L = surf ? Math.max(site.r * 2.4, 0.025) : clamp(site.reach * 0.5, 0.06, 0.17);
    d.pivot.set(pivotW);
    if (d.axis) {
      d.axis.set([pivotW.clone().addScaledVector(axisW, -L), pivotW.clone().addScaledVector(axisW, L)]);
      if (d.lAxis) d.lAxis.pos.copy(pivotW).addScaledVector(axisW, L);
    }
    if (d.lPivot) d.lPivot.pos.copy(pivotW);
    const Ra = surf ? Math.max(site.r * 1.7, 0.03) : clamp(S0.reach0 * 0.72, 0.035, 0.17);
    if (d.arc) {
      const curP = perpTo(prW.clone().sub(pivotW), S0.axis0); if (curP.length() < 1e-5) curP.copy(S0.ref0); const cur = curP.normalize();
      const zeroDir = rotAbout(S0.ref0, S0.axis0, -prim.sign * S0.off * DEG);
      const ang = signedAngle(zeroDir, cur, S0.axis0), pts = [];
      for (let i = 0; i <= NARC; i++) pts.push(rotAbout(zeroDir, S0.axis0, (ang * i) / NARC).multiplyScalar(Ra).add(pivotW));
      d.arc.set(pts); d.zero.set([pivotW, pivotW.clone().addScaledVector(zeroDir, Ra * 1.15)]); d.cur.set([pivotW, pivotW.clone().addScaledVector(cur, Ra * 1.15)]);
      if (Math.abs(ang) > 0.03) d.arcTip.set(pts[NARC - 3], pts[NARC]); else d.arcTip.hide();
      const endDir = rotAbout(zeroDir, S0.axis0, prim.sign * S0.romEnd * DEG * S0.mag);
      d.endm.set([pivotW, pivotW.clone().addScaledVector(endDir, Ra * 1.15)]);
      d.lTheta.pos.copy(pivotW).addScaledVector(rotAbout(zeroDir, S0.axis0, ang / 2), Ra * 1.22); setText(d.lTheta, `${Math.round(S0.disp)}°`);
      d.lZero.pos.copy(pivotW).addScaledVector(zeroDir, Ra * 1.18); d.lEnd.pos.copy(pivotW).addScaledVector(endDir, Ra * 1.18); setText(d.lEnd, `${S0.romEnd}° end range`);
    }
    if (circ) {
      S0.trail.push(prW.clone()); if (S0.trail.length > 100) S0.trail.shift(); d.trail.set(S0.trail);
      d.lTheta.pos.copy(pivotW).addScaledVector(axisW, L * 0.2).add(new V3(0, L * 1.6, 0));
    }
    if (isT && d.travel) {
      const from = S0.pr0.clone(); d.travel.set(from, prW); d.lTheta.pos.copy(prW); setText(d.lTheta, `${Math.round(S0.disp)} mm`);
    }
    if (d.lFixed) {
      d.lFixed.pos.copy(S0.fixAnchor); d.lMoving.pos.copy(prW);
    }
    // muscle
    if (S0.pull) {
      const Oc = new V3(), Ic = new V3(); let n = 0;
      const Ip = S0.pull.I.map((o) => pointVia(S0, o.owner, o.pt)), Im = Ip.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / Ip.length);
      S0.pull.O.forEach((o, i) => { const p = pointVia(S0, o.owner, o.pt); Oc.add(p); n++; d.pull[i].set([p, Im]); });
      Oc.multiplyScalar(1 / n); Ic.copy(Im);
      for (const { dot, o } of d.dots) dot.set(pointVia(S0, o.owner, o.pt));
      const Lnow = Oc.distanceTo(Ic), pct = Math.round((Lnow / S0.pull.L0) * 100);
      S0.muscleLen = { L: Lnow, pct };
      d.lOrigin.pos.copy(Oc); d.lIns.pos.copy(Ic); d.lPull.pos.copy(Oc).lerp(Ic, 0.5);
      setText(d.lPull, `Line of pull ${pct}% ${pct < 99 ? '▼ shortens' : pct > 101 ? '▲ lengthens' : ''}`);
    }
    // joint surfaces
    if (surf && ar) {
      const conv = ar.cv, ctW = ar.ct, r = site.r || 0.012, th = Math.abs(prim.val || 0) * DEG, arcLen = clamp(r * th, 0.006, 0.07), off = S0.axis0.clone().multiplyScalar(Math.max(r * 0.45, 0.006));
      const ringC = conv === 'f' ? S0.pivot0 : pivotW, ringAx = conv === 'f' ? S0.axis0 : axisW, u0 = perpTo(new V3(0, 1, 0), ringAx).length() > 0.2 ? perpTo(new V3(0, 1, 0), ringAx).normalize() : perpTo(new V3(1, 0, 0), ringAx).normalize();
      const rp = []; for (let i = 0; i <= 48; i++) rp.push(rotAbout(u0, ringAx, (i / 48) * Math.PI * 2).multiplyScalar(r).add(ringC));
      d.ring.set(rp); d.contact.set(ctW);
      if (d.roll) {
        const a1 = ctW.clone().add(off), a2 = ctW.clone().sub(off);
        d.roll.set(a1, a1.clone().addScaledVector(ar.roll, arcLen)); d.glide.set(a2, a2.clone().addScaledVector(ar.glide, arcLen));
        d.lRoll.pos.copy(a1).addScaledVector(ar.roll, arcLen); d.lGlide.pos.copy(a2).addScaledVector(ar.glide, arcLen);
        setText(d.lRoll, `ROLL ${dirWord(ar.roll, S0.side)}`); setText(d.lGlide, `GLIDE ${dirWord(ar.glide, S0.side)}`);
      }
      if (d.ghosts) {
        const shift = new M4().makeTranslation(...ar.roll.clone().multiplyScalar(r * th).toArray());
        for (const { g, rec } of d.ghosts) g.matrix.copy(shift).multiply(S0.boneOps.get(rec.id).m).multiply(rec.P).multiply(rec.local0);
        d.lGhost.pos.copy(pivotW).addScaledVector(ar.roll, r * th).addScaledVector(ar.n, -r * 0.4);
      }
      if (d.spinArc) {
        const pts = [], sweep = clamp(th, 0.6, 5.2), base = perpTo(ar.n, S0.axis0).length() > 0.2 ? perpTo(ar.n, S0.axis0).normalize() : u0;
        for (let i = 0; i <= 32; i++) pts.push(rotAbout(base, axisW, (Math.sign(prim.kind === 'r' ? (S0.spin.dot(axisW) || 1) : 1)) * (sweep * i) / 32).multiplyScalar(r * 1.35).add(pivotW));
        d.spinArc.set(pts); d.spinTip.set(pts[29], pts[32]); d.lSpin.pos.copy(pts[16]);
      }
      if (d.slide) {
        const dir = ar.cr.clone(), a = ctW.clone().addScaledVector(ar.n, r * 0.4);
        d.slide.set(a, a.clone().addScaledVector(dir, Math.max(arcLen, 0.012))); d.lSlide.pos.copy(a).addScaledVector(dir, Math.max(arcLen, 0.012));
        setText(d.lSlide, `GLIDE ${dirWord(dir, S0.side)}`);
      }
      const fixedName = S0.J.info?.fixed || 'fixed bone', movName = S0.J.info?.moving || 'moving bone', cvName = conv === 'm' ? movName : fixedName, ccName = conv === 'm' ? fixedName : movName;
      if (conv) {
        const b1 = (t) => t.split(' (')[0].split(/ and |, /)[0]; setText(d.lConvex, `Convex: ${b1(cvName)}`); setText(d.lConcave, `Concave: ${b1(ccName)}`);
        d.lConvex.pos.copy(ringC).addScaledVector(ar.n, -r * 1.0); d.lConcave.pos.copy(ctW).addScaledVector(ar.n, r * 0.7);
      } else { d.lConvex.on = false; d.lConcave.on = false; }
      d.lContact.pos.copy(ctW);
    }
  }

  // ------------------------------------------------------------------ labels ---
  const _o = {};
  function updateLabels(S0) {
    const W = stage.clientWidth, H = stage.clientHeight, vis = [];
    for (const l of S0.labels) {
      if (l.on === false) { l.el.style.display = 'none'; continue; }
      atlas.project(l.pos, _o);
      if (!_o.visible) { l.el.style.display = 'none'; continue; }
      l.el.style.display = ''; l.sx = _o.x + l.dx; l.sy = _o.y + l.dy; vis.push(l);
    }
    vis.sort((a, b) => a.sy - b.sy || b.prio - a.prio);
    for (let i = 1; i < vis.length; i++) for (let j = 0; j < i; j++) {
      const a = vis[j], b = vis[i];
      if (Math.abs(a.sx - b.sx) < 170 && Math.abs(a.sy - b.sy) < 21) b.sy = a.sy + 21;
    }
    const margin = 4;
    for (const l of vis) {
      if (l.dirty || l.w == null) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; l.dirty = false; }
      const x = clamp(l.sx, margin, Math.max(margin, W - margin - l.w)), y = clamp(l.sy, margin, Math.max(margin, H - margin - l.h));
      l.el.style.transform = `translate(${x}px, ${y}px)`;
    }
    const v = new THREE.Vector2(); atlas.renderer.getDrawingBufferSize(v);
    for (const p of S0.polys) p.mat.resolution.copy(v);
  }

  // ---------------------------------------------------------------------- HUD ---
  function buildHud(S0) {
    const mvLabel = S0.mv.circ ? 'Circumduction' : moveLabel(S0.movement);
    const refs = {};
    const hud = el('div', { className: 'mo-hud', role: 'group', 'aria-label': 'Motion caption' },
      el('div', { className: 'mo-hud-top' }, refs.title = el('b', {}, `${jointLabel(S0.joint)} · ${mvLabel}`),
        refs.play = el('button', { type: 'button', className: 'mo-mini', title: 'Play / pause', onclick: () => setPlaying(!SES.playing) }, '⏸'),
        el('button', { type: 'button', className: 'mo-mini', title: 'Stop and close', onclick: () => closeMotion() }, '✕')),
      refs.sub = el('div', { className: 'mo-hud-sub' }),
      el('div', { className: 'mo-hud-mid' }, refs.theta = el('span', { className: 'mo-theta' }), refs.range = el('span', { className: 'mo-range' })),
      el('div', { className: 'mo-bar' }, refs.band = el('i'), refs.mark = el('em')));
    const unit = S0.mv.unit === 'mm' ? ' mm' : S0.mv.circ ? '' : '°', lo = Math.min(0, ...S0.range), hi = Math.max(0, ...S0.range);
    refs.lo = lo; refs.hi = hi; refs.unit = unit;
    const bits = [S0.side === 'l' ? 'Left' : 'Right'];
    if (S0.cfg.muscle) bits.unshift(`${S0.cfg.muscle.name} · ${S0.cfg.role === 'P' ? 'prime mover' : S0.cfg.role === 'A' ? 'assists' : 'acts here'}`);
    refs.sub.textContent = bits.join(' · ');
    setTimeout(() => {
      refs.band.style.left = `${((Math.min(...S0.range) - lo) / (hi - lo || 1)) * 100}%`; refs.band.style.width = `${(Math.abs(S0.range[1] - S0.range[0]) / (hi - lo || 1)) * 100}%`;
      refs.range.textContent = S0.mv.circ ? 'cone sweep' : `normal range ${Math.min(...S0.range)}–${Math.max(...S0.range)}${unit}${S0.mag > 1 ? ` (drawn ×${S0.mag})` : ''}`;
    }, 0);
    stage.append(hud); S0.hud = hud; S0.hudRefs = refs;
  }
  function updateHud(S0) {
    const r = S0.hudRefs; if (!r) return;
    r.theta.textContent = S0.mv.circ ? '' : `θ ${Math.round(S0.disp)}${r.unit}`;
    r.mark.style.left = `${((S0.disp - r.lo) / (r.hi - r.lo || 1)) * 100}%`;
    r.play.textContent = S0.playing ? '⏸' : '▶';
    if (S0.muscleLen) r.sub.dataset.len = `${S0.muscleLen.pct}%`;
  }
  function closeMotion() { stopSession(); for (const f of listeners) f('closed'); }
  function setPlaying(on) {
    const S0 = SES; if (!S0) return;
    S0.playing = on; S0.scrub = false;
    if (on && S0.mode === 'once' && S0.u >= 0.999) { S0.t = 0; }
    for (const f of listeners) f('play');
  }

  // ------------------------------------------------------------------ frame loop ---
  atlas.onFrame((dt) => {
    const S0 = SES; if (!S0 || !S0.ready) return false;
    if (S0.panelHost && !S0.panelHost.isConnected) { stopSession(); return true; }
    if (S0.playing && !S0.scrub) {
      S0.t += dt * S0.speed;
      const T = S0.mv.circ ? 6.5 : 5, p = (S0.t / T) % 1;
      S0.u = cycle(p, !!S0.mv.circ);
    }
    evaluate(S0); applyBones(S0); enforce(S0); updateDecor(S0); updateHud(S0); updateLandmarkPins(S0);
    if (S0.onTick) S0.onTick(S0);
    return true;
  });
  atlas.onAfterRender(() => { const S0 = SES; if (S0 && S0.ready) updateLabels(S0); });
  window.addEventListener('atlas:select', (e) => { if (SES && !SES.standalone && e.detail?.tab !== 'motion') stopSession(); });
  window.addEventListener('resize', () => { if (SES) atlas.render(); });

  // ------------------------------------------------------------------- panel ---
  const ROLE_TXT = { P: 'Prime mover', A: 'Assists' };
  const TAB = { recId: null, joint: null, move: null, side: 'l', view: 'bone', speed: 1, loop: true };
  const fmtRange = (S0) => {
    const u = S0.mv.unit === 'mm' ? ' mm' : '°', a = S0.range[0], b = S0.range[1];
    return S0.mv.circ ? `cone of ±${S0.mv.circ.amp}°` : `${Math.min(a, b)}–${Math.max(a, b)}${u}${S0.mag > 1 ? ` (real range; drawn ×${S0.mag})` : ''}`;
  };
  function kinematicsBlock(S0) {
    const info = S0.J.info || {}, ar = S0.arth || {}, mv = S0.mv, fixed = info.fixed || 'the fixed bone', moving = info.moving || 'the moving bone';
    const kv = (k, v) => el('div', { className: 'mo-row' }, el('dt', {}, k), el('dd', {}, v));
    const osteo = el('dl', { className: 'mo-kv' },
      kv('Moving', moving), kv('Fixed', fixed), kv('Axis', mv.axis), kv('Plane', mv.plane), kv('Range', fmtRange(S0)));
    const rows = [];
    const cv = ar.cv === 'm' ? moving : ar.cv === 'f' ? fixed : '', cc = ar.cv === 'm' ? fixed : ar.cv === 'f' ? moving : '';
    const strip = (t) => t.split(' (')[0].split(/ and |, /)[0];
    if (ar.k === 'rg' || ar.k === 'rgs') {
      rows.push(kv('Surfaces', `Convex ${strip(cv)} on concave ${strip(cc)}`));
      rows.push(kv('Roll', dirWord(ar.roll, S0.side)), kv('Glide', dirWord(ar.glide, S0.side)));
      if (ar.k === 'rgs') rows.push(kv('Spin', 'about the long axis of the bone (no translation)'));
      rows.push(el('div', { className: 'mo-rule' }, ar.cv === 'm' ? el('span', {}, 'Convex-on-concave: ', el('b', {}, 'roll and glide go in OPPOSITE directions')) : el('span', {}, 'Concave-on-convex: ', el('b', {}, 'roll and glide go in the SAME direction'))));
    } else if (ar.k === 'spin') rows.push(kv('Spin', 'the surfaces rotate about a fixed axis through the joint centre, with no roll or glide'));
    else if (ar.k === 'rs') { rows.push(kv('Spin', 'rotation about the joint axis')); rows.push(kv('Glide', `translation (${dirWord(ar.cr, S0.side)})`)); }
    else if (ar.k === 'slide') rows.push(kv('Glide', `flat surfaces slide over each other (${dirWord(ar.cr, S0.side)})`));
    const arth = el('dl', { className: 'mo-kv' }, ...rows);
    const box = el('div', {},
      el('h3', {}, 'Osteokinematics · the bone swings'), osteo,
      el('h3', {}, 'Arthrokinematics · the joint surfaces move'), arth);
    if (mv.note) box.append(el('p', { className: 'mo-note' }, mv.note));
    const cp = [info.type && ['Joint type', info.type], info.cp && ['Close-packed', info.cp], info.loose && ['Loose-packed', info.loose]].filter(Boolean);
    if (cp.length) box.append(el('dl', { className: 'mo-kv mo-kv2' }, cp.map(([k, v]) => kv(k, v))));
    return box;
  }
  function muscleBlock(S0) {
    const f = resolveFacts(S0.cfg.muscle.name); if (!f) return null;
    const role = S0.cfg.role, name = atlas.nameOf(S0.cfg.muscle);
    const first = (a) => [].concat(a || [])[0] || '';
    const verb = role === 'P' ? 'is a prime mover of' : role === 'A' ? 'assists' : 'acts at';
    return el('div', { className: 'mo-muscle' },
      el('h3', {}, 'Muscle'),
      el('p', {}, el('b', {}, name), ` ${verb} ${moveLabel(S0.movement).toLowerCase()} at the ${jointLabel(S0.joint).toLowerCase()}. It shortens (concentric contraction) to make this movement; the line of pull runs from`),
      el('div', { className: 'mo-ends' }, el('span', { className: 'o' }, el('i', {}, 'Origin'), first(f.o)), el('span', { className: 'i' }, el('i', {}, 'Insertion'), first(f.i))),
      S0.pull ? el('p', { className: 'fine' }, 'Resting length is measured origin-to-insertion; the label on the model shows how it changes through the range.') : null);
  }

  function renderTab(sib, host) {
    const rec = sib[0], targets = targetsFor(rec);
    if (!targets.length) { host.append(el('p', { className: 'fine' }, 'No motion is available for this structure.')); return; }
    const req = atlas.pendingMotion; atlas.pendingMotion = null;
    const isM = atlas.isMuscle(rec);
    if (TAB.recId !== rec.id) Object.assign(TAB, { recId: rec.id, joint: null, move: null, side: sideOf(rec), view: 'bone' });
    if (req && targets.some((t) => t.joint === req.joint)) Object.assign(TAB, { joint: req.joint, move: req.movement, view: 'bone' });
    if (!TAB.joint || !targets.some((t) => t.joint === TAB.joint)) { TAB.joint = targets[0].joint; TAB.move = null; }
    const tg = targets.find((t) => t.joint === TAB.joint);
    if (!TAB.move || !tg.moves.some((x) => x.m === TAB.move)) TAB.move = (tg.moves.find((x) => x.role === 'P') || tg.moves[0]).m;
    if (isM) TAB.side = sideOf(rec);
    const mvEntry = tg.moves.find((x) => x.m === TAB.move), role = mvEntry?.role || '';
    const key = `${rec.id}|${TAB.joint}|${TAB.move}|${TAB.side}|${TAB.view}`;
    if (!SES || SES.key !== key) {
      startSession({ joint: TAB.joint, movement: TAB.move, side: TAB.side, view: TAB.view, rec, muscle: isM ? rec : null, role, key, speed: TAB.speed });
    }
    const refresh = () => atlas.showInfo(atlas.siblingsOf(rec));
    const set = (o) => { Object.assign(TAB, o); refresh(); };
    const chip = (text, on, onclick, cls = '', title = '') => el('button', { type: 'button', className: `chip mo-chip ${cls} ${on ? 'on' : ''}`, 'aria-pressed': String(!!on), title, onclick }, text);
    const box = el('div', { className: 'mo' });
    if (targets.length > 1) {
      box.append(el('h3', {}, 'Joint'));
      box.append(el('div', { className: 'chips' }, targets.map((t) => chip(jointLabel(t.joint), t.joint === TAB.joint, () => set({ joint: t.joint, move: null })))));
    }
    box.append(el('h3', {}, isM ? 'Movements this muscle produces here' : 'Movement'));
    box.append(el('div', { className: 'chips' }, tg.moves.map((x) => chip(moveLabel(x.m), x.m === TAB.move, () => set({ move: x.m }),
      x.role === 'P' ? 'prime' : '', x.role ? `${ROLE_TXT[x.role] || ''}` : ''))));
    if (isM) box.append(el('p', { className: 'fine' }, 'Solid = prime mover, outline = assists.'));
    // player
    const play = el('button', { type: 'button', className: 'btn mo-play', title: 'Play / pause (Space)', onclick: () => (SES && SES.ready ? setPlaying(!SES.playing) : null) }, '⏸ Pause');
    const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, className: 'mo-scrub', 'aria-label': 'Position in the movement' });
    scrub.addEventListener('input', () => { if (!SES) return; SES.scrub = true; SES.playing = false; SES.u = scrub.value / 1000; SES.dirty = true; if (SES.hudRefs) updateHud(SES); play.textContent = '▶ Play'; });
    const speed = el('div', { className: 'seg', role: 'group', 'aria-label': 'Speed' }, [[0.5, '½×'], [1, '1×'], [2, '2×']].map(([v, t]) => el('button', { type: 'button', className: TAB.speed === v ? 'on' : '', onclick: () => { TAB.speed = v; if (SES) SES.speed = v; speed.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', [0.5, 1, 2][i] === v)); } }, t)));
    const loop = el('label', { className: 'mo-loop' }, el('input', { type: 'checkbox', checked: TAB.loop, onchange: (e) => { TAB.loop = e.target.checked; if (SES) SES.mode = TAB.loop ? 'pingpong' : 'once'; } }), ' Loop');
    box.append(el('div', { className: 'mo-player' }, el('div', { className: 'mo-prow' }, play, scrub), el('div', { className: 'mo-prow2' }, speed, loop)));
    const seg = (opts, cur, on) => el('div', { className: 'seg' }, opts.map(([v, t, ti]) => el('button', { type: 'button', className: cur === v ? 'on' : '', title: ti || '', onclick: () => on(v) }, t)));
    const toggles = el('div', { className: 'mo-toggles' });
    toggles.append(seg([['bone', 'Bone motion', 'Osteokinematics: the whole segment swings'], ['surface', 'Joint surfaces', 'Arthrokinematics: close-up of roll / glide / spin']], TAB.view, (v) => set({ view: v })));
    if (!isM) toggles.append(seg([['l', 'Left'], ['r', 'Right']], TAB.side, (v) => set({ side: v })));
    box.append(toggles);
    const dyn = el('div', { className: 'mo-dyn' }, el('p', { className: 'fine' }, 'Loading the skeleton…'));
    box.append(dyn);
    host.append(box);
    // wire up: fill the kinematics once the session is ready, keep the player in sync
    const fill = () => {
      const S0 = SES; if (!S0 || !S0.ready || S0.key !== key) return;
      dyn.replaceChildren(kinematicsBlock(S0), S0.cfg.muscle ? muscleBlock(S0) : '');
      S0.mode = TAB.loop ? 'pingpong' : 'once'; S0.speed = TAB.speed;
      S0.onTick = (s) => { if (!scrub.isConnected) return; if (!s.scrub) scrub.value = Math.round(s.u * 1000); play.textContent = s.playing ? '⏸ Pause' : '▶ Play'; };
    };
    if (SES) SES.panelHost = host;
    const l = () => { if (!host.isConnected) { listeners.delete(l); return; } if (SES) SES.panelHost = host; fill(); };
    listeners.add(l); if (SES?.ready) fill();
  }
  atlas.registerTab({ id: 'motion', label: 'Motion', order: 20, applies: (sib) => targetsFor(sib[0]).length > 0, render: renderTab });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && SES && SES.ready && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '') && $('#info')?.contains(SES.panelHost)) { e.preventDefault(); setPlaying(!SES.playing); } });

  // Standalone use (no info panel): atlas.motion.open({ joint, movement, side?, muscle?, view? }); the caption on the stage has play / close.
  function openMotion(req) {
    if (!req || !MO.joints[req.joint]?.moves[req.movement]) return Promise.resolve(null);
    const rec = req.muscle ? atlas.recsByName('muscular', req.muscle).find((r) => !req.side || r.side === req.side) || atlas.recsByName('muscular', req.muscle)[0] : null;
    return startSession({ joint: req.joint, movement: req.movement, side: req.side || (rec?.side === 'r' ? 'r' : 'l'), view: req.view || 'bone', muscle: rec, role: req.role || '', standalone: true, key: 'standalone' });
  }
  document.dispatchEvent(new CustomEvent('atlas:motion-ready'));
}
