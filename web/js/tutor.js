// Anatomy tutor: a chat button on the 3D stage and a chat panel that streams answers from /api/chat (Claude).
// Each question carries a short <atlas_context> block saying what is selected / open, so "this muscle" works.
// Structure names the tutor writes as [[Name]] become buttons that select the structure in the 3D view.
// The conversation lives in sessionStorage (this tab only) and is sent whole with every question.
const atlas = window.atlas;
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;          // only ever used with the static icon strings below
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const ICON = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8.5 8.5h7M8.5 11.5h4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>',
};
const KEY = 'vtl.tutor.v1', MAX_QUESTION = 1500;
const mobile = () => matchMedia('(max-width: 860px)').matches;
const SYS_NAME = () => atlas?.SYS || {};

// --------------------------------------------------------------- conversation --
// { role: 'user', content (as sent, with context), shown (what the learner typed) } | { role: 'assistant', content, stopped? }
let convo = [];
try { convo = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { convo = []; }
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(convo.slice(-30))); } catch { /* storage full or blocked */ } };

// --------------------------------------------------------------------- DOM ---
const fab = el('button', { className: 'tutor-fab', id: 'tutorFab', type: 'button', 'aria-controls': 'tutorPanel', 'aria-expanded': 'false', title: 'Ask the anatomy tutor' },
  el('span', { html: ICON.chat, style: 'display:contents' }), el('span', { className: 'tf-label' }, 'Ask the tutor'));
