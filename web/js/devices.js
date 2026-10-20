// Input and layout help for every kind of device: mouse (desktop PC), trackpads (Mac and Windows laptops, iPad
// keyboards), phones and tablets. The matching CSS is the "multi-device" section of css/vtl.css; tap-versus-drag
// handling on the model lives with the picking code in app.js.
//
// - Safari (macOS, and iPadOS with a trackpad) reports a trackpad pinch as gesture events instead of the
//   Ctrl+wheel other browsers send, so the whole page zoomed instead of the model. Those pinches are passed on as
//   the Ctrl+wheel OrbitControls already understands. Pinches on a touchscreen stay with OrbitControls.
// - The hint under the model describes the controls of the device in hand.
// - Where the structure list slides in over the model (phones and iPads), it closes again once a
//   structure is picked or the model is touched, so the selection is never hidden behind it.
const canvas = document.getElementById('gl');
const stage = document.getElementById('stage');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');

// ------------------------------------------------------- trackpad pinch (Safari) --
let fingers = 0, lastScale = 1;
const countFingers = (e) => { fingers = e.touches.length; };
for (const t of ['touchstart', 'touchend', 'touchcancel']) window.addEventListener(t, countFingers, { passive: true, capture: true });
function onGesture(e) {
  e.preventDefault();                                   // never zoom the page from a pinch over the model
  if (fingers) return;                                  // touchscreen pinch: OrbitControls handles it already
  if (e.type === 'gesturestart') { lastScale = 1; return; }
  const ratio = e.scale / lastScale;
  lastScale = e.scale;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return;
  // OrbitControls zooms by 0.95^(|deltaY|/10) for a pinch-style (Ctrl) wheel event: this delta zooms by `ratio`
  canvas.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -195 * Math.log(ratio), ctrlKey: true, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
  }));
}
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(t, onGesture, { passive: false });

// ---------------------------------------------------------------- the hint --
const touchFirst = matchMedia('(pointer: coarse)');
function hint() {
  const h = document.getElementById('hint');
  if (!h || h.classList.contains('hide')) return;
  h.textContent = touchFirst.matches
    ? 'Drag to rotate · pinch to zoom · two-finger drag to pan · tap a structure'
    : 'Drag to rotate · scroll or pinch to zoom · right-drag or Shift-drag to pan · click a structure';
}
hint();
touchFirst.addEventListener?.('change', hint);

// ------------------------------------------------- slide-in structure list --
const overlaid = () => getComputedStyle(sidebar).position === 'fixed';
function syncMenu() { if (overlaid()) menuBtn.setAttribute('aria-expanded', String(document.body.classList.contains('nav-open'))); }
function closeNav() {
  if (!document.body.classList.contains('nav-open') || !overlaid()) return;
  document.body.classList.remove('nav-open');
  menuBtn.setAttribute('aria-expanded', 'false');
}
syncMenu();
addEventListener('resize', syncMenu);
window.addEventListener('atlas:select', closeNav);                  // picked a structure: show it
stage.addEventListener('pointerdown', closeNav, true);              // touched the model: get the list out of the way
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
