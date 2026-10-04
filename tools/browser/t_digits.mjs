// Muscles that move only some digits animate only those digits (muscles.json act[3] = site keys).
export default async function (page, h) {
  const cases = [['Extensor pollicis longus', 'interphalangeal-hand', 'extension', ['ip1']],
    ['Extensor indicis', 'metacarpophalangeal', 'extension', ['mcp2']],
    ['Extensor digitorum', 'metacarpophalangeal', 'extension', ['mcp2', 'mcp3', 'mcp4', 'mcp5']],
    ['Flexor hallucis longus', 'interphalangeal-foot', 'flexion', ['ip1']]];
  let fail = 0;
  for (const [muscle, joint, movement, want] of cases) {
    await page.evaluate((m, j, mv) => window.atlas.motion.open({ joint: j, movement: mv, muscle: m }), muscle, joint, movement);
    await page.waitForFunction(() => window.__motion?.ses?.ready, { timeout: 60000 });
    const got = await page.evaluate(() => window.__motion.ses.ops.map((o) => o.key));
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(ok ? 'PASS' : 'FAIL', muscle, JSON.stringify(got));
  }
  await page.evaluate(() => { const s = window.__motion.ses; s.playing = false; s.scrub = true; s.u = 1; s.dirty = true; });
  await h.sleep(800);
  await h.shot('_shots/k/digits_fhl.png');
  console.log(fail ? `DIGITS ${fail} FAILED` : 'DIGITS ALL PASS');
}