const log = el('div', { className: 'tp-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
const input = el('textarea', { rows: '1', maxlength: String(MAX_QUESTION), placeholder: 'Ask about any structure or concept…', 'aria-label': 'Your question' });
const sendBtn = el('button', { className: 'tp-send', type: 'submit', title: 'Send', 'aria-label': 'Send', html: ICON.send });
const ctxBar = el('div', { className: 'tp-ctx', hidden: true });
const panel = el('section', { className: 'tutor-panel', id: 'tutorPanel', role: 'dialog', 'aria-label': 'Anatomy tutor', hidden: true },
  el('header', { className: 'tp-head' },
    el('span', { className: 'tp-avatar', html: ICON.chat }),
    el('div', { className: 'tp-title' }, el('h2', {}, 'Anatomy tutor'), el('small', {}, 'AI · can make mistakes — check important facts')),
    el('button', { className: 'tp-icon', type: 'button', title: 'New conversation', 'aria-label': 'Start a new conversation', html: ICON.reset, onclick: () => reset() }),
    el('button', { className: 'tp-icon', type: 'button', title: 'Close', 'aria-label': 'Close the tutor', html: ICON.close, onclick: () => open(false) })),
  log,
  ctxBar,
  el('form', { className: 'tp-form', onsubmit: (e) => { e.preventDefault(); busy ? stop() : submit(); } }, input, sendBtn),
  el('p', { className: 'tp-note' }, 'For learning only — not medical advice.'));
const stage = $('#stage');
stage.append(fab, panel);

// ------------------------------------------------------------ open / close --
function open(on = true) {
  panel.hidden = !on;
  fab.setAttribute('aria-expanded', String(on));
  document.body.classList.toggle('tutor-open', on);
  if (on) { syncContext(); render(); if (!mobile()) input.focus({ preventScroll: true }); }
  else if (document.activeElement && panel.contains(document.activeElement)) fab.focus({ preventScroll: true });
}
fab.addEventListener('click', () => open(true));
panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); open(false); } });
window.addEventListener('vtl:tutor', (e) => {
  open(true);
  const q = e.detail && e.detail.prefill;
  if (q) { input.value = q; autosize(); input.focus(); input.setSelectionRange(q.length, q.length); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-vtl="tutor"]')) open(true); });

// ------------------------------------------------------------- the context --
let useCtx = true;
const sideName = (s) => (s === 'l' ? 'left' : s === 'r' ? 'right' : '');
function groupPath(rec) {
  const S = atlas.S, chain = [];
  let g = S.groups.get(rec.group);
  while (g && chain.length < 6) { chain.unshift(g.name); g = S.groups.get(g.parent); }
  return chain;
}
// What is on screen right now, for the tutor: written by the page, not the learner.
function contextBlock() {
  const S = atlas?.S;
  if (!S?.M) return '';
  const lines = [];
  const sel = atlas.selectionRecs();
  if (S.cur) {
    const sides = [...new Set(sel.filter((r) => r.name === S.cur.name).map((r) => sideName(r.side)).filter(Boolean))];
    lines.push(`Selected structure: ${S.cur.name}${sides.length ? ` (${sides.join(' and ')} side${sides.length > 1 ? 's' : ''})` : ''} — ${SYS_NAME()[S.cur.system]?.[0] || S.cur.system}`);
    const path = groupPath(S.cur);
    if (path.length) lines.push(`Where it sits in the atlas: ${path.join(' › ')}`);
  } else if (sel.length) {
    const names = [...new Set(sel.map((r) => r.name))];
    lines.push(`Selected structures (${names.length}): ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}`);
  }
  const lesson = atlas.lessons?.current?.();
  if (lesson) {
    const l = atlas.lessons.list().find((x) => x.id === lesson.id);
    const step = l?.steps[lesson.step];
    if (l && step) lines.push(`Open lesson: "${l.title}", step ${lesson.step + 1} of ${l.steps.length} — "${step.title}"`);
  }
  if (atlas.quiz?.isOpen?.()) lines.push('The Study (quiz) panel is open: the learner may be in the middle of a quiz.');
  if (S.iso) lines.push('View: only the selection is shown (Isolate).');
  else if (S.ghost) lines.push('View: everything except the selection is faded (Ghost).');
  if (S.lang && S.lang !== 'en') lines.push(`Structure names on screen are in ${$('#lang option:checked')?.textContent || S.lang}.`);
  return lines.length ? `<atlas_context>\n${lines.join('\n')}\n</atlas_context>\n\n` : '';
}
function syncContext() {
  const S = atlas?.S, rec = S?.cur;
  const count = S?.sel?.size || 0;
  if (!rec && !count) { ctxBar.hidden = true; return; }
  ctxBar.hidden = false;
  ctxBar.classList.toggle('off', !useCtx);
  ctxBar.style.setProperty('--dot', (rec && SYS_NAME()[rec.system]?.[1]) || 'var(--accent)');
  ctxBar.replaceChildren(el('span', { className: 'dot' }), useCtx ? 'Asking about' : 'Not sharing',
    el('b', {}, rec ? atlas.nameOf(rec) : `${new Set(atlas.selectionRecs().map((r) => r.name)).size} selected structures`),
    el('button', { type: 'button', onclick: () => { useCtx = !useCtx; syncContext(); } }, useCtx ? "Don't include" : 'Include'));
}
window.addEventListener('atlas:select', () => { useCtx = true; if (!panel.hidden) { syncContext(); if (!convo.length) render(); } });

// ------------------------------------------------- [[Name]] → 3D structures --
let index = null;
const norm = (s) => String(s).toLowerCase().replace(/[()]/g, ' ').replace(/^\s*(the|left|right)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ORDER = ['skeletal', 'muscular', 'nervous', 'cardiovascular', 'visceral', 'lymphoid', 'joints', 'fascia', 'regions', 'insertions', 'reference'];
function buildIndex() {
  const S = atlas.S, map = new Map();
  const put = (k, v) => { if (k && !map.has(k)) map.set(k, v); };
  const rank = (s) => { const i = ORDER.indexOf(s); return i < 0 ? 99 : i; };
  const recs = [...S.M.structures].sort((a, b) => rank(a.system) - rank(b.system));
  for (const r of recs) put(norm(r.name), { kind: 'rec', system: r.system, name: r.name });
  for (const r of recs) put(norm(r.name).replace(/ (muscle|muscles|bone|ligament)$/, ''), { kind: 'rec', system: r.system, name: r.name });
  for (const g of [...S.M.groups].sort((a, b) => rank(a.system) - rank(b.system))) put(norm(g.name), { kind: 'group', system: g.system, id: g.id, name: g.name });
  index = map;
}
function resolve(name) {
  if (!atlas?.S?.M) return null;
  if (!index) buildIndex();
  const k = norm(name), side = /^\s*left\b/i.test(name) ? 'l' : /^\s*right\b/i.test(name) ? 'r' : '';
  const hit = index.get(k) || index.get(`${k} muscle`) || index.get(k.replace(/s$/, '')) || index.get(k.replace(/ (muscle|bone)$/, ''));
  return hit ? { ...hit, side } : null;
}
async function show(target) {
  await atlas.ready;
  if (target.kind === 'rec') {
    const recs = atlas.recsByName(target.system, target.name);
    const rec = recs.find((r) => !target.side || r.side === target.side) || recs[0];
    if (rec) await atlas.selectRec(rec);
  } else {
    const recs = atlas.groupStructures(target.system, target.id);
    if (recs.length) atlas.selectMany(recs);
  }
  if (mobile()) open(false);
}

// ---------------------------------------------------- safe markdown subset --
// Paragraphs, "- " and "1. " lists, "### " headings, **bold**, *italic* and [[structure]] buttons. Text only:
// nothing the model writes is ever parsed as HTML.
function inline(tag, text) {
  const node = el(tag);
  const re = /\[\[([^\]\n]{1,90})\]\]|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) node.append(text.slice(last, m.index));
    if (m[1]) node.append(chip(m[1]));
    else if (m[2]) node.append(inline('strong', m[2]));
    else node.append(inline('em', m[3]));
    last = re.lastIndex;
  }
  if (last < text.length) node.append(text.slice(last));
  return node;
}
function chip(name) {
  const target = resolve(name);
  if (!target) return el('strong', {}, name);
  return el('button', { className: 'tp-chip', type: 'button', title: `Show ${target.name} in 3D`, onclick: () => show(target) },
    el('span', { html: ICON.eye, style: 'display:contents' }), name);
}
function markdown(text, streaming) {
  const box = el('div', { className: 'tp-msg bot' });
  if (streaming) text = text.replace(/\[\[[^\]]*\]?$/, '');      // hide a half-written [[name while it streams
  let list = null, para = [];
  const flush = () => { if (para.length) { box.append(inline('p', para.join(' '))); para = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); list = null; }
    else if ((m = /^#{1,6}\s+(.+)$/.exec(line))) { flush(); list = null; box.append(inline('h4', m[1].replace(/\*\*/g, ''))); }
    else if ((m = /^[-*•]\s+(.+)$/.exec(line))) { flush(); if (list?.tagName !== 'UL') box.append(list = el('ul')); list.append(inline('li', m[1])); }
    else if ((m = /^\d+[.)]\s+(.+)$/.exec(line))) { flush(); if (list?.tagName !== 'OL') box.append(list = el('ol')); list.append(inline('li', m[1])); }
    else { list = null; para.push(line); }
  }
  flush();
  return box;
}

