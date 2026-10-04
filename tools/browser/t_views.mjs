// Saved views + note pins + shareable link (camera, note, pins, cross-section, selection).
export default async function (page, h) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFor = (fn, arg, t = 60000) => page.waitForFunction(fn, { timeout: t, polling: 100 }, arg);
  let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); };
  await waitFor(() => window.atlas.views && window.atlas.section);
  await ev(() => localStorage.removeItem('zatlas.views.v1'));
  await ev(async () => { const a = window.atlas; await a.selectRec(a.S.M.structures.find((r) => r.id === 'Femur.l')); });
  await h.sleep(1200);
  await ev(() => document.getElementById('viewsBtn').click());
  await ev(() => [...document.querySelectorAll('#viewsPanel .btn')].find((b) => /Add note pin/.test(b.textContent)).click());
  // click the middle of the selected femur on screen
  const pt = await ev(() => { const a = window.atlas, r = a.S.byId.get('Femur.l'), o = a.project(new a.THREE.Vector3(...r.c)); const b = a.canvas.getBoundingClientRect(); return { x: b.left + o.x, y: b.top + o.y }; });
  await page.mouse.click(pt.x, pt.y);
  await h.sleep(400);
  const pins = await ev(() => window.atlas.views.pins().map((p) => p.label));
  check('pin placed on the femur', pins.length === 1 && /Femur/.test(pins[0]), JSON.stringify(pins));
  await ev(() => { const t = document.querySelector('#viewsPanel textarea'); t.value = 'Look at the linea aspera on the back.'; });
  await ev(() => window.atlas.section.set({ on: true, axis: 'z', pos: 0.5, flip: false }));
  await ev(() => [...document.querySelectorAll('#viewsPanel .btn')].find((b) => b.textContent === 'Save view').click());
  await h.sleep(300);
  const saved = await ev(() => window.atlas.views.list()[0]);
  check('view saved with camera, cut, pins, note', /cam=/.test(saved.hash) && /cut=z0.500/.test(saved.hash) && /pins=/.test(saved.hash) && /note=/.test(saved.hash), saved.hash);
  await h.shot('_shots/k/views_saved.png');
  // change everything, then reopen
  await ev(async () => { const a = window.atlas; a.section.set({ on: false }); a.views.setPins(''); a.views.showNote(''); await a.selectRec(a.S.M.structures.find((r) => r.id === 'Humerus.r')); });
  await h.sleep(800);
  await ev(() => window.atlas.views.open(window.atlas.views.list()[0]));
  await h.sleep(1500);
  const back = await ev(() => ({ cur: window.atlas.S.cur?.id, cut: window.atlas.section.get(), pins: window.atlas.views.pins().length, note: window.atlas.views.note() }));
  console.log('  saved', saved.hash);
  check('reopened view restores selection, cut, pin, note', back.cur === 'Femur.l' && back.cut.on && back.cut.axis === 'z' && back.pins === 1 && /linea aspera/.test(back.note), JSON.stringify(back));
  const link = `http://127.0.0.1:8770/#${saved.hash}`;
  await page.goto('about:blank'); await page.goto(link, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.atlas?.views && window.atlas.S.cur);
  await h.sleep(2500);
  const fresh = await ev(() => ({ cur: window.atlas.S.cur?.id, cut: window.atlas.section.get().on, pins: window.atlas.views.pins().length, note: !document.querySelector('.vnote').hidden,
    cam: window.atlas.camera.position.toArray().map((x) => +x.toFixed(2)) }));
  const want = new URLSearchParams(saved.hash).get('cam').split(',').slice(0, 3).map((x) => +(+x).toFixed(2));
  check('shared link restores the view in a new page', fresh.cur === 'Femur.l' && fresh.cut && fresh.pins === 1 && fresh.note, JSON.stringify(fresh));
  check('shared link restores the camera', fresh.cam.every((x, i) => Math.abs(x - want[i]) < 0.03), `${fresh.cam} vs ${want}`);
  await h.shot('_shots/k/views_link.png');
  console.log(fail ? `VIEWS ${fail} FAILED` : 'VIEWS ALL PASS');
}
