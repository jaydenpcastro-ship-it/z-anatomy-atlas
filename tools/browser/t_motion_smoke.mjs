// Smoke test: open the Motion tab for a bone and screenshot several phases of the animation.
export default async function (page, h) {
  const info = await page.evaluate(async () => {
    const a = window.atlas;
    const rec = a.S.M.structures.find((x) => x.id === 'Humerus.l');
    await a.selectRec(rec, { focus: false });
    a.S.tab = 'motion'; a.showInfo(a.siblingsOf(rec));
    return { tabs: [...document.querySelectorAll('.tab')].map((t) => t.textContent), has: !!window.__motion };
  });
  console.log('tabs', JSON.stringify(info));
  await h.sleep(5000);
  const st = await page.evaluate(() => { const s = window.__motion.ses; return s && { ready: s.ready, joint: s.joint, mv: s.movement, u: s.u, disp: s.disp, ops: s.ops.length, key: s.key }; });
  console.log('session', JSON.stringify(st));
  await h.shot('_shots/motion/smoke_0.png');
  await page.evaluate(() => { const s = window.__motion.ses; s.playing = false; s.scrub = true; s.u = 1; });
  await h.sleep(800);
  await h.shot('_shots/motion/smoke_1.png');
}
