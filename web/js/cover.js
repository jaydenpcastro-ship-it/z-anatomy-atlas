// Cover screen shown before entering the atlas (#cover in index.html). The atlas loads behind it; "Enter the
// atlas" (or Enter / Esc) fades it away. The figure reveals one body system after another with a scan line.
// Links that already carry atlas state, and visitors who ticked "Skip this screen next time", never see it
// (decided by the inline script in <head>, which adds html.no-cover).
const cover = document.getElementById('cover');
const app = document.getElementById('app');
const SKIP_KEY = 'vtl.cover.skip';

if (cover && !document.documentElement.classList.contains('no-cover')) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  app.inert = true;

  // ------------------------------------------------------------------ status --
  const status = document.getElementById('cvStatus');
  const ready = () => { status.classList.add('ready'); status.querySelector('span').textContent = 'The 3D model is ready'; };
  if (window.atlas?.S?.M) ready(); else window.addEventListener('atlas:ready', ready, { once: true });

  // ------------------------------------------------------------------ layers --
  const layers = [...cover.querySelectorAll('.cv-layer')];
  const scan = cover.querySelector('.cv-scan');
  const caption = cover.querySelector('.cv-caption');
  const ticks = caption.querySelector('.cv-ticks');
  ticks.append(...layers.map(() => document.createElement('s')));
  const DUR = 1600, HOLD = 2600;
  let cur = 0, timer = 0, running = false;

  const label = (i) => {
    caption.style.setProperty('--cv-dot', layers[i].dataset.color);
    caption.querySelector('span').textContent = layers[i].dataset.label;
    [...ticks.children].forEach((t, j) => t.classList.toggle('on', j === i));
  };
  // the other layers load once the first is on screen, so the cover paints fast
  const loadRest = () => layers.forEach((img) => { if (img.dataset.src && !img.src) img.src = img.dataset.src; });
  const loaded = (img) => img.complete && img.naturalWidth > 0;

  function step() {
    const next = (cur + 1) % layers.length, a = layers[cur], b = layers[next];
    if (!loaded(b)) { timer = setTimeout(step, 400); return; }
    cover.style.setProperty('--cv-dur', `${DUR}ms`);
    a.classList.remove('on'); a.classList.add('out');
    b.classList.add('in');
    scan.classList.remove('run'); void scan.offsetWidth; scan.classList.add('run');
    label(next);
    timer = setTimeout(() => {
      a.classList.remove('out');
      b.classList.remove('in'); b.classList.add('on');
      cur = next;
      if (running) timer = setTimeout(step, HOLD);
    }, DUR);
  }
  const play = () => { if (running || reduce) return; running = true; timer = setTimeout(step, HOLD); };
  const pause = () => { running = false; clearTimeout(timer); };

  if (reduce) {
    // no animation: show every system together
    const all = layers.length - 1;
    layers[0].classList.remove('on');
    layers[all].src = layers[all].dataset.src; layers[all].classList.add('on');
    label(all);
  } else {
    label(0);
    if (loaded(layers[0])) loadRest(); else layers[0].addEventListener('load', loadRest, { once: true });
    play();
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  }

  // ------------------------------------------------------------------- enter --
  const skip = document.getElementById('cvSkip');
  function enter(then) {
    if (cover.hidden || cover.classList.contains('leaving')) return;
    pause();
    try { if (skip.checked) localStorage.setItem(SKIP_KEY, '1'); else localStorage.removeItem(SKIP_KEY); } catch { /* storage blocked */ }
    app.inert = false;
    cover.classList.add('leaving');
    const done = () => {
      cover.hidden = true;
      document.documentElement.classList.add('no-cover');
      window.dispatchEvent(new CustomEvent('vtl:entered'));
      if (then) then(); else document.getElementById('gl')?.focus({ preventScroll: true });
    };
    if (reduce) done(); else setTimeout(done, 450);
  }
  document.getElementById('cvEnter').addEventListener('click', () => enter());
  document.getElementById('cvTutor').addEventListener('click', () => enter(() => window.dispatchEvent(new CustomEvent('vtl:tutor', { detail: { open: true } }))));
  // While the cover is up, the atlas's single-key shortcuts (G, I, L, /, Esc…) must not reach it. Tab, Enter and
  // Space keep their normal behaviour; Esc enters.
  const keys = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); enter(); }
  };
  window.addEventListener('keydown', keys, true);
  window.addEventListener('vtl:entered', () => window.removeEventListener('keydown', keys, true), { once: true });
  document.getElementById('cvEnter').focus({ preventScroll: true });
}
