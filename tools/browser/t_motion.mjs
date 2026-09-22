// Motion tests.  node tools/browser/run.mjs --script tools/browser/t_motion.mjs --logs errors [--eval-arg cases]
// For each case: select the structure, open the Motion tab for a joint.movement, screenshot u = 0 / 0.5 / 1 and check that
// stopping the motion restores every transform, material and visibility.
const CASES = (process.env.MO_CASES || 'glenohumeral.abduction@Humerus.l,elbow.flexion@Radius.l,radioulnar.pronation@Radius.l,hip.flexion@Femur.l,knee.flexion@Tibia.l').split(',');
export default async function (page, h) {
  for (const c of CASES) {
    const [jm, id] = c.split('@'), [joint, movement] = jm.split('.');
    const size = process.env.MO_SIZE;
    const r = await page.evaluate(async (joint, movement, id) => {
      const a = window.atlas, rec = a.S.M.structures.find((x) => x.id === id);
      if (!rec) return { error: 'no rec ' + id };
      await a.selectRec(rec, { focus: false });
      a.openMotion({ joint, movement, muscle: rec.system === 'muscular' ? rec.name : undefined });
      return { ok: true };
    }, joint, movement, id);
    if (r.error) { console.log(c, r.error); continue; }
    await h.sleep(3500);
    if (process.env.MO_VIEW === 'surface') {
      await page.evaluate(() => [...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Joint surfaces')?.click());
      await h.sleep(3500);
    }
    for (const u of [0, 0.5, 1]) {
      await page.evaluate((u) => { const s = window.__motion.ses; if (s) { s.playing = false; s.scrub = true; s.u = u; } }, u);
      await h.sleep(u === 0 ? 900 : 500);
      await h.shot(`_shots/motion/${process.env.MO_VIEW || 'bone'}_${joint}_${movement}_${id.replace(/[^a-z0-9]/gi, '_')}_${u}.png`);
    }
    const st = await page.evaluate(() => { const s = window.__motion.ses; return s && { ready: s.ready, disp: +s.disp.toFixed(1), key: s.key, muscle: s.muscleLen }; });
    console.log(c, JSON.stringify(st));
    await page.evaluate(() => window.atlas.motion.stop());
  }
}