// ------------------------------------------------------------------ render --
function suggestions() {
  const rec = atlas?.S?.cur;
  if (rec) {
    const n = atlas.nameOf(rec);
    const muscle = atlas.isMuscle?.(rec);
    return [
      `Explain the ${n} in simple terms`,
      muscle ? `What does the ${n} do, and what nerve supplies it?` : `What does the ${n} connect to or relate to?`,
      `Why does the ${n} matter clinically?`,
      `Quiz me on the ${n}`,
    ];
  }
  return [
    'How does the rotator cuff stabilise the shoulder?',
    'Walk me through the brachial plexus, step by step',
    "What's the difference between a tendon and a ligament?",
    'Quiz me on the bones of the hand',
  ];
}
let pending = null;      // the assistant reply being streamed: { content, error?, stopped? }
function render() {
  if (panel.hidden) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const nodes = [];
  if (!convo.length && !pending) {
    const rec = atlas?.S?.cur;
    nodes.push(el('div', { className: 'tp-empty' },
      el('h3', {}, rec ? `Questions about the ${atlas.nameOf(rec)}?` : 'Hi! What would you like to understand?'),
      el('p', {}, 'Ask about any structure, system or concept. I explain in plain language and link structures you can open in 3D.'),
      el('div', { className: 'tp-sugg' }, suggestions().map((q) => el('button', { type: 'button', onclick: () => submit(q) }, q)))));
  }
  for (const m of convo) {
    if (m.role === 'user') nodes.push(el('div', { className: 'tp-msg user' }, m.shown ?? m.content));
    else { const b = markdown(m.content, false); if (m.stopped) b.classList.add('stopped'); nodes.push(b); }
  }
  if (pending) {
    if (pending.content) nodes.push(markdown(pending.content, true));
    else if (!pending.error) nodes.push(el('div', { className: 'tp-typing', 'aria-label': 'The tutor is typing' }, el('i'), el('i'), el('i')));
    if (pending.error) {
      nodes.push(el('div', { className: 'tp-error', role: 'alert' }, pending.error,
        pending.retry ? el('button', { className: 'btn', type: 'button', onclick: retry }, 'Try again') : ''));
    }
  }
  log.replaceChildren(...nodes);
  if (nearBottom || busy) log.scrollTop = log.scrollHeight;
}
let raf = 0;
const renderSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

