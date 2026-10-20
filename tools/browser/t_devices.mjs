// Multi-device check: phone, iPad portrait / landscape, iPad Pro, laptop (trackpad) and desktop PC (mouse).
//   node tools/browser/run.mjs --script tools/browser/t_devices.mjs --logs errors
// For each device: layout fits without sideways scrolling, the top bar fits, touch targets are finger-sized, text
// fields will not make iOS zoom, a tap (even a slightly wobbly one) selects, a two-finger pinch zooms without
// changing the selection. On the laptop/PC: trackpad pinch (Ctrl+wheel, and Safari's gesture events) zooms the
// model instead of the page, a right-click or two-finger click leaves the selection alone, Shift-drag pans.
const DEVICES = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, layout: 'stacked' },
  { name: 'ipad-portrait', width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true, layout: 'stacked' },
  { name: 'ipad-landscape', width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true, layout: 'slide-in' },
  { name: 'ipad-pro-landscape', width: 1366, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, layout: 'slide-in' },
  { name: 'laptop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, layout: 'columns' },
  { name: 'desktop', width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false, layout: 'columns' },
];
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export default async function (page, h) {
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const cdp = await page.createCDPSession();
  const camDist = () => ev(() => window.atlas.camera.position.distanceTo(window.atlas.controls.target));
  const femurPoint = () => ev(() => {
    const a = window.atlas, r = a.S.byId.get('Femur.l'), o = a.project(new a.THREE.Vector3(...r.c)), b = a.canvas.getBoundingClientRect();
    return { x: Math.round(b.left + o.x), y: Math.round(b.top + o.y), stage: { l: b.left, t: b.top, w: b.width, h: b.height } };
  });
  const frameFemur = () => ev(async () => {
    const a = window.atlas; a.clearSel();
    await a.setSystemVisible('skeletal', true);
    a.focusRecs([a.S.byId.get('Femur.l'), a.S.byId.get('Femur.r')]);
  });

  for (const d of DEVICES) {
    const tag = `[${d.name}]`;
    await page.setUserAgent(d.name === 'phone' ? IPHONE_UA : d.hasTouch ? IPAD_UA : (await page.browser().userAgent()));
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch });
    await page.goto(page.url().split('#')[0], { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.atlas?.S?.M, { timeout: 90000 });
    await ev(() => window.atlas.ready);
    await h.sleep(800);

    // ---- layout
    const L = await ev(() => {
      const sb = document.getElementById('sidebar'), st = document.getElementById('stage');
      const bar = [...document.querySelectorAll('#topbar > *')].filter((n) => n.offsetParent);
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        overflowX: document.documentElement.scrollWidth - innerWidth,
        sidebar: getComputedStyle(sb).position,
        stageW: st.getBoundingClientRect().width, stageH: st.getBoundingClientRect().height,
        barRight: Math.max(...bar.map((n) => n.getBoundingClientRect().right)),
        smallest: Math.min(...[...document.querySelectorAll('#topbar button, #topbar select, .toolbar button')].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect().height)),
        searchFont: parseFloat(getComputedStyle(document.getElementById('q')).fontSize),
        hint: document.getElementById('hint').textContent,
        info: (() => { const r = document.getElementById('info').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })(),
      };
    });
    check(`${tag} touch devices report a touch-first pointer`, L.coarse === d.hasTouch, JSON.stringify(L.coarse));
    check(`${tag} no sideways scrolling`, L.overflowX <= 0, String(L.overflowX));
    check(`${tag} the top bar fits on screen`, L.barRight <= d.width + 0.5, `${L.barRight} > ${d.width}`);
    const want = { stacked: 'fixed', 'slide-in': 'fixed', columns: 'relative' }[d.layout];
    check(`${tag} structure list is ${d.layout === 'columns' ? 'a fixed column' : 'a slide-in panel'}`, d.layout === 'columns' ? L.sidebar !== 'fixed' : L.sidebar === 'fixed', L.sidebar);
    if (d.layout === 'slide-in') check(`${tag} the model gets most of the width`, L.stageW >= d.width * 0.6, `${Math.round(L.stageW)} of ${d.width}`);
    if (d.layout === 'stacked') check(`${tag} the info panel ends on screen`, L.info.bottom <= d.height + 1, JSON.stringify(L.info));
    if (d.hasTouch) {
      check(`${tag} buttons are finger-sized (>= 40 px tall)`, L.smallest >= 40, String(L.smallest));
      check(`${tag} text fields are 16 px so iOS does not zoom in`, L.searchFont >= 16, String(L.searchFont));
      check(`${tag} the hint talks about pinching and tapping`, /pinch/.test(L.hint) && /tap/.test(L.hint), L.hint);
    } else {
      check(`${tag} the hint explains trackpad and mouse panning`, /Shift-drag/.test(L.hint), L.hint);
    }
    await h.shot(`_shots/vtl/dev_${d.name}.png`);

    // ---- the slide-in list closes once a structure is picked from it
    if (d.layout !== 'columns') {
      await ev(() => document.getElementById('menuBtn').click());
      await h.sleep(300);
      const opened = await ev(() => document.body.classList.contains('nav-open') && document.getElementById('sidebar').getBoundingClientRect().left >= -1);
      await ev(async () => { const a = window.atlas; await a.selectRec(a.S.byId.get('Humerus.r')); });
      await h.sleep(300);
      check(`${tag} the structure list opens from the menu and closes after picking`, opened && !(await ev(() => document.body.classList.contains('nav-open'))));
    }

    // ---- taps and pinches on the model
    await frameFemur();
    await h.sleep(1400);
    let p = await femurPoint();
    if (d.hasTouch) {
      await page.touchscreen.tap(p.x, p.y);
      await h.sleep(400);
      check(`${tag} tapping the femur selects it`, (await ev(() => window.atlas.S.cur?.name)) === 'Femur', String(await ev(() => window.atlas.S.cur?.name)));
      await ev(() => window.atlas.clearSel());
      p = await femurPoint();
      await page.touchscreen.touchStart(p.x, p.y); await page.touchscreen.touchMove(p.x + 7, p.y + 3); await page.touchscreen.touchEnd();
      await h.sleep(400);
      check(`${tag} a slightly wobbly tap still selects`, (await ev(() => window.atlas.S.cur?.name)) === 'Femur', String(await ev(() => window.atlas.S.cur?.name)));
      const before = await camDist();
      const c = { x: p.stage.l + p.stage.w / 2, y: p.stage.t + p.stage.h / 2 };
      const pts = (gap) => [{ x: c.x - gap, y: c.y, id: 1 }, { x: c.x + gap, y: c.y, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
      for (let g = 45; g <= 110; g += 5) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(g) }); await h.sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await h.sleep(500);
      const after = await camDist();
      check(`${tag} a two-finger pinch zooms in`, after < before * 0.9, `${before.toFixed(3)} → ${after.toFixed(3)}`);
      check(`${tag} a pinch does not change the selection`, (await ev(() => window.atlas.S.cur?.name)) === 'Femur');
    } else {
      await page.mouse.click(p.x, p.y);
      await h.sleep(300);
      check(`${tag} clicking the femur selects it`, (await ev(() => window.atlas.S.cur?.name)) === 'Femur');
      const corner = { x: p.stage.l + 30, y: p.stage.t + p.stage.h - 30 };
      await page.mouse.click(corner.x, corner.y, { button: 'right' });
      await h.sleep(300);
      check(`${tag} a right-click / two-finger trackpad click keeps the selection`, (await ev(() => window.atlas.S.cur?.name)) === 'Femur');
      // trackpad pinch in Chrome, Edge and Firefox: a Ctrl+wheel event
      let before = await camDist();
      const prevented = await ev(({ x, y }) => {
        let all = true;
        for (let i = 0; i < 12; i++) { const e = new WheelEvent('wheel', { deltaY: -6, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }); window.atlas.canvas.dispatchEvent(e); all = all && e.defaultPrevented; }
        return all;
      }, p);
      await h.sleep(500);
      let after = await camDist();
      check(`${tag} trackpad pinch (Ctrl+wheel) zooms the model, not the page`, after < before * 0.9 && prevented, `${before.toFixed(3)} → ${after.toFixed(3)} prevented=${prevented}`);
      // trackpad pinch in Safari: gesture events
      before = after;
      const gPrevented = await ev(({ x, y }) => {
        const fire = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, {}); Object.defineProperties(e, { scale: { value: scale }, clientX: { value: x }, clientY: { value: y } }); window.atlas.canvas.dispatchEvent(e); return e.defaultPrevented; };
        let ok = fire('gesturestart', 1);
        for (let s = 1.05; s <= 1.6; s += 0.05) ok = fire('gesturechange', s) && ok;
        return fire('gestureend', 1.6) && ok;
      }, p);
      await h.sleep(500);
      after = await camDist();
      check(`${tag} Safari trackpad pinch (gesture events) zooms the model, not the page`, gPrevented && after < before * 0.8, `${before.toFixed(3)} → ${after.toFixed(3)} prevented=${gPrevented}`);
      // Shift-drag pans (for trackpads without a right button)
      const t0 = await ev(() => window.atlas.controls.target.toArray());
      await page.keyboard.down('Shift');
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + i * 10, p.y + i * 4);
      await page.mouse.up(); await page.keyboard.up('Shift');
      await h.sleep(600);
      const t1 = await ev(() => window.atlas.controls.target.toArray());
      check(`${tag} Shift-drag pans the view and keeps the selection`, Math.hypot(t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]) > 0.005 && (await ev(() => window.atlas.S.cur?.name)) === 'Femur');
    }

    // ---- the tutor and the request form fit the screen
    await ev(() => window.atlas.tutor.open(true));
    await h.sleep(300);
    const tp = await ev(() => { const r = document.getElementById('tutorPanel').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    check(`${tag} the tutor panel fits on screen`, tp.l >= -0.5 && tp.r <= d.width + 0.5 && tp.t >= -0.5 && tp.b <= d.height + 0.5, JSON.stringify(tp));
    await h.shot(`_shots/vtl/dev_${d.name}_tutor.png`);
    await ev(() => window.atlas.tutor.open(false));
    await ev(() => window.atlas.feedback.open('glitch'));
    await h.sleep(300);
    const fp = await ev(() => { const r = document.getElementById('feedbackPanel').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, scroll: document.getElementById('feedbackPanel').scrollHeight > document.getElementById('feedbackPanel').clientHeight }; });
    check(`${tag} the request form fits on screen (scrolls if it must)`, fp.l >= -0.5 && fp.r <= d.width + 0.5 && fp.b <= d.height + 0.5, JSON.stringify(fp));
    await ev(() => window.atlas.feedback.close());
  }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  if (fail) process.exitCode = 1;
}
