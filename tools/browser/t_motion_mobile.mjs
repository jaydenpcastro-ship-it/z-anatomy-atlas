// Mobile label-overflow check: for each case, open the Motion tab and programmatically verify every visible
// .mo-lab / .mo-hud element's rendered box stays within the viewport (catches clipping that a single screenshot
// might miss if it lands on a frame where the offending label happens to be off). Always pass --size for a phone
// viewport - run.mjs defaults to 1400x900 otherwise.
const CASES = [
  ['glenohumeral', 'abduction', 'Humerus.l'], ['knee', 'flexion', 'Tibia.l'], ['elbow', 'flexion', 'Radius.l'],
  ['hip', 'flexion', 'Femur.l'], ['cervical-spine', 'flexion', 'Vertebra C4'], ['wrist', 'flexion', 'Scaphoid bone.l'],
  ['ankle', 'dorsiflexion', 'Talus.l'], ['temporomandibular', 'depression', 'Mandible'],
  ['metacarpophalangeal', 'flexion', 'Second metacarpal bone.l'], ['thoracic-cage', 'pump-handle', 'Body of sternum'],
];
export default async function (page, h) {
  let bad = 0;
  for (const [joint, movement, id] of CASES) {
    const r = await page.evaluate(async (joint, movement, id) => {
      const a = window.atlas, rec = a.S.M.structures.find((x) => x.id === id);
      if (!rec) return { error: 'no rec ' + id };
      await a.selectRec(rec, { focus: false });
      a.openMotion({ joint, movement });
      return { ok: true };
    }, joint, movement, id);
    if (r.error) { console.log(joint, movement, r.error); bad++; continue; }
    await h.sleep(3000);
    // sample a few points along the range so a label that only overflows at a particular angle isn't missed
    for (const u of [0, 0.5, 1]) {
      await page.evaluate((u) => { const s = window.__motion.ses; if (s) { s.playing = false; s.scrub = true; s.u = u; } }, u);
      await h.sleep(350);
      const rep = await page.evaluate(() => {
        const W = innerWidth, H = innerHeight, out = [];
        for (const el of document.querySelectorAll('.mo-lab, .mo-hud')) {
          if (el.style.display === 'none' || getComputedStyle(el).display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) {
            out.push({ text: el.textContent.slice(0, 40), left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) });
          }
        }
        return { W, H, overflow: out };
      });
      if (rep.overflow.length) { bad++; console.log('OVERFLOW', joint, movement, 'u=' + u, JSON.stringify(rep.overflow)); }
    }
    await page.evaluate((u) => { const s = window.__motion.ses; if (s) { s.playing = false; s.scrub = true; s.u = u; } }, 1);
    await h.sleep(400);
    await h.shot(`_shots/motion/mobile2_${joint}_${movement}.png`);
    await page.evaluate(() => window.atlas.motion.stop());
    console.log('checked', joint + '.' + movement, bad === 0 ? '(clean so far)' : `(${bad} overflow(s) so far)`);
  }
  console.log(`done: ${CASES.length} cases x 3 poses, ${bad} overflow instance(s)`);
}
