// Study additions: exam mode (no feedback, pass mark), spaced review (due dates), Today panel and weakest topics.
export default async function (page, h) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); };
  await ev(() => localStorage.removeItem(window.atlas.quiz?.storageKey || 'zatlas.quiz.v1'));
  await waitFor(() => window.atlas.quiz);
  await ev(() => document.getElementById('studyBtn').click());
  await waitFor(() => document.querySelector('.qtoday'));
  check('today panel on menu', await ev(() => !!document.querySelector('.qtoday-stats')));
  // exam: 5 identify questions on the skeleton, always pick option 0
  await ev(() => window.atlas.quiz.select(window.atlas.quiz.sections().find((s) => s.key === 'skeletal')));
  await ev(() => window.atlas.quiz.start({ mode: 'identify', group: '', level: 'major', len: 5, exam: true }));
  for (let i = 0; i < 5; i++) {
    await waitFor((i) => window.atlas.quiz.state().round?.i === i && document.querySelector('.qopt'), i);
    const before = await ev(() => document.querySelector('.qprog').textContent);
    if (i === 0) check('exam hides the score', /Exam mode/.test(before), before);
    await ev(() => window.atlas.quiz.choose(0));
    if (i < 4) { await waitFor((i) => window.atlas.quiz.state().round?.i === i + 1, i); check(`q${i + 1}: no feedback shown`, await ev(() => !document.querySelector('.qfeed'))); }
  }
  await waitFor(() => document.querySelector('.qscore'));
  const res = await ev(() => ({ exam: document.querySelector('.qexam')?.textContent, score: document.querySelector('.qscore')?.textContent }));
  check('exam result shows pass/fail', !!res.exam, JSON.stringify(res)); console.log('  ', JSON.stringify(res));
  await h.shot('_shots/k/study_exam.png');
  // make every answered structure 2 days old: box-2 items (1 day) and missed items become due
  const st = await ev(() => {
    const k = window.atlas.quiz.storageKey, P = JSON.parse(localStorage.getItem(k)), seen = P.s.skeletal.seen;
    for (const a of Object.values(seen)) a[3] -= 2 * 864e5;
    localStorage.setItem(k, JSON.stringify(P));
    return { answered: Object.keys(seen).length, rec: Object.values(seen)[0] };
  });
  console.log('  stored', JSON.stringify(st));
  check('answers store box + timestamp', Array.isArray(st.rec) && st.rec.length === 4 && st.rec[3] > 0, JSON.stringify(st.rec));
  // reload so quiz.js reads the aged progress, then the menu must offer the due review
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => window.atlas?.quiz);
  await ev(() => document.getElementById('studyBtn').click());
  await waitFor(() => document.querySelector('.qtoday'));
  const today = await ev(() => document.querySelector('.qtoday').innerText);
  check('due items listed after 2 days', /\b5\b\s*due for review/.test(today.replace(/\n/g, ' ')), today);
  check('streak counted', /1\s*day streak/.test(today.replace(/\n/g, ' ')), today);
  await h.shot('_shots/k/study_today.png');
  await ev(() => [...document.querySelectorAll('.qtoday .btn.primary')][0]?.click());
  await waitFor(() => window.atlas.quiz.state().round?.review === 'due' && document.querySelector('.qopt'));
  check('due review round starts', await ev(() => window.atlas.quiz.state().round.queue.length === 5));
  console.log(fail ? `STUDY ${fail} FAILED` : 'STUDY ALL PASS');
}
