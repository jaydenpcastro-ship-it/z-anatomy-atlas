// Guided lessons: every name resolves, every step applies without errors, quiz handoff, deep link to a step.
export default async function (page, h) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFor = (fn, arg, t = 90000) => page.waitForFunction(fn, { timeout: t, polling: 100 }, arg);
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); };
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await waitFor(() => window.atlas.lessons && window.atlas.quiz && window.atlas.section);
  const missing = await ev(() => {
    const a = window.atlas, out = [];
    for (const l of a.lessons.list()) l.steps.forEach((s, i) => {
      for (const item of s.select || []) if (!a.lessons.resolve({ ...s, select: [item] }).length) out.push(`${l.id}#${i + 1}: ${item}`);
      if (s.motion && !(s.motion.joint && s.motion.movement)) out.push(`${l.id}#${i + 1}: bad motion`);
    });
    const qs = a.quiz.sections().map((x) => x.key);
    for (const l of a.lessons.list()) if (l.quiz && !qs.includes(l.quiz.section)) out.push(`${l.id}: quiz section ${l.quiz.section}`);
    for (const l of a.lessons.list()) if (l.quiz?.group && !a.S.groups.has(l.quiz.group)) out.push(`${l.id}: quiz group ${l.quiz.group}`);
    return out;
  });
  check('every lesson name resolves', !missing.length, missing.join('; '));
  const lessons = await ev(() => window.atlas.lessons.list().map((l) => [l.id, l.steps.length]));
  for (const [id, n] of lessons) {
    for (let i = 0; i < n; i++) {
      await ev((id, i) => (i === 0 ? window.atlas.lessons.start(id, 0) : window.atlas.lessons.go(i)), id, i);
      await h.sleep(i === 0 ? 2500 : 1300);
      const st = await ev(() => ({ cur: window.atlas.lessons.current(), sel: window.atlas.S.sel.size, card: !document.querySelector('.lcard').hidden }));
      if (!st.card || st.cur?.step !== i) check(`${id} step ${i + 1}`, false, JSON.stringify(st));
      if (['shoulder', 'trunk-sections', 'heart'].includes(id) && [2, 3].includes(i)) await h.shot(`_shots/k/lesson_${id}_${i + 1}.png`);
    }
    check(`${id}: all ${n} steps applied`, true);
  }
  check('no page errors while stepping', !errors.length, errors.join(' | '));
  await ev(() => window.atlas.lessons.go(4));
  await h.sleep(800);
  await ev(() => [...document.querySelectorAll('.lcard .btn')].find((b) => b.textContent === 'Finish').click());
  await ev(() => [...document.querySelectorAll('.lcard .btn')].find((b) => b.textContent === 'Test yourself').click());
  await waitFor(() => window.atlas.quiz.isOpen() && document.querySelector('.qmode'));
  const qs = await ev(() => ({ cfg: window.atlas.quiz.state().cfg, title: document.querySelector('.qs-title')?.textContent, pool: document.querySelector('.qs-fine[role=status]')?.textContent }));
  check('quiz opens on the lesson topic', /Cranial nerves/.test(qs.cfg.group) && qs.title === 'Nervous system & sense organs', JSON.stringify(qs));
  console.log('  ', qs.pool);
  await page.goto('about:blank'); await page.goto('http://127.0.0.1:8770/#lesson=knee.3', { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.atlas?.lessons?.current());
  await h.sleep(2500);
  const deep = await ev(() => ({ cur: window.atlas.lessons.current(), cut: window.atlas.section.get().on, hash: location.hash }));
  check('deep link opens the lesson step', deep.cur?.id === 'knee' && deep.cur.step === 2 && deep.cut, JSON.stringify(deep));
  await h.shot('_shots/k/lesson_knee_3.png');
  console.log(fail ? `LESSONS ${fail} FAILED` : 'LESSONS ALL PASS');
}
