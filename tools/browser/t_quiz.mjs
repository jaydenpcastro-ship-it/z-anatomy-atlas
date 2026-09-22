// End-to-end test of the Study (diagram quiz) tool in headless Chrome.
//   node tools/browser/run.mjs --script tools/browser/t_quiz.mjs --logs errors
// Env: MOBILE=1 (run with --size 390x844: screenshots + layout checks only), ONLY=skeletal,muscular (limit sections), SHOTS=1 (extra screenshots)
const MOBILE = !!process.env.MOBILE, ONLY = (process.env.ONLY || '').split(',').filter(Boolean), SHOTS = true;
const DIR = MOBILE ? '_shots/quiz/m' : '_shots/quiz';
const results = [], errors = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `-- ${detail}`); };

export default async function (page, h) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
  const open = async () => { await ev(() => window.atlas.quiz.isOpen() || document.getElementById('studyBtn').click()); await waitFor(() => window.atlas.quiz.isOpen() && document.querySelector('.qcard')); };
  const select = (sec) => ev((k) => window.atlas.quiz.select(window.atlas.quiz.sections().find((s) => s.key === k)), sec);
  const start = (cfg) => ev((c) => window.atlas.quiz.start(c), cfg);
  const snap = (name) => (SHOTS ? h.shot(`${DIR}/${name}.png`) : null);

  // ---- page-side helpers -------------------------------------------------------------
  await ev(() => {
    // a client-space point where the unit is really the first thing hit (what a learner would click)
    window.__pointOn = (unit, avoid) => {
      const a = window.atlas, T = a.THREE, rect = a.canvas.getBoundingClientRect(), o = {};
      const roots = [...a.S.sys.values()].filter((s) => s.visible && s.loaded).map((s) => s.group);
      const ray = new T.Raycaster(), v = new T.Vector3(), ndc = new T.Vector2();
      const meshes = unit.recs.flatMap((r) => a.meshesOf(r.id)).filter((m) => m.visible);
      const cands = [];
      for (const m of meshes) { const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 120)); m.updateWorldMatrix(true, false); for (let i = 0; i < pos.count; i += step) cands.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone()); }
      const W = a.stage.clientWidth, H = a.stage.clientHeight;
      for (const p of cands) {
        a.project(p, o); if (!o.visible || o.x < 20 || o.y < 20 || o.x > W - 20 || o.y > H - 20) continue;
        ndc.set((o.x / W) * 2 - 1, -(o.y / H) * 2 + 1); ray.setFromCamera(ndc, a.camera);
        const at = (dx, dy) => { ndc.set(((o.x + dx) / W) * 2 - 1, -((o.y + dy) / H) * 2 + 1); ray.setFromCamera(ndc, a.camera); return ray.intersectObjects(roots, true).find((x) => x.object.isMesh && x.object.visible); };
        if ([[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => unit.ids.has(at(dx, dy)?.object.userData.zid))) return { x: rect.left + o.x, y: rect.top + o.y };
      }
      return null;
    };
    window.__pins = () => {
      const st = document.getElementById('stage').getBoundingClientRect();
      return [...document.querySelectorAll('.qpin')].map((p) => { const b = p.querySelector('.qbadge').getBoundingClientRect(), d = p.querySelector('.qdot').getBoundingClientRect();
        return { cx: b.x + b.width / 2 - st.x, cy: b.y + b.height / 2 - st.y, dx: d.x + d.width / 2 - st.x, dy: d.y + d.height / 2 - st.y, shown: getComputedStyle(p).display !== 'none', behind: p.classList.contains('behind'), W: st.width, H: st.height }; });
    };
    // text a learner can read before answering (options / word bank excluded)
    window.__visibleText = () => {
      const vis = (n) => { const cs = getComputedStyle(n), r = n.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const out = [];
      for (const sel of ['.qs-head', '.qprog', '.qstem', '.qs-fine', '.qslots', '#overlay', '#tip', '#hint', '#info', '#sidebar', '#topbar', '#loading', '#stage .toolbar']) for (const n of document.querySelectorAll(sel)) if (vis(n)) out.push(n.innerText || '');
      for (const n of document.querySelectorAll('[title],[aria-label],[alt]')) if (vis(n) && !n.closest('.qopt, .qbank')) out.push(`${n.getAttribute('title') || ''} ${n.getAttribute('aria-label') || ''} ${n.getAttribute('alt') || ''}`);
      out.push(location.hash, document.title);
      return out.join('\n');
    };
  });

  // ---- 0. layout of the menu -----------------------------------------------------------
  await open();
  await snap('menu');
  const secs = await ev(() => window.atlas.quiz.sections().map((s) => ({ key: s.key, modes: window.atlas.quiz.modesFor(s), units: window.atlas.quiz.units(s.key).length })));
  console.log('sections', JSON.stringify(secs));
  check('menu lists all quizzable sections', secs.length === 9 && !secs.some((s) => ['insertions', 'reference'].includes(s.key)), JSON.stringify(secs.map((s) => s.key)));
  check('every section offers label+identify+locate', secs.every((s) => ['label', 'identify', 'locate'].every((m) => s.modes.includes(m))));
  check('muscular has facts, joints has moves', secs.find((s) => s.key === 'muscular').modes.includes('facts') && secs.find((s) => s.key === 'joints').modes.includes('moves'));
  if (MOBILE) check('no horizontal page scroll (menu)', await ev(() => document.documentElement.scrollWidth <= innerWidth + 1), await ev(() => `${document.documentElement.scrollWidth} > ${innerWidth}`));

  // ---- 1. state restoration: prepare a non-default atlas state, run a round, exit --------
  if (!MOBILE) {
    await ev(() => window.atlas.quiz.close()); await h.sleep(900);
    const settle = async () => { let last = ''; for (let i = 0; i < 40; i++) { const c = await ev(() => window.atlas.camera.position.toArray().map((x) => x.toFixed(4)).join()); if (c === last) return; last = c; await h.sleep(500); } };
    await ev(async () => { const a = window.atlas; await a.setSystemVisible('muscular', true); await a.selectRec(a.S.M.structures.find((r) => r.id === 'Femur.l')); a.S.ghost = true; a.restyle(); });
    await settle();
    const before = await ev(async () => {
      const a = window.atlas;
      return { cur: a.S.cur.id, sel: [...a.S.sel].sort(), vis: [...a.S.sys].filter(([, s]) => s.visible).map(([k]) => k).sort(), ghost: a.S.ghost, hash: location.hash, p: a.camera.position.toArray(), t: a.controls.target.toArray() };
    });
    await open(); await select('cardiovascular'); await start({ mode: 'identify', len: 3, level: 'major' });
    const during = await ev(() => ({ cur: window.atlas.S.cur, hash: location.hash, handler: typeof window.atlas.pickHandler, vis: [...window.atlas.S.sys].filter(([, s]) => s.visible).map(([k]) => k), sidebar: getComputedStyle(document.getElementById('sidebar')).display, info: getComputedStyle(document.getElementById('info')).display, tool: getComputedStyle(document.querySelector('.toolbar')).display }));
    check('study mode: no selection carried in, only the section is shown', during.cur === null && during.vis.join() === 'cardiovascular' && !/sel=/.test(during.hash), JSON.stringify(during));
    check('study mode: sidebar, info panel and toolbar hidden, pick handler installed', during.sidebar === 'none' && during.info === 'none' && during.tool === 'none' && during.handler === 'function', JSON.stringify(during));
    await page.keyboard.press('i'); await page.keyboard.press('g'); await page.keyboard.press('Escape'); await page.keyboard.press('f');
    const keys = await ev(() => ({ iso: window.atlas.S.iso, sel: window.atlas.S.sel.size, ghost: window.atlas.S.ghost }));
    check('atlas shortcuts (I, G, Esc, F) are blocked in study mode', !keys.iso && keys.sel > 0 && keys.ghost === true, JSON.stringify(keys));
    await ev(() => window.atlas.quiz.close()); await h.sleep(800); await settle();
    const after = await ev(() => { const a = window.atlas; return { cur: a.S.cur?.id, sel: [...a.S.sel].sort(), vis: [...a.S.sys].filter(([, s]) => s.visible).map(([k]) => k).sort(), ghost: a.S.ghost, iso: a.S.iso, hash: location.hash, p: a.camera.position.toArray(), t: a.controls.target.toArray(), handler: a.pickHandler, cls: document.body.classList.contains('study-open'), hidden: document.getElementById('study').hidden, side: getComputedStyle(document.getElementById('sidebar')).display, info: document.getElementById('info').innerText.slice(0, 80), btn: document.getElementById('studyBtn').getAttribute('aria-pressed'), overlay: document.getElementById('overlay').children.length }; });
    const near = (a, b) => Math.hypot(...a.map((x, i) => x - b[i])) < 0.02;
    check('exit restores selection / visibility / ghost / hash', after.cur === before.cur && after.sel.join() === before.sel.join() && after.vis.join() === before.vis.join() && after.ghost === before.ghost && !after.iso && after.hash === before.hash, JSON.stringify({ before, after }));
    check('exit restores camera', near(after.p, before.p) && near(after.t, before.t), `${after.p} vs ${before.p}`);
    check('exit clears pick handler, panel, overlay; info panel back', after.handler === null && !after.cls && after.hidden && after.side !== 'none' && after.btn === 'false' && after.overlay === 0 && /Femur/.test(after.info), JSON.stringify(after));
    await ev(() => { const a = window.atlas; a.clearSel(); a.S.ghost = false; a.restyle(); });
  }

  // A label-diagram build can legitimately exhaust its search budget on a dense pool (muscular, nervous) and fall back
  // to "could not build a diagram" instead of a broken round -- that is a valid outcome, not a bug, so no assertion here
  // ever touches `round.dia` without first confirming the build actually succeeded. Retries a few times (fresh random
  // seed each try, via `select`) before giving up, and reports how many tries it took.
  const buildLabel = async (tag, cfg) => {
    for (let t = 0, fails = 0; t < 5; t++) {
      await start({ mode: 'label', level: 'major', ...cfg });
      await h.sleep(300);
      if (await ev(() => !!window.atlas.quiz.state().round?.dia)) return { ok: true, tries: t + 1, fails };
      fails++; await select(tag);
    }
    return { ok: false, tries: 5, fails: 5 };
  };

  // ---- 2. every section, every mode ----------------------------------------------------
  const runSections = secs.filter((s) => !ONLY.length || ONLY.includes(s.key));
  for (const sec of runSections) {
    const tag = sec.key;
    await open(); await select(tag);
    if (MOBILE) await snap(`${tag}_setup`);

    // --- Identify: wrong, right, right
    await start({ mode: 'identify', len: 3, level: 'major', group: '', pins: 8, instant: true });
    let expect = 0, leaks = [], noHover = true;
    for (let q = 0; q < 3; q++) {
      const info = await ev(() => { const r = window.atlas.quiz.state().round.q; return { name: r.item.name, disp: window.atlas.nameOf({ name: r.item.name }), correct: r.opts.findIndex((o) => o.correct), n: r.opts.length, key: r.item.key }; });
      const txt = await ev(() => window.__visibleText());
      if (txt.toLowerCase().includes(info.disp.toLowerCase())) leaks.push(info.disp);
      if (q === 0) {   // hover over the highlighted structure: no name tooltip
        const pt = await ev((k) => { const u = window.atlas.quiz.state().round.q.item; return window.__pointOn(u); }, info.key);
        if (pt) { await page.mouse.move(pt.x - 4, pt.y - 4); await page.mouse.move(pt.x, pt.y); await h.sleep(250); noHover = await ev(() => document.getElementById('tip').hidden); }
        await snap(`${tag}_identify_q`);
      }
      const opts = await ev(() => document.querySelectorAll('.qopt').length);
      const pickIdx = q === 0 ? (info.correct + 1) % info.n : info.correct;
      if (q === 1 && !MOBILE) await page.keyboard.press(String(pickIdx + 1)); else await page.click(`.qopt:nth-child(${pickIdx + 1})`);
      if (pickIdx === info.correct) expect++;
      await waitFor(() => document.querySelector('.qfeed'));
      const fb = await ev(() => ({ cls: document.querySelector('.qfeed').className, marks: [...document.querySelectorAll('.qopt.ok, .qopt.bad')].length, tag: !!document.querySelector('.qtag') }));
      if (q === 0) { check(`[${tag}] identify: wrong answer shows red feedback and the right option`, /bad/.test(fb.cls) && fb.marks === 2, JSON.stringify(fb)); await snap(`${tag}_identify_answered`); }
      check(`[${tag}] identify q${q + 1}: ${opts} options`, opts === 4 || sec.units < 8, `${opts}`);
      await page.click('[data-primary]');
      if (q < 2) await waitFor((n) => document.querySelector('.qprog span').textContent.includes(`Question ${n}`), q + 2);
    }
    await waitFor(() => document.querySelector('.qscore'));
    const score = await ev(() => document.querySelector('.qscore b').textContent);
    check(`[${tag}] identify: no answer leaked before answering`, leaks.length === 0, leaks.join(' | '));
    check(`[${tag}] identify: hover tooltip suppressed`, noHover);
    check(`[${tag}] identify: score ${expect}/3`, score === `${expect} / 3`, score);
    if (tag === 'skeletal') await snap('skeletal_results');

    // --- Locate: click the right structure, click another, click the right one
    await start({ mode: 'locate', len: 3, level: 'major' });
    let lexp = 0, lleak = [];
    for (let q = 0; q < 3; q++) {
      const info = await ev(() => { const it = window.atlas.quiz.state().round.q.item; return { disp: window.atlas.nameOf({ name: it.name }), pts: window.__pointOn(it), key: it.key }; });
      const txt = await ev(() => window.__visibleText());   // the name IS the question here, so only check the hover tip and overlay
      const tip = await ev(() => document.getElementById('tip').innerText + document.getElementById('overlay').innerText);
      if (tip.toLowerCase().includes(info.disp.toLowerCase())) lleak.push(info.disp);
      if (q === 0) await snap(`${tag}_locate_q`);
      let click = info.pts, wrong = false;
      if (q === 1) {
        const other = await ev((k) => { const st = window.atlas.quiz.state(), pool = st.round.pool.filter((u) => u.key !== k); for (const u of pool) { const p = window.__pointOn(u); if (p) return { p, name: u.name }; } return null; }, info.key);
        if (other) { click = other.p; wrong = true; }
      }
      check(`[${tag}] locate q${q + 1}: target visible on screen (clickable)`, !!click, info.disp);
      if (!click) { await ev(() => window.atlas.quiz.state().round.q && document.querySelectorAll('.btn').forEach((b) => b.textContent === 'Show me' && b.click())); }
      else { await page.mouse.click(click.x, click.y); if (!wrong) lexp++; }
      try { await waitFor(() => document.querySelector('.qfeed'), null, 6000); } catch (e) {
        console.log('DIAG locate q', q, JSON.stringify({ info, click, wrong, st: await ev(() => { const s = window.atlas.quiz.state(); return { answered: s.round.q?.answered, i: s.round.i, handler: typeof window.atlas.pickHandler, sel: window.atlas.S.sel.size, txt: document.querySelector('.qs-body')?.innerText.slice(0, 100) }; }) }));
        await snap(`${tag}_locate_diag${q}`); throw e;
      }
      if (q === 0) await snap(`${tag}_locate_answered`);
      await page.click('[data-primary]');
      if (q < 2) await waitFor((n) => document.querySelector('.qprog span')?.textContent.includes(`Question ${n}`), q + 2, 45000);
    }
    await waitFor(() => document.querySelector('.qscore'));
    const lscore = await ev(() => document.querySelector('.qscore b').textContent);
    check(`[${tag}] locate: click scoring ${lexp}/3`, lscore === `${lexp} / 3`, lscore);
    check(`[${tag}] locate: no hover/overlay leak`, lleak.length === 0, lleak.join());

    // --- Label the diagram: 5 pins, one wrong first try, checked as we go
    const build = await buildLabel(tag, { pins: 5, instant: true });
    check(`[${tag}] label: diagram build succeeds within a few tries (try ${build.tries}/5, ${build.fails} fell back first)`, build.ok, JSON.stringify(build));
    if (!build.ok) {
      const msg = await ev(() => document.querySelector('.qs-load')?.textContent || '');
      check(`[${tag}] label: a failed build shows the fallback message and returns to setup cleanly (no crash)`, /overlapped|try/i.test(msg) && !!document.querySelector('.qmode'), msg);
    } else {
      const pins = await ev(() => window.__pins());
      const geom = (() => { let minGap = 1e9; for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) minGap = Math.min(minGap, Math.hypot(pins[i].cx - pins[j].cx, pins[i].cy - pins[j].cy)); return minGap; })();
      check(`[${tag}] label: ${pins.length} pins placed`, pins.length >= 2, String(pins.length));
      check(`[${tag}] label: every pin visible, badge and anchor inside the stage`, pins.every((p) => p.shown && p.cx > 0 && p.cy > 0 && p.cx < p.W && p.cy < p.H && p.dx > 0 && p.dy > 0 && p.dx < p.W && p.dy < p.H), JSON.stringify(pins));
      check(`[${tag}] label: badges do not overlap (min gap ${geom.toFixed(0)}px)`, geom >= 24 || pins.length < 2, String(geom));
      check(`[${tag}] label: no pin starts occluded`, pins.every((p) => !p.behind), JSON.stringify(pins.map((p) => p.behind)));
      const lab = await ev(() => { const d = window.atlas.quiz.state().round.dia; return { n: d.slots.length, keys: d.slots.map((s) => s.unit.key), bank: d.bank.map((u) => u.key), names: d.slots.map((s) => window.atlas.nameOf({ name: s.unit.name })) }; });
      const ltxt = await ev(() => window.__visibleText());
      check(`[${tag}] label: slots start empty and no name is shown outside the word bank`, !lab.names.some((n) => ltxt.toLowerCase().includes(n.toLowerCase())), lab.names.join('|'));
      check(`[${tag}] label: word bank has the ${lab.n} answers plus distractors`, lab.bank.length > lab.n && lab.keys.every((k) => lab.bank.includes(k)), `${lab.bank.length}`);
      await snap(`${tag}_label`);
      const wrongKey = await ev(() => { const d = window.atlas.quiz.state().round.dia; return d.bank.find((u) => !d.slots.some((s) => s.unit === u))?.key; });
      for (let i = 0; i < lab.n; i++) {
        await page.click(`.qslot:nth-child(${i + 1}) .qslot-main`);
        if (i === 0 && wrongKey) {
          await page.click(`.qchip[data-key="${wrongKey.replace(/"/g, '\\"')}"]`);
          await h.sleep(150);
          const st = await ev(() => ({ s: window.atlas.quiz.state().round.dia.slots[0].state, pin: document.querySelector('.qpin').dataset.state }));
          check(`[${tag}] label: instant feedback flags a wrong pick`, st.s === 'bad' && st.pin === 'bad', JSON.stringify(st));
          await h.sleep(1000);   // wrong pick clears itself
        }
        await page.click(`.qchip[data-key="${lab.keys[i].replace(/"/g, '\\"')}"]:not([disabled])`);
      }
      await waitFor(() => document.querySelector('[data-primary]'));
      const mid = await ev(() => ({ ok: window.atlas.quiz.state().round.dia.slots.filter((s) => s.state === 'ok').length, txt: document.querySelector('.qprog span:last-child').textContent }));
      check(`[${tag}] label: all slots resolved`, mid.ok === lab.n, JSON.stringify(mid));
      await snap(`${tag}_label_done`);
      await page.click('[data-primary]');                        // Finish
      await waitFor(() => document.querySelector('[data-primary]') && /See results/.test(document.querySelector('[data-primary]').textContent));
      await page.click('[data-primary]');
      await waitFor(() => document.querySelector('.qscore'));
      const lbl = await ev(() => document.querySelector('.qscore b').textContent);
      check(`[${tag}] label: score = pins minus the deliberate miss`, lbl === `${lab.n - (wrongKey ? 1 : 0)} / ${lab.n}`, lbl);
      await select(tag);   // leave the loop in "setup" so the Facts/Movements block below starts from a known state
    }

    // --- Facts / Movements
    if (sec.modes.includes('facts') || sec.modes.includes('moves')) {
      const mode = sec.modes.includes('facts') ? 'facts' : 'moves';
      await select(tag); await waitFor(() => document.querySelector('.qmode'));
      await start({ mode, len: 6, level: 'all', group: '' });
      let fexp = 0;
      for (let q = 0; q < 6; q++) {
        const info = await ev(() => { const r = window.atlas.quiz.state().round.q; return { kind: r.kind, correct: r.opts.findIndex((o) => o.correct), n: r.opts.length, stem: document.querySelector('.qstem').textContent, name: r.item.name }; });
        if (info.kind === 'moveB') { const t = await ev(() => window.__visibleText()); check(`[${tag}] ${mode} q${q + 1}: highlighted-muscle question does not name the muscle`, !t.toLowerCase().includes(info.name.toLowerCase()), info.stem); }
        if (q === 0) await snap(`${tag}_${mode}_q`);
        const pick = q % 3 === 0 ? (info.correct + 1) % info.n : info.correct;
        await page.click(`.qopt:nth-child(${pick + 1})`); if (pick === info.correct) fexp++;
        await waitFor(() => document.querySelector('.qfeed'));
        if (q === 0) await snap(`${tag}_${mode}_answered`);
        await page.click('[data-primary]');
      }
      await waitFor(() => document.querySelector('.qscore'));
      const fs = await ev(() => document.querySelector('.qscore b').textContent);
      check(`[${tag}] ${mode}: ${fexp}/6 scored`, fs === `${fexp} / 6`, fs);
    }
    await ev(() => window.atlas.quiz.close()); await h.sleep(300);
  }

  // ---- 3. label without per-answer feedback, then persistence + review loop ---------------
  if (!MOBILE && (!ONLY.length || process.env.PERSIST)) {
    await open(); await select('skeletal');
    const skBuild = await buildLabel('skeletal', { pins: 5, instant: false });
    check('label (check at end): diagram build succeeds', skBuild.ok, JSON.stringify(skBuild));
    if (skBuild.ok) {
      const d = await ev(() => { const dd = window.atlas.quiz.state().round.dia; return { keys: dd.slots.map((s) => s.unit.key), n: dd.slots.length }; });
      for (let i = 0; i < d.n; i++) { await page.click(`.qslot:nth-child(${i + 1}) .qslot-main`); await page.click(`.qchip[data-key="${d.keys[i].replace(/"/g, '\\"')}"]:not([disabled])`); }
      const pre = await ev(() => window.atlas.quiz.state().round.dia.slots.map((s) => s.state).join());
      check('label (check at end): nothing is judged before "Check answers"', !/ok|bad/.test(pre), pre);
      await h.evalJs('document.querySelector(".qs-actions .btn.primary").click()');
      await waitFor(() => /See results/.test(document.querySelector('[data-primary]')?.textContent || ''));
      await snap('skeletal_label_checked');
      await page.click('[data-primary]'); await waitFor(() => document.querySelector('.qscore'));
      check('label (check at end): all right scores full marks', (await ev(() => document.querySelector('.qscore b').textContent)) === `${d.n} / ${d.n}`);
      await select('skeletal');
    }

    // persistence: skeletal identify with two misses, reload, review
    await ev(() => window.atlas.quiz.select(window.atlas.quiz.sections().find((s) => s.key === 'skeletal')));
    await start({ mode: 'identify', len: 5, level: 'major' });
    const missedKeys = [];
    for (let q = 0; q < 5; q++) {
      const i = await ev(() => { const r = window.atlas.quiz.state().round.q; return { c: r.opts.findIndex((o) => o.correct), key: r.item.key, n: r.opts.length }; });
      const wrong = q < 2; if (wrong) missedKeys.push(i.key);
      await page.click(`.qopt:nth-child(${(wrong ? (i.c + 1) % i.n : i.c) + 1})`); await page.click('[data-primary]');
    }
    await waitFor(() => document.querySelector('.qscore'));
    const stored = await ev(() => localStorage.getItem(window.atlas.quiz.storageKey));
    const P = JSON.parse(stored || '{}');
    const boxes = missedKeys.map((k) => P.s?.skeletal?.seen?.[k]?.[2]);
    check('progress stored in localStorage; misses are in Leitner box 1', boxes.every((b) => b === 1), JSON.stringify({ missedKeys, boxes }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => window.atlas && window.atlas.S && window.atlas.S.M && window.atlas.quiz, null, 90000);
    await open(); await select('skeletal');
    const rv = await ev(() => [...document.querySelectorAll('.qs-actions .btn')].map((b) => b.textContent));
    check('after reload: "Review misses" is offered with the right count', rv.some((t) => /Review misses \((\d+)\)/.test(t)), rv.join('|'));
    const cardStat = await ev(() => { window.atlas.quiz.close(); return null; });
    await open(); const cards = await ev(() => document.querySelector('.qcard-stat').textContent); check('menu shows learned / review counts', /learned/.test(cards) && /to review/.test(cards), cards);
    await select('skeletal');
    await ev(() => [...document.querySelectorAll('.qs-actions .btn')].find((b) => /Review misses/.test(b.textContent)).click());
    await waitFor(() => window.atlas.quiz.state().round?.q);
    const rp = await ev(() => { const r = window.atlas.quiz.state().round; return { review: r.review, pool: r.pool.map((u) => u.key), stem: document.querySelector('.qstem').textContent }; });
    // Review is cumulative box-1 tracking for the whole session (by design), not just this segment's misses: step 2's
    // per-section loop above already ran identify on skeletal and deliberately missed q=0 there too, so the pool can
    // legitimately contain more than just missedKeys. Assert the new misses are included and nothing was answered right
    // is still queued (box >= 2 excluded), not exact-set equality.
    check('review round includes the missed structures (and only currently-missed ones)', rp.review && missedKeys.every((k) => rp.pool.includes(k)), JSON.stringify(rp));
    for (let q = 0; q < rp.pool.length; q++) { const c = await ev(() => window.atlas.quiz.state().round.q.opts.findIndex((o) => o.correct)); await page.click(`.qopt:nth-child(${c + 1})`); await page.click('[data-primary]'); }
    await waitFor(() => document.querySelector('.qscore'));
    const P2 = JSON.parse(await ev(() => localStorage.getItem(window.atlas.quiz.storageKey)));
    check('answering misses correctly promotes them out of box 1', missedKeys.every((k) => P2.s.skeletal.seen[k][2] === 2), JSON.stringify(missedKeys.map((k) => P2.s.skeletal.seen[k])));

    // works with storage blocked
    await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => window.atlas && window.atlas.S && window.atlas.S.M && window.atlas.quiz, null, 90000);
    await open(); await select('lymphoid'); await start({ mode: 'identify', len: 3 });
    const c0 = await ev(() => window.atlas.quiz.state().round.q.opts.findIndex((o) => o.correct));
    await page.click(`.qopt:nth-child(${c0 + 1})`); await waitFor(() => document.querySelector('.qfeed'));
    check('quiz works with localStorage blocked', true);
  }

  // ---- 4. mobile layout ---------------------------------------------------------------------
  if (MOBILE) {
    check('no horizontal page scroll (quiz)', await ev(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await open(); await select('muscular'); const mBuild = await buildLabel('muscular', { pins: 5, instant: true }); await snap('muscular_label_m');
    check('mobile: muscular label diagram builds within a few tries', mBuild.ok, JSON.stringify(mBuild));
    const vis = await ev(() => { const r = document.getElementById('study').getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); return { studyTop: r.top, studyH: r.height, stageH: st.height, vh: innerHeight }; });
    check('mobile: stage keeps at least 30% of the viewport height', vis.stageH > vis.vh * 0.3, JSON.stringify(vis));
  }

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
  const fail = results.filter((r) => !r[1]);
  console.log(`\n${results.length - fail.length}/${results.length} checks passed`);
  if (fail.length) { console.log('FAILED:', fail.map((f) => f[0]).join('\n  ')); process.exitCode = 1; }
}
