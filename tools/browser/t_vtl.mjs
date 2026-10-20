// Cover → tutor chat → structure links → flag a problem → owner review page.
// Needs the local stand-in for Vercel with Claude mocked (no API spend):
//   node web/scripts/dev-server.js --port 8770 --mock-claude
//   node tools/browser/run.mjs --cover --no-ready --script tools/browser/t_vtl.mjs --logs errors
export default async function (page, h) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFor = (fn, arg, t = 60000) => page.waitForFunction(fn, { timeout: t, polling: 100 }, arg);
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); };
  const base = new URL(page.url()).origin;

  // ---- cover
  const cov = await ev(() => ({ shown: getComputedStyle(document.getElementById('cover')).display !== 'none', inert: document.getElementById('app').inert }));
  check('cover is shown on a fresh visit and the app behind it is inert', cov.shown && cov.inert, JSON.stringify(cov));
  await ev(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true })));
  check('atlas shortcuts are blocked while the cover is up', await ev(() => !document.querySelector('.speaking')));
  await waitFor(() => window.atlas?.S?.M);
  await page.click('#cvEnter');
  await waitFor(() => document.getElementById('cover').hidden);
  check('Enter the atlas hides the cover and re-enables the app', await ev(() => !document.getElementById('app').inert && document.documentElement.classList.contains('no-cover')));
  check('header shows the new name', await ev(() => document.querySelector('#topbar h1').textContent.trim() === 'Anatomy Atlas VTL'));

  // ---- structure actions
  await ev(async () => { const a = window.atlas; await a.selectRec(a.S.M.structures.find((r) => r.id === 'Femur.l')); });
  await h.sleep(800);
  const acts = await ev(() => [...document.querySelectorAll('#info .actions .btn')].map((b) => b.textContent.trim()));
  check('info panel has Ask tutor and Flag buttons', acts.includes('Ask tutor') && acts.includes('Flag'), JSON.stringify(acts));

  // ---- tutor
  await page.click('#tutorFab');
  await waitFor(() => !document.getElementById('tutorPanel').hidden);
  const ctx = await ev(() => document.querySelector('.tp-ctx')?.textContent);
  check('tutor shows what it will be asked about', /Asking about\s*Femur/.test(ctx || ''), ctx);
  const sugg = await ev(() => [...document.querySelectorAll('.tp-sugg button')].map((b) => b.textContent));
  check('suggestions mention the selected structure', sugg.some((s) => /Femur/.test(s)), JSON.stringify(sugg));
  await h.shot('_shots/vtl/tutor_empty.png');
  await page.type('.tp-form textarea', 'What is this bone and what does it connect to?');
  await page.keyboard.press('Enter');
  await waitFor(() => !document.querySelector('.tp-send.stop') && document.querySelectorAll('.tp-msg.bot').length === 1, null, 30000);
  const answer = await ev(() => {
    const m = document.querySelector('.tp-msg.bot');
    return { chips: [...m.querySelectorAll('.tp-chip')].map((c) => c.textContent), strong: [...m.querySelectorAll('strong')].map((s) => s.textContent),
      lists: m.querySelectorAll('ul li').length, ol: m.querySelectorAll('ol li').length, h4: m.querySelectorAll('h4').length };
  });
  check('answer streamed with structure buttons, lists and a heading', answer.chips.length >= 5 && answer.lists === 4 && answer.ol === 2 && answer.h4 === 1, JSON.stringify(answer));
  check('a group name (Heart) becomes a button too', answer.chips.includes('Heart'), JSON.stringify(answer.chips));
  check('an unknown name stays plain bold text, not a button', answer.strong.includes('Not a real structure') && !answer.chips.includes('Not a real structure'), JSON.stringify(answer));
  const sent = await (await fetch(`${base}/__mock/requests`)).json();
  const chat = sent.filter((r) => r.body.stream).pop();
  const userTurn = chat.body.messages.at(-1).content;
  check('the question carried the atlas context', /<atlas_context>[\s\S]*Selected structure: Femur \(left and right sides\) — Skeletal system[\s\S]*<\/atlas_context>/.test(userTurn), userTurn);
  check('the tutor runs on Haiku at low effort, with no fallback (Haiku has none)', chat.body.model === 'claude-haiku-5-5' && chat.body.output_config.effort === 'low' && !chat.body.fallbacks && !chat.beta.includes('server-side-fallback'), JSON.stringify({ model: chat.body.model, beta: chat.beta, oc: chat.body.output_config }));
  check('the system prompt is marked for caching', chat.body.system[0].cache_control?.type === 'ephemeral');
  await h.shot('_shots/vtl/tutor_answer.png');
  await ev(() => [...document.querySelectorAll('.tp-chip')].find((c) => c.textContent === 'Hip bone').click());
  await waitFor(() => window.atlas.S.cur?.name === 'Hip bone');
  check('clicking a structure button selects it in 3D', true);
  await ev(() => [...document.querySelectorAll('.tp-chip')].find((c) => c.textContent === 'Heart').click());
  await waitFor(() => window.atlas.S.sel.size > 3 && !window.atlas.S.cur);
  check('clicking a group button selects the whole group', await ev(() => window.atlas.selectionRecs().every((r) => r.system === 'cardiovascular')));
  // follow-up keeps the history
  await ev(() => window.atlas.tutor.ask('Quiz me on it'));
  await waitFor(() => !document.querySelector('.tp-send.stop') && document.querySelectorAll('.tp-msg.bot').length === 2, null, 30000);
  const sent2 = (await (await fetch(`${base}/__mock/requests`)).json()).filter((r) => r.body.stream).pop();
  check('a follow-up sends the whole conversation', sent2.body.messages.length === 3 && sent2.body.messages[1].role === 'assistant', String(sent2.body.messages.length));
  check('tutor questions are capped at 250 characters', await ev(() => document.querySelector('.tp-form textarea').maxLength === 250));
  await (await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: `<atlas_context>\nSelected structure: Femur\n</atlas_context>\n\n${'q'.repeat(400)}` }] }) })).text();
  const capped = (await (await fetch(`${base}/__mock/requests`)).json()).filter((r) => r.body.stream).pop().body.messages.at(-1).content;
  check('the server trims a longer question to 250 characters and keeps the context', /<\/atlas_context>\n\nq{250}$/.test(capped), `${capped.length} chars`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => window.atlas?.S?.M && window.atlas.tutor);
  await ev(() => window.atlas.ready.then(() => true));          // the link's saved selection is restored first
  await ev(() => window.atlas.tutor.open(true));
  check('the conversation survives a reload in the same tab', await ev(() => document.querySelectorAll('.tp-msg.user').length === 2));
  await ev(() => window.atlas.tutor.open(false));

  // ---- flag a glitch about a structure
  await ev(async () => { const a = window.atlas; await a.selectRec(a.S.M.structures.find((r) => r.id === 'Patella.r')); });
  await h.sleep(600);
  await ev(() => document.querySelector('#info .vtl-flag').click());
  await waitFor(() => !document.getElementById('feedbackPanel').hidden);
  check('Flag opens the form as a wrong-information report about the structure',
    await ev(() => document.querySelector('input[name=fbKind]:checked').value === 'wrong_info' && /Patella/.test(document.querySelector('.fb-check')?.textContent || '')));
  await ev(() => document.querySelector('input[name=fbKind][value=glitch]').click());
  await h.sleep(100);
  await page.type('#fbText', 'The patella flickers when I rotate the model with Ghost others on.');
  check('the answer box allows 250 characters', await page.evaluate(() => document.getElementById('fbText').maxLength === 250 && /\/ 250/.test(document.getElementById('fbCount').textContent)));
  const mail = await page.evaluate(() => [...document.querySelectorAll('#feedbackPanel a.fb-mail, #cover a[data-vtl=email]')].map((a) => [a.textContent, a.href.split('?')[0]]));
  check('the form and the cover give the contact email', mail.length === 2 && mail.every(([t, h]) => t === 'jaydenpcastro@gmail.com' && h === 'mailto:jaydenpcastro@gmail.com'), JSON.stringify(mail));
  await h.shot('_shots/vtl/feedback_form.png');
  await ev(() => document.querySelector('#feedbackPanel button[type=submit]').click());
  await waitFor(() => document.querySelector('#feedbackPanel .fb-done'));
  check('the report is accepted', true);
  await h.shot('_shots/vtl/feedback_done.png');
  const tooLong = await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'other', message: 'x'.repeat(251) }) });
  check('the server refuses answers over 250 characters', tooLong.status === 400, String(tooLong.status));
  const review = (await (await fetch(`${base}/__mock/requests`)).json()).filter((r) => !r.body.stream).pop();
  check('the reviewer runs on Opus with the refusal fallback and structured output', review.body.model === 'claude-opus-5-5' && review.beta.includes('server-side-fallback-2026-07-01') && review.body.output_config.format?.type === 'json_schema', JSON.stringify({ model: review.body.model, beta: review.beta }));
  // a junk report that the reviewer should reject
  await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'other', message: 'asdf asdf' }) });
  await h.sleep(1500);

  // ---- owner page
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  await ev(() => localStorage.removeItem('vtl.admin.token'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => document.querySelector('.ad-login input'));
  await page.type('.ad-login input', 'wrong-token');
  await page.keyboard.press('Enter');
  await waitFor(() => /Wrong owner token/.test(document.querySelector('.ad-err')?.textContent || ''));
  check('a wrong owner token is refused', true);
  await page.type('.ad-login input', 'dev-admin');
  await page.keyboard.press('Enter');
  await waitFor(() => document.querySelector('.ad-flags, .ad-none') && document.querySelector('.ad-chart svg'));
  const owner = await ev(() => ({
    toDecide: [...document.querySelectorAll('.ad-flag')].map((f) => f.querySelector('.ad-quote').textContent),
    hero: document.querySelector('.ad-tile .val.hero').textContent,
    tabs: Object.fromEntries([...document.querySelectorAll('.ad-tab')].map((t) => [t.firstChild.textContent, t.querySelector('small').textContent])),
  }));
  check('the valid glitch waits for a decision; the junk report does not', owner.toDecide.length === 1 && /patella flickers/.test(owner.toDecide[0]) && owner.tabs['Rejected by reviewer'] === '1', JSON.stringify(owner));
  const flag = (await (await fetch(`${base}/api/admin`, { headers: { Authorization: 'Bearer dev-admin' } })).json()).flags.find((f) => f.category === 'glitch');
  check('the flag kept the structure and the technical details', flag.structure?.name === 'Patella' && /Chrome|Mozilla/.test(flag.page.ua) && /x/.test(flag.page.viewport), JSON.stringify(flag.structure));
  await h.shot('_shots/vtl/admin.png');
  await page.hover('.ad-chart .col:last-of-type');
  await h.sleep(200);
  check('hovering a week shows its breakdown', await ev(() => !document.querySelector('.ad-tip').hidden && /Passed review/.test(document.querySelector('.ad-tip').textContent)));
  await h.shot('_shots/vtl/admin_tip.png');
  await ev(() => [...document.querySelectorAll('.ad-flag .btn')].find((b) => /Accept/.test(b.textContent)).click());
  await waitFor(() => /Accepted\s*1/.test([...document.querySelectorAll('.ad-tab')].map((t) => t.textContent).join(' ')));
  check('Accept moves the flag to Accepted', true);
  const report = await (await fetch(`${base}/api/cron/weekly-tally`, { headers: { Authorization: 'Bearer dev-admin' } })).json();
  check('the weekly tally job writes a report', report.report && typeof report.report.submitted === 'number', JSON.stringify(report));
  const cronNoAuth = await fetch(`${base}/api/cron/weekly-tally`);
  check('the weekly tally job refuses callers without the secret', cronNoAuth.status === 401, String(cronNoAuth.status));
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  if (fail) process.exitCode = 1;
}
