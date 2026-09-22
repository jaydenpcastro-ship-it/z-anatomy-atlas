// Sweep: every joint x movement (both sides optional) plays without page errors, and stopping restores the scene exactly.
//   MO_JOINTS=elbow,hip  MO_SIDES=l,r  MO_VIEW=bone|surface  node tools/browser/run.mjs --script tools/browser/t_motion_all.mjs --logs errors
import fs from 'node:fs';
const JOINTS = (process.env.MO_JOINTS || '').split(',').filter(Boolean);
const SIDES = (process.env.MO_SIDES || 'l').split(',');
const VIEW = process.env.MO_VIEW || 'bone';
export default async function (page, h) {
  fs.mkdirSync('_shots/motion/all', { recursive: true });
  const list = await page.evaluate(() => { const M = window.__motion.MO.joints; return Object.entries(M).flatMap(([j, J]) => Object.keys(J.moves).map((m) => [j, m])); });
  const rect = await page.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.evaluate(async () => { await window.atlas.loadSystem('skeletal'); });
  // scene snapshot helper (installed once)
  await page.evaluate(() => {
    window.__snap = () => {
      const out = new Map();
      for (const [id, list] of window.atlas.S.meshes) list.forEach((m, i) => out.set(id + '#' + i, [m.matrix.elements.join(','), m.material.uuid, m.visible, m.matrixAutoUpdate, m.frustumCulled, m.geometry.attributes.position.array.length > 0 ? m.geometry.attributes.position.array[0] + '|' + m.geometry.attributes.position.array[m.geometry.attributes.position.array.length - 1] : '']));
      return out;
    };
    window.__diff = (a, b) => { const bad = []; for (const [k, v] of a) { const w = b.get(k); if (!w) { bad.push(k + ' missing'); continue; } for (let i = 0; i < v.length; i++) if (v[i] !== w[i]) { bad.push(k + ' field' + i); break; } } return bad; };
    window.__before = window.__snap();
  });
  let bad = 0, n = 0;
  for (const [joint, movement] of list) {
    if (JOINTS.length && !JOINTS.includes(joint)) continue;
    for (const side of SIDES) {
      n++;
      const r = await page.evaluate(async (joint, movement, side, view) => {
        const t0 = performance.now();
        const s = await window.__motion.startSession({ joint, movement, side, view, standalone: true, key: 'sweep' });
        if (!s) return { error: 'no session' };
        s.playing = false; s.scrub = true; s.u = 1;
        await new Promise((res) => setTimeout(res, 700));
        const info = { ms: Math.round(performance.now() - t0), disp: +s.disp.toFixed(1), ops: s.ops.map((o) => +(o.val || 0).toFixed(1)), labels: s.labels.filter((l) => l.el.style.display !== 'none').length };
        return info;
      }, joint, movement, side, VIEW);
      if (r.error) { console.log('ERR', joint, movement, side, r.error); bad++; continue; }
      await page.screenshot({ path: `_shots/motion/all/${VIEW}_${joint}__${movement}__${side}.png`, clip: rect });
      const rest = await page.evaluate(async () => {
        window.__motion.stopSession();
        await new Promise((res) => setTimeout(res, 150));
        const after = window.__snap();
        return window.__diff(window.__before, after);
      });
      if (rest.length) { console.log('NOT RESTORED', joint, movement, side, rest.slice(0, 4)); bad++; }
      else console.log('ok', joint + '.' + movement + '.' + side, JSON.stringify(r));
    }
  }
  console.log(`done: ${n} runs, ${bad} problems`);
}
