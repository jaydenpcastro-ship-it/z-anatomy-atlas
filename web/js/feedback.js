// Request a change / flag a problem: a "Feedback" button in the top bar, a "Flag" button on every structure, and
// the "Request a change" card in the empty info panel all open one form. A visitor picks wrong information,
// glitch or other and writes a short answer; it goes to /api/feedback, where a reviewer agent checks it before it
// reaches the site owner's list (admin.html).
const atlas = window.atlas;
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;          // static icon strings only
    else if (k === 'checked' || k === 'value') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DONE = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M15 24.5l6 6 12-13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MAX = 250;
// Contact for further inquiries / issues. Joined here so the address is not sitting in the page's HTML for simple scrapers.
const CONTACT = ['jaydenpcastro', 'gmail.com'].join('@');
const mailto = (subject = 'Anatomy Atlas VTL') => `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;
const mailLink = (subject) => el('a', { href: mailto(subject), className: 'fb-mail' }, CONTACT);
function fillEmail(root) {
  root?.querySelectorAll('[data-vtl="email"]').forEach((a) => { a.href = mailto(); a.textContent = CONTACT; });
}
fillEmail(document);
fillEmail($('#info-empty')?.content);      // the empty info panel is cloned from this template
const KINDS = [
  { id: 'wrong_info', label: 'Wrong information', hint: 'A fact, name, label or description is incorrect', ph: 'What is wrong, and what should it say? e.g. "The deltoid is supplied by the axillary nerve, not the radial nerve."' },
  { id: 'glitch', label: 'Glitch', hint: 'Something looks broken or does not work', ph: 'What happened, and what were you doing? e.g. "The femur disappears when I turn on Section."' },
  { id: 'other', label: 'Other', hint: 'A change or addition you would like to see', ph: 'What would you like changed or added? e.g. "Add a lesson on the brachial plexus branches."' },
];

// --------------------------------------------------------------------- DOM ---
const btn = el('button', { id: 'feedbackBtn', className: 'mode-btn fb-btn', type: 'button', 'aria-label': 'Feedback: request a change', 'aria-expanded': 'false', 'aria-controls': 'feedbackPanel', title: 'Report wrong information or a glitch, or request a change' },
  el('span', { html: FLAG, style: 'display:contents' }), el('span', { className: 'fb-btn-label' }, 'Feedback'));
$('#topbar .lang')?.before(btn);
const panel = el('section', { id: 'feedbackPanel', className: 'vpanel', hidden: true, 'aria-labelledby': 'fbTitle' });
document.body.append(panel);

let kind = 'wrong_info', attach = true, diag = true, sent = false, sending = false, draft = '';

function structure() {
  const r = atlas?.S?.cur;
  return r ? { name: r.name, system: r.system, side: r.side || '', label: atlas.nameOf(r), sys: atlas.SYS?.[r.system]?.[0] || r.system } : null;
}
function pageState() {
  const S = atlas?.S;
  const mode = atlas?.quiz?.isOpen?.() ? 'Study (quiz)' : atlas?.lessons?.current?.() ? 'Lesson' : '';
  const out = { hash: location.hash.slice(0, 600), mode };
  if (kind === 'glitch' && diag) {
    out.ua = navigator.userAgent;
    out.viewport = `${innerWidth}x${innerHeight} @${devicePixelRatio || 1}x`;
    try {
      const gl = atlas.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 160);
    } catch { /* no WebGL info */ }
    out.errors = (window.__vtlErrors || []).slice(-8);
  }
  if (S && !S.M) out.mode = `${out.mode} (atlas still loading)`.trim();
  return out;
}

function render() {
  if (panel.hidden) return;
  const head = el('div', { className: 'vhead' }, el('h2', { id: 'fbTitle' }, 'Request a change'),
    el('button', { className: 'vnote-x', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => open(false) }, '×'));
  if (sent) {
    panel.replaceChildren(head, el('div', { className: 'vbody' }, el('div', { className: 'fb-done', role: 'status' },
      el('span', { html: DONE, style: 'display:contents' }),
      el('h3', {}, 'Thanks — your report is in'),
      el('p', {}, 'A reviewer agent double-checks every report. If it holds up, it goes on the list the site owner works through each week.'),
      el('p', {}, 'Further inquiries or issues? Email ', mailLink('Anatomy Atlas VTL — inquiry'), '.'),
      el('div', { className: 'vrow', style: 'justify-content:center' },
        el('button', { className: 'btn', type: 'button', onclick: () => { sent = false; render(); } }, 'Send another'),
        el('button', { className: 'btn primary', type: 'button', onclick: () => open(false) }, 'Done')))));
    return;
  }
  const s = structure();
  const k = KINDS.find((x) => x.id === kind);
  const text = el('textarea', { className: 'vin', id: 'fbText', rows: '3', maxlength: String(MAX), placeholder: k.ph, value: draft, 'aria-describedby': 'fbCount' });
  const count = el('span', { className: 'fb-count', id: 'fbCount' }, `${draft.length} / ${MAX}`);
  text.addEventListener('input', () => { draft = text.value; count.textContent = `${draft.length} / ${MAX}`; count.classList.toggle('over', draft.length > MAX); });
  const status = el('p', { className: 'fb-status', role: 'status' });
  const submitBtn = el('button', { className: 'btn primary', type: 'submit', disabled: sending }, sending ? 'Sending…' : 'Send report');

  const form = el('form', { className: 'vbody', novalidate: true, onsubmit: (e) => { e.preventDefault(); send(text, status, submitBtn); } },
    el('p', { className: 'fb-fine', style: 'margin-top:8px' }, 'Spotted wrong information or a glitch, or want something added? Pick one and tell us in a sentence or two.'),
    el('fieldset', { className: 'fb-kinds' }, el('legend', {}, 'What kind of report?'),
      KINDS.map((x) => el('label', { className: 'fb-kind' },
        el('input', { type: 'radio', name: 'fbKind', value: x.id, checked: x.id === kind, onchange: () => { kind = x.id; render(); $('#fbText')?.focus(); } }),
        el('b', {}, x.label), el('small', {}, x.hint)))),
    el('label', { className: 'fb-label', for: 'fbText' }, 'Short answer', count),
    text,
    s ? el('label', { className: 'fb-check' },
      el('input', { type: 'checkbox', checked: attach, onchange: (e) => { attach = e.target.checked; } }),
      el('span', {}, 'About ', el('b', {}, s.label), ` (${s.sys})`)) : '',
    kind === 'glitch' ? el('label', { className: 'fb-check' },
      el('input', { type: 'checkbox', checked: diag, onchange: (e) => { diag = e.target.checked; } }),
      el('span', {}, 'Include technical details (browser, screen size, recent errors)')) : '',
    el('input', { className: 'fb-hp', type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
    el('div', { className: 'vrow' }, submitBtn, el('button', { className: 'btn', type: 'button', onclick: () => open(false) }, 'Cancel')),
    status,
    el('p', { className: 'fb-fine' }, 'No name or email needed. Reports are read by an AI reviewer and the site owner.'),
    el('p', { className: 'fb-fine' }, 'Further inquiries or issues? Email ', mailLink('Anatomy Atlas VTL — inquiry'), '.'));
  panel.replaceChildren(head, form);
}

async function send(text, status, submitBtn) {
  const message = text.value.trim();
  status.classList.remove('err');
  status.replaceChildren();
  if (message.length < 3) { status.classList.add('err'); status.textContent = 'Please describe it in a few words.'; text.focus(); return; }
  if (message.length > MAX) { status.classList.add('err'); status.textContent = `Please keep it under ${MAX} characters.`; text.focus(); return; }
  const s = structure();
  const body = {
    category: kind, message,
    structure: s && attach ? { name: s.name, system: s.system, side: s.side } : null,
    page: pageState(),
    website: panel.querySelector('.fb-hp')?.value || '',
  };
  sending = true; submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && j.error) || (res.status === 404 || res.status === 501 ? 'Reports are not available on this copy of the site.' : `Could not send the report (${res.status}).`));
    sent = true; draft = '';
    sending = false;
    render();
    panel.querySelector('.fb-done')?.focus?.();
  } catch (err) {
    sending = false; submitBtn.disabled = false; submitBtn.textContent = 'Send report';
    status.classList.add('err');
    status.replaceChildren(err.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : err.message,
      ' You can also email ', mailLink('Anatomy Atlas VTL — report'), '.');
  }
}

// ------------------------------------------------------------ open / close --
function open(on, opts = {}) {
  if (on) {
    if (!$('#viewsPanel')?.hidden) $('#viewsBtn')?.click();            // one floating panel at a time
    if (opts.kind) kind = opts.kind;
    if (opts.attach != null) attach = opts.attach;
    if (!sending) sent = false;
  }
  panel.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  btn.classList.toggle('on', on);
  if (on) { render(); setTimeout(() => $('#fbText')?.focus(), 0); }
  else if (panel.contains(document.activeElement)) btn.focus();
}
btn.addEventListener('click', () => open(panel.hidden, { attach: true }));
$('#viewsBtn')?.addEventListener('click', () => { if (!panel.hidden) open(false); });
panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); open(false); } });
document.addEventListener('click', (e) => { if (e.target.closest('[data-vtl="feedback"]')) open(true, { kind: 'other' }); });
window.addEventListener('atlas:select', () => { if (!panel.hidden && !sent) render(); });

// "Flag" on every structure's info panel: opens the form as a wrong-information report about it
window.addEventListener('atlas:select', (e) => {
  const actions = $('#info .actions');
  if (!actions || !e.detail?.rec || actions.querySelector('.vtl-flag')) return;
  actions.append(el('button', {
    className: 'btn vtl-act vtl-flag', type: 'button', title: 'Report wrong information or a glitch about this structure',
    onclick: () => open(true, { kind: 'wrong_info', attach: true }),
  }, el('span', { html: FLAG, style: 'display:contents' }), 'Flag'));
});

if (atlas) atlas.feedback = { open: (kindId) => open(true, { kind: kindId }), close: () => open(false) };
