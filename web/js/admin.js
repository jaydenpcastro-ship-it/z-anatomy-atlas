// Owner review page: the flags that passed the reviewer agent, waiting for the owner to accept, implement or
// decline them, plus the weekly tally. Talks to /api/admin with the ADMIN_TOKEN (kept in this browser only).
const root = document.getElementById('ad');
const TOKEN_KEY = 'vtl.admin.token';
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, a = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;            // static icon strings only — user text always goes in as text
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const svg = (tag, a = {}, ...kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};

let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage blocked */ }
const saveToken = (t) => { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };
let data = null, tab = 'decide', cat = '', showTable = false;

async function api(method, body, path = '/api/admin') {
  const res = await fetch(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error(j.error || 'Wrong owner token.'), { auth: true });
  if (!res.ok) throw new Error(j.error || (res.status === 404 ? 'The owner API is not available on this copy of the site.' : `Request failed (${res.status}).`));
  return j;
}

// ------------------------------------------------------------------ helpers --
const CAT = {
  wrong_info: { label: 'Wrong information', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v5.5M12 16.5v.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' },
  glitch: { label: 'Glitch', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="8" width="10" height="12" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8V5M9 5.5l1.5 2M15 5.5l-1.5 2M7 12H3.5M20.5 12H17M7 16.5l-3 1.5M17 16.5l3 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
  other: { label: 'Other / request', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' },
};
const STATUS = { reviewing: 'Being reviewed', review_failed: 'Needs a manual look', open: 'Passed review — awaiting you', rejected: 'Rejected by reviewer',
  accepted: 'Accepted', implemented: 'Implemented', declined: 'Declined' };
const TABS = [
  { id: 'decide', label: 'To decide', match: (f) => ['open', 'review_failed', 'reviewing'].includes(f.status) },
  { id: 'accepted', label: 'Accepted', match: (f) => f.status === 'accepted' },
  { id: 'implemented', label: 'Implemented', match: (f) => f.status === 'implemented' },
  { id: 'declined', label: 'Declined', match: (f) => f.status === 'declined' },
  { id: 'rejected', label: 'Rejected by reviewer', match: (f) => f.status === 'rejected' },
  { id: 'all', label: 'All', match: () => true },
];
const PRIO = { high: 0, medium: 1, low: 2 };
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function weekStart(key) {                                   // Monday (UTC) of an ISO week key like 2026-W43
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return new Date(Date.UTC(y, 0, 4 - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7));
}
const md = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekRange = (key) => { const s = weekStart(key); return `${md(s)} – ${md(new Date(s.getTime() + 6 * 86400000))}`; };

// ------------------------------------------------------------------- views ---
const refreshBtn = document.getElementById('adRefresh');
const signOutBtn = document.getElementById('adSignOut');
refreshBtn.addEventListener('click', () => load());
signOutBtn.addEventListener('click', () => { saveToken(''); data = null; login(); });

function login(error) {
  refreshBtn.hidden = signOutBtn.hidden = true;
  const input = el('input', { className: 'ad-input', type: 'password', autocomplete: 'current-password', placeholder: 'Owner token', 'aria-label': 'Owner token' });
  const err = el('p', { className: 'ad-err', role: 'alert' }, error || '');
  root.replaceChildren(el('form', { className: 'ad-card ad-login', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) { saveToken(input.value.trim()); load(); } } },
    el('h1', {}, 'Owner review'),
    el('p', {}, 'Flags from visitors land here after the reviewer agent checks them. Sign in with the ADMIN_TOKEN you set in Vercel (Settings → Environment Variables).'),
    input, err,
    el('button', { className: 'btn primary', type: 'submit' }, 'Sign in')));
  input.focus();
}

async function load() {
  if (!token) { login(); return; }
  root.classList.add('loading');
  try {
    data = await api('GET');
    refreshBtn.hidden = signOutBtn.hidden = false;
    render();
  } catch (e) {
    if (e.auth) { saveToken(''); login(e.message); } else root.replaceChildren(el('div', { className: 'ad-card' }, el('p', { className: 'ad-err' }, e.message)));
  } finally { root.classList.remove('loading'); }
}

function render() {
  const { flags, tally, setup } = data;
  const parts = [];
  if (setup.store === 'memory') parts.push(banner('Flags are kept in memory', ' (local test server): they disappear when the server restarts. On Vercel, connect ', el('code', {}, 'Upstash for Redis'), ' in the Storage tab.'));
  if (!setup.reviewer) parts.push(banner('The reviewer agent is off.', ' Add ', el('code', {}, 'ANTHROPIC_API_KEY'), ' in Vercel. Until then new flags wait under “To decide” as “Needs a manual look”.'));
  parts.push(tiles(flags, tally), chartCard(tally, data.decisions), reportsCard(data.reports), listCard(flags));
  root.replaceChildren(...parts);
}
const banner = (title, ...rest) => el('div', { className: 'ad-banner', role: 'note' }, el('span', {}, el('b', {}, title), ...rest));

function tiles(flags, tally) {
  const awaiting = flags.filter((f) => f.status === 'open').length;
  const manual = flags.filter((f) => f.status === 'review_failed').length;
  const [now = {}, prev = {}] = tally;
  const diff = (now.submitted || 0) - (prev.submitted || 0);
  const implemented = flags.filter((f) => f.status === 'implemented').length;
  const accepted = flags.filter((f) => f.status === 'accepted').length;
  return el('section', { className: 'ad-tiles', 'aria-label': 'Summary' },
    el('div', { className: 'ad-tile lead' }, el('span', { className: 'lbl' }, 'Awaiting your decision'), el('span', { className: 'val hero' }, awaiting),
      el('span', { className: 'note' }, manual ? `+ ${manual} need a manual look` : 'passed the reviewer agent')),
    el('div', { className: 'ad-tile' }, el('span', { className: 'lbl' }, 'Flags this week'), el('span', { className: 'val' }, now.submitted || 0),
      el('span', { className: 'note delta' }, `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} vs last week (${prev.submitted || 0})`)),
    el('div', { className: 'ad-tile' }, el('span', { className: 'lbl' }, 'Passed review this week'), el('span', { className: 'val' }, now.valid || 0),
      el('span', { className: 'note' }, `${now.rejected || 0} rejected by the reviewer`)),
    el('div', { className: 'ad-tile' }, el('span', { className: 'lbl' }, 'Accepted / implemented'), el('span', { className: 'val' }, `${accepted} / ${implemented}`),
      el('span', { className: 'note' }, 'across all stored flags')));
}

// ----------------------------------------------------------- weekly chart ---
let resizer = null;
const SERIES = [
  { key: 'valid', label: 'Passed review', color: 'var(--series-1)' },
  { key: 'rejected', label: 'Rejected by reviewer', color: 'var(--series-2)' },
  { key: 'pending', label: 'Not reviewed yet', color: 'var(--series-3)' },
];
function chartCard(tally, decisions) {
  const weeks = tally.slice().reverse().map((t) => ({ ...t, pending: Math.max(0, t.submitted - t.valid - t.rejected) }));
  const host = el('div', { className: 'ad-chart' });
  const tip = el('div', { className: 'ad-tip', hidden: true });
  host.append(tip);
  const draw = () => drawChart(host, tip, weeks);
  requestAnimationFrame(draw);
  resizer?.disconnect();
  resizer = new ResizeObserver(() => draw());
  resizer.observe(host);
  const tableWrap = el('div', { className: 'ad-table-wrap', hidden: !showTable }, tallyTable(tally, decisions));
  const toggle = el('button', { className: 'ad-link', type: 'button', 'aria-expanded': String(showTable), onclick: () => {
    showTable = !showTable; tableWrap.hidden = !showTable; toggle.textContent = showTable ? 'Hide table' : 'Show as table'; toggle.setAttribute('aria-expanded', String(showTable));
  } }, showTable ? 'Hide table' : 'Show as table');
  return el('section', { className: 'ad-card', 'aria-labelledby': 'chartTitle' },
    el('div', { className: 'ad-row', style: 'justify-content:space-between' }, el('h2', { id: 'chartTitle' }, 'Weekly tally'), toggle),
    el('p', { className: 'ad-sub' }, 'Flags submitted per week (Monday–Sunday, UTC) and what the reviewer agent decided. Last 12 weeks.'),
    el('div', { className: 'ad-legend' }, SERIES.map((s) => el('span', { style: `--c:${s.color}` }, el('i'), s.label))),
    host, tableWrap);
}
function drawChart(host, tip, weeks) {
  const W = Math.max(280, host.clientWidth), H = 220, m = { l: 30, r: 6, t: 20, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(4, ...weeks.map((w) => w.submitted));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const y = (v) => m.t + ih - (v / top) * ih;
  const band = iw / weeks.length, bw = Math.min(24, band * 0.56);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Flags per week, stacked by review outcome' });
  for (let v = 0; v <= top; v += step) {
    s.append(svg('line', { class: v === 0 ? 'base' : 'grid', x1: m.l, x2: W - m.r, y1: y(v) + 0.5, y2: y(v) + 0.5 }));
    s.append(svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
  }
  const labelEvery = band < 34 ? 2 : 1;
  weeks.forEach((w, i) => {
    const cx = m.l + band * i + band / 2, x0 = cx - bw / 2;
    const g = svg('g', { class: 'col', tabindex: '0', 'aria-label': `Week of ${weekRange(w.week)}: ${w.submitted} flags, ${w.valid} passed review, ${w.rejected} rejected, ${w.pending} not reviewed` });
    g.append(svg('rect', { class: 'hit', x: m.l + band * i + 1, y: m.t - 14, width: band - 2, height: ih + 14, rx: 4 }));
    if (w.submitted > 0) {
      // the column's outline: 4px rounded data-end, square at the baseline; segments are clipped to it
      const h = y(0) - y(w.submitted), r = Math.min(4, h / 2), yt = y(w.submitted), id = `clip-${w.week}`;
      s.append(svg('clipPath', { id }, svg('path', {
        d: `M${x0},${y(0)} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + bw - r} Q${x0 + bw},${yt} ${x0 + bw},${yt + r} V${y(0)} Z`,
      })));
      const segs = svg('g', { 'clip-path': `url(#${id})` });
      let acc = 0;
      SERIES.forEach((ser, k) => {
        const v = w[ser.key];
        if (!v) return;
        const yTop = y(acc + v), yBot = y(acc) - (acc > 0 ? 2 : 0);    // 2px surface gap between stacked segments
        if (yBot - yTop > 0.5) segs.append(svg('rect', { x: x0, y: yTop, width: bw, height: yBot - yTop, fill: ser.color }));
        acc += v;
      });
      g.append(segs);
      g.append(svg('text', { class: 'cap', x: cx, y: yt - 6, 'text-anchor': 'middle' }, w.submitted));
    }
    if (i % labelEvery === (weeks.length - 1) % labelEvery) g.append(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, md(weekStart(w.week))));
    const showTip = () => {
      tip.replaceChildren(el('h4', {}, `Week of ${weekRange(w.week)}`),
        ...SERIES.map((ser) => el('div', { className: 'r', style: `--c:${ser.color}` }, el('i'), el('span', {}, ser.label), el('b', {}, w[ser.key]))),
        el('div', { className: 'tot' }, `${w.submitted} submitted · ${w.wrong_info} wrong info · ${w.glitch} glitch · ${w.other} other`));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, cx - tw / 2), W - tw)}px`;
      tip.style.top = `${Math.max(0, y(w.submitted) - tip.offsetHeight - 14)}px`;
    };
    g.addEventListener('pointerenter', showTip);
    g.addEventListener('focus', showTip);
    g.addEventListener('pointerleave', () => { tip.hidden = true; });
    g.addEventListener('blur', () => { tip.hidden = true; });
    s.append(g);
  });
  host.querySelector('svg')?.remove();
  host.querySelector('.ad-empty-chart')?.remove();
  host.prepend(s);
  if (!weeks.some((w) => w.submitted)) host.append(el('div', { className: 'ad-empty-chart' }, 'No flags yet — the chart fills in as reports arrive.'));
}
function tallyTable(tally, decisions) {
  const cols = ['Submitted', 'Wrong info', 'Glitch', 'Other', 'Passed review', 'Rejected', 'Awaiting you', 'Accepted', 'Implemented', 'Declined'];
  return el('table', { className: 'ad-table' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Week'), cols.map((c) => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, tally.map((t, i) => {
      const d = decisions[t.week] || {};
      return el('tr', { className: i === 0 ? 'now' : '' }, el('td', {}, `${weekRange(t.week)}${i === 0 ? ' (this week)' : ''}`),
        [t.submitted, t.wrong_info, t.glitch, t.other, t.valid, t.rejected, d.awaiting || 0, d.accepted || 0, d.implemented || 0, d.declined || 0].map((v) => el('td', {}, v)));
    })));
}

// --------------------------------------------------------- weekly reports ---
function reportsCard(reports) {
  const btn = el('button', { className: 'btn', type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Writing…';
    try { await api('GET', null, '/api/cron/weekly-tally'); await load(); } catch (e) { btn.disabled = false; btn.textContent = e.message; }
  } }, 'Write last week’s report now');
  return el('section', { className: 'ad-card' },
    el('div', { className: 'ad-row', style: 'justify-content:space-between' }, el('h2', {}, 'Weekly reports'), btn),
    el('p', { className: 'ad-sub' }, 'Every Monday a scheduled job freezes the previous week’s tally here, so you can see how each week went.'),
    reports.length
      ? el('div', { className: 'ad-reports' }, reports.map((r) => el('div', { className: 'ad-report' },
        el('b', {}, `${weekRange(r.week)}`),
        el('span', {}, `${r.submitted} flag${r.submitted === 1 ? '' : 's'}`),
        el('span', {}, `${r.wrong_info} wrong info · ${r.glitch} glitch · ${r.other} other`),
        el('span', {}, `${r.valid} passed review · ${r.rejected} rejected`),
        el('span', {}, `${r.awaiting} awaiting · ${r.accepted} accepted · ${r.implemented} implemented · ${r.declined} declined`),
        r.highPriority ? el('span', {}, `${r.highPriority} high priority still open`) : '')))
      : el('p', { className: 'ad-none' }, 'No weekly reports yet. The first one is written next Monday (or use the button).'));
}

// ------------------------------------------------------------- flag list ---
function listCard(flags) {
  const counts = Object.fromEntries(TABS.map((t) => [t.id, flags.filter(t.match).length]));
  const cur = TABS.find((t) => t.id === tab) || TABS[0];
  let list = flags.filter(cur.match).filter((f) => !cat || f.category === cat);
  if (cur.id === 'decide') list = list.sort((a, b) => (PRIO[a.review?.priority] ?? 3) - (PRIO[b.review?.priority] ?? 3) || b.createdAt.localeCompare(a.createdAt));
  const stuck = flags.filter((f) => f.status === 'review_failed' || (f.status === 'reviewing' && Date.now() - new Date(f.createdAt) > 120000));
  const reviewAll = stuck.length ? el('button', { className: 'btn', type: 'button', onclick: async () => {
    reviewAll.disabled = true;
    for (let i = 0; i < stuck.length; i++) {
      reviewAll.textContent = `Reviewing ${i + 1} of ${stuck.length}…`;
      try { const { flag } = await api('POST', { id: stuck[i].id, action: 'review' }); replace(flag); } catch { /* keep going */ }
    }
    render();
  } }, `Run the reviewer on ${stuck.length} unreviewed`) : '';

  return el('section', { className: 'ad-card', 'aria-labelledby': 'listTitle' },
    el('h2', { id: 'listTitle' }, 'Flags'),
    el('p', { className: 'ad-sub' }, 'Only flags the reviewer agent judged valid reach “To decide”. Accept the ones you plan to implement, mark them implemented when they ship, or decline them.'),
    el('div', { className: 'ad-tabs', role: 'tablist' }, TABS.map((t) => el('button', {
      className: 'ad-tab', role: 'tab', type: 'button', 'aria-selected': String(t.id === cur.id), onclick: () => { tab = t.id; render(); },
    }, t.label, el('small', {}, counts[t.id])))),
    el('div', { className: 'ad-filters' },
      el('label', {}, el('span', { className: 'sr' }, 'Category'), el('select', { onchange: (e) => { cat = e.target.value; render(); } },
        el('option', { value: '' }, 'All categories'),
        Object.entries(CAT).map(([id, c]) => { const o = el('option', { value: id }, c.label); o.selected = id === cat; return o; }))),
      reviewAll),
    list.length ? el('div', { className: 'ad-flags' }, list.map(flagCard))
      : el('p', { className: 'ad-none' }, cur.id === 'decide' ? 'Nothing waiting for you. 🎉' : 'Nothing here.'));
}

function replace(flag) {
  const i = data.flags.findIndex((f) => f.id === flag.id);
  if (i >= 0) data.flags[i] = flag;
}

function flagCard(f) {
  const c = CAT[f.category] || CAT.other;
  const r = f.review;
  const note = el('input', { className: 'ad-note', type: 'text', maxlength: '1000', placeholder: 'Decision note (optional)', value: f.decisionNote || '', 'aria-label': 'Decision note' });
  const card = el('article', { className: 'ad-flag', 'aria-label': `${c.label} flag` });
  const act = (action, label, cls = 'btn') => el('button', { className: cls, type: 'button', onclick: () => run(card, f, action, note.value) }, label);
  const del = el('button', { className: 'btn danger', type: 'button', onclick: () => {
    if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.textContent = 'Click again to delete'; setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 3500); return; }
    run(card, f, 'delete');
  } }, 'Delete');
  const actions = {
    open: [act('accept', 'Accept — will implement', 'btn primary'), act('decline', 'Decline'), act('review', 'Review again')],
    review_failed: [act('accept', 'Accept — will implement', 'btn primary'), act('decline', 'Decline'), act('review', 'Run the reviewer')],
    reviewing: [act('review', 'Run the reviewer')],
    accepted: [act('implemented', 'Mark implemented', 'btn primary'), act('reopen', 'Back to “To decide”')],
    implemented: [act('reopen', 'Back to “To decide”')],
    declined: [act('reopen', 'Reopen')],
    rejected: [act('restore', 'Restore — it is valid', 'btn primary'), act('review', 'Review again')],
  }[f.status] || [];

  const page = f.page || {};
  card.append(
    el('div', { className: 'ad-meta' },
      el('span', { className: 'ad-badge', html: c.icon }, c.label),
      r?.priority ? el('span', { className: `ad-badge prio-${r.priority}` }, `${r.priority[0].toUpperCase()}${r.priority.slice(1)} priority`) : '',
      el('span', { className: 'ad-badge status' }, STATUS[f.status] || f.status),
      f.structure ? el('span', {}, `About: ${f.structure.name}${f.structure.side ? ` (${f.structure.side === 'l' ? 'left' : 'right'})` : ''} · ${f.structure.system}`) : '',
      el('span', { title: fmtDate(f.createdAt) }, ago(f.createdAt))),
    el('blockquote', { className: 'ad-quote' }, f.message),
    r ? el('div', { className: 'ad-review' },
      el('div', { className: 'head' }, el('span', { className: `verdict ${r.verdict}` }, r.verdict === 'valid' ? 'Reviewer: valid' : 'Reviewer: not valid'),
        el('b', {}, r.summary), el('span', { className: 'ad-sub', style: 'margin:0' }, `${r.confidence} confidence`)),
      el('p', {}, r.reasoning),
      r.suggested_fix ? el('div', { className: 'ad-fix' }, el('b', {}, 'Suggested fix'), r.suggested_fix) : '')
      : el('p', { className: 'ad-failed' }, f.reviewError ? `Review did not run: ${f.reviewError}` : 'The reviewer agent is checking this flag…'),
    f.decidedAt ? el('p', { className: 'ad-decided' }, `${STATUS[f.status]} ${fmtDate(f.decidedAt)}${f.decisionNote ? ` — “${f.decisionNote}”` : ''}`) : '',
    el('details', {}, el('summary', {}, 'Details'),
      el('dl', {},
        page.hash ? [el('dt', {}, 'Atlas view'), el('dd', {}, el('a', { href: `./${page.hash}`, target: '_blank', rel: 'noopener', style: 'color:var(--accent)' }, 'Open what they were looking at'))] : '',
        page.mode ? [el('dt', {}, 'Open panel'), el('dd', {}, page.mode)] : '',
        page.ua ? [el('dt', {}, 'Browser'), el('dd', {}, page.ua)] : '',
        page.viewport ? [el('dt', {}, 'Screen'), el('dd', {}, page.viewport)] : '',
        page.gpu ? [el('dt', {}, 'GPU'), el('dd', {}, page.gpu)] : '',
        page.errors?.length ? [el('dt', {}, 'Page errors'), el('dd', {}, page.errors.join('\n'))] : '',
        [el('dt', {}, 'Week'), el('dd', {}, `${weekRange(f.week)} (${f.week})`)],
        r ? [el('dt', {}, 'Reviewed by'), el('dd', {}, `${r.model}, ${fmtDate(r.reviewedAt)}`)] : '',
        [el('dt', {}, 'Reporter'), el('dd', {}, `anonymous #${(f.reporter || '').slice(0, 6) || '—'}`)],
        [el('dt', {}, 'Flag id'), el('dd', {}, f.id)])),
    el('div', { className: 'ad-actions' }, actions, f.status !== 'reviewing' ? note : '', del));
  return card;
}

async function run(card, f, action, note) {
  card.classList.add('busy');
  try {
    const res = await api('POST', { id: f.id, action, note });
    if (res.deleted) data.flags = data.flags.filter((x) => x.id !== f.id);
    else replace(res.flag);
    render();
  } catch (e) {
    card.classList.remove('busy');
    if (e.auth) { saveToken(''); login(e.message); return; }
    card.append(el('p', { className: 'ad-err', role: 'alert' }, e.message));
  }
}

load();