// ----------------------------------------------------------------- sending --
let busy = false, ctrl = null;
function setBusy(on) {
  busy = on;
  sendBtn.classList.toggle('stop', on);
  sendBtn.innerHTML = on ? ICON.stop : ICON.send;
  sendBtn.title = on ? 'Stop' : 'Send';
  sendBtn.setAttribute('aria-label', on ? 'Stop the answer' : 'Send');
}
function autosize() { input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(44, input.scrollHeight + 2))}px`; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) submit(); }
});

function submit(text) {
  const q = (text ?? input.value).trim().slice(0, MAX_QUESTION);
  if (!q || busy) return;
  if (text == null) { input.value = ''; autosize(); }
  convo.push({ role: 'user', content: (useCtx ? contextBlock() : '') + q, shown: q });
  persist();
  ask();
}
const retry = () => { if (!busy) ask(); };
function stop() { ctrl?.abort(); }

async function ask() {
  pending = { content: '' };
  setBusy(true);
  render();
  ctrl = new AbortController();
  const messages = convo.map(({ role, content }) => ({ role, content }));
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => null);
      throw Object.assign(new Error((j && j.error) || (res.status === 404 || res.status === 501
        ? 'The tutor is not available on this copy of the site.' : `The tutor is unavailable right now (${res.status}).`)), { retry: res.status !== 429 && res.status !== 503 });
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', ended = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t) { pending.content += ev.t; renderSoon(); }
        else if (ev.error) { if (ev.discard) pending.content = ''; throw Object.assign(new Error(ev.error), { retry: !ev.discard }); }
        else if (ev.done) ended = true;
      }
    }
    if (!ended && !pending.content) throw Object.assign(new Error('The answer was interrupted. Please try again.'), { retry: true });
    convo.push({ role: 'assistant', content: pending.content });
    pending = null;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (pending.content) convo.push({ role: 'assistant', content: pending.content, stopped: true });
      pending = null;
    } else {
      // a partial answer that broke off is kept on screen above the error, but not sent back as history
      pending.error = err.message || 'Something went wrong.';
      pending.retry = err.retry !== false;
    }
  } finally {
    ctrl = null;
    setBusy(false);
    persist();
    render();
  }
}
function reset() {
  stop();
  convo = []; pending = null; persist();
  useCtx = true; syncContext(); render();
  input.focus({ preventScroll: true });
}

// --------------------------------------------- "Ask tutor" on a structure ---
window.addEventListener('atlas:select', (e) => {
  const actions = $('#info .actions');
  const rec = e.detail?.rec;
  if (!actions || !rec || actions.querySelector('.vtl-ask')) return;
  actions.append(el('button', {
    className: 'btn vtl-act vtl-ask', type: 'button', title: `Ask the anatomy tutor about the ${atlas.nameOf(rec)}`,
    onclick: () => { useCtx = true; open(true); },
  }, el('span', { html: ICON.chat, style: 'display:contents' }), 'Ask tutor'));
});

atlas?.ready?.then(() => { index = null; if (!panel.hidden) { syncContext(); render(); } });
atlas.tutor = { open, ask: (q) => { open(true); submit(q); }, reset, conversation: () => convo.slice() };
