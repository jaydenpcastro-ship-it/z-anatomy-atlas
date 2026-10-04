// Knowledge module: how structures relate (nerve and blood supply, branches, articulations), key-facts cards with clinical
// notes, and a data-derived summary for structures that have no written description. Built only on window.atlas.
//
// Data: data/relations.json (built by tools/build_relations.py). Names in it are structure names; a name that exists in the
// model renders as a link chip (click = select it), anything else as plain text.
const atlas = window.atlas;
await (atlas?.ready ?? Promise.reject(new Error('atlas API missing')));

const { S, el } = atlas;
const REL = await fetch(`${atlas.CFG.dataBase}relations.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
for (const k of ['muscles', 'nerves', 'vessels', 'bones']) REL[k] ||= {};

const byName = new Map();
for (const r of S.M.structures) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }
// every record of a name, preferring the given side (midline structures have no side and always match)
const recsOf = (name, side) => {
  const all = byName.get(name) || [];
  const same = side ? all.filter((r) => !r.side || r.side === side) : all;
  return same.length ? same : all;
};
const label = (name) => { const r = byName.get(name)?.[0]; return r ? atlas.nameOf(r) : name; };
const kindOf = (rec) => (REL.nerves[rec.name] && rec.system === 'nervous' ? 'nerve'
  : REL.vessels[rec.name] && rec.system === 'cardiovascular' ? 'vessel'
    : REL.bones[rec.name] && rec.system === 'skeletal' ? 'bone' : null);

// ------------------------------------------------------------- highlight ---
// Highlights a set of structures on the model (ghosting the rest) without changing the structure shown in the info panel.
async function highlight(recs, msg) {
  recs = recs.filter(Boolean);
  if (!recs.length) return;
  const systems = [...new Set(recs.map((r) => r.system))];
  await Promise.all(systems.map((k) => (S.sys.get(k)?.visible ? atlas.loadSystem(k) : atlas.setSystemVisible(k, true))));
  S.sel = new Set(recs.map((r) => r.id)); S.ghost = true;
  atlas.restyle(); atlas.focusRecs(recs);
  if (msg) atlas.notify(msg);
}
const unitOf = (rec) => (atlas.isMuscle(rec) ? atlas.wholeOf(rec).filter((r) => !r.side || !rec.side || r.side === rec.side) : atlas.siblingsOf(rec));
const many = (names, side) => (names || []).flatMap((n) => recsOf(n, side));

// ---------------------------------------------------------------- pieces ---
function link(name, side) {
  const recs = recsOf(name, side);
  if (!recs.length) return el('span', { className: 'kchip plain', title: 'Not modelled in this atlas' }, name);
  return el('button', { type: 'button', className: 'kchip', title: `Select ${label(name)}`, onclick: () => atlas.selectRec(recs[0]) }, label(name));
}
const links = (names, side) => el('div', { className: 'kchips' }, (names || []).map((n) => link(n, side)));
function factRows(rows) {
  const dl = el('dl', { className: 'facts kfacts' });
  for (const [badge, name, value] of rows) {
    if (value == null || (Array.isArray(value) && !value.length) || value === '') continue;
    dl.append(el('div', { className: 'frow' }, el('dt', {}, el('b', {}, badge), name), el('dd', {}, typeof value === 'string' ? value : value)));
  }
  return dl;
}
const clinical = (text) => text && el('aside', { className: 'kclin', 'aria-label': 'Clinical relevance' },
  el('h4', {}, 'Clinical relevance'), el('p', {}, text), el('p', { className: 'fine' }, 'Educational information, not medical advice.'));
const traceBtn = (text, fn, primary) => el('button', { type: 'button', className: `btn${primary ? ' primary' : ''}`, onclick: fn }, text);
const source = () => el('p', { className: 'fine' }, 'Key facts: Z-Anatomy Atlas, from standard anatomy references (Gray\'s, Moore, Netter). Report errors via the project repository.');

// ------------------------------------------------------- muscle: supply ---
// Added to the muscle Facts card (after origin / insertion / action / nerve).
function muscleSupply(sib, host) {
  const rec = sib[0], m = REL.muscles[rec.name];
  if (!m) return;
  const side = rec.side;
  const box = el('div', { className: 'ksupply' });
  box.append(factRows([['N', 'Nerve supply', m.nerves?.length ? links(m.nerves, side) : null], ['A', 'Blood supply', m.arteries?.length ? links(m.arteries, side) : null]]));
  const btns = el('div', { className: 'actions ktrace' });
  const nerveRecs = many(m.nerves, side), artRecs = many(m.arteries, side);
  if (nerveRecs.length) btns.append(traceBtn('Show nerve supply', () => highlight([...unitOf(rec), ...nerveRecs], `${atlas.nameOf(rec)} and its nerve supply`)));
  if (artRecs.length) btns.append(traceBtn('Show blood supply', () => highlight([...unitOf(rec), ...artRecs], `${atlas.nameOf(rec)} and its arteries`)));
  if (btns.childElementCount) box.append(btns);
  host.append(box);
}

// --------------------------------------------------------- key facts tab ---
function renderKey(sib, host) {
  const rec = sib[0], side = rec.side, kind = kindOf(rec);
  if (kind === 'nerve') {
    const f = REL.nerves[rec.name];
    host.append(factRows([
      ['R', 'Roots', f.roots], ['F', 'From', f.from ? links(f.from.split(/ and (?=[A-Z])/), side) : null],
      ['C', 'Course', f.course], ['B', 'Branches', f.branches?.length ? links(f.branches, side) : null],
      ['M', 'Muscles supplied', f.muscles?.length ? links(f.muscles, side) : null], ['S', 'Sensory', f.sensory],
    ]));
    const btns = el('div', { className: 'actions ktrace' });
    if (f.muscles?.length) btns.append(traceBtn('Show nerve and its muscles', () => highlight([...atlas.siblingsOf(rec).filter((r) => !side || r.side === side), ...many(f.muscles, side)], `${atlas.nameOf(rec)} and the muscles it supplies`), true));
    if (f.branches?.length) btns.append(traceBtn('Show branches', () => highlight([...atlas.siblingsOf(rec).filter((r) => !side || r.side === side), ...many(f.branches, side)], `Branches of the ${atlas.nameOf(rec).toLowerCase()}`)));
    if (btns.childElementCount) host.append(btns);
    host.append(clinical(f.clinical) || '');
  } else if (kind === 'vessel') {
    const f = REL.vessels[rec.name];
    host.append(factRows([
      ['F', 'From', f.from ? links([f.from], side) : null], ['B', f.into ? 'Tributaries' : 'Branches', f.branches?.length ? links(f.branches, side) : null],
      ['S', 'Supplies', f.supplies], ['D', 'Drains', f.drains], ['I', 'Drains into', f.into ? links([f.into], side) : null],
      ['M', 'Muscles supplied', f.muscles?.length ? links(f.muscles, side) : null],
    ]));
    const btns = el('div', { className: 'actions ktrace' });
    const self = atlas.siblingsOf(rec).filter((r) => !side || r.side === side);
    const tree = [...self, ...many(f.branches, side), ...(f.from ? recsOf(f.from, side) : []), ...(f.into ? recsOf(f.into, side) : [])];
    if (tree.length > self.length) btns.append(traceBtn(f.into ? 'Trace drainage' : 'Trace branches', () => highlight(tree, `${atlas.nameOf(rec)}: ${f.into ? 'tributaries and drainage' : 'origin and branches'}`), true));
    if (f.muscles?.length) btns.append(traceBtn('Show muscles supplied', () => highlight([...self, ...many(f.muscles, side)], `Muscles supplied by the ${atlas.nameOf(rec).toLowerCase()}`)));
    if (btns.childElementCount) host.append(btns);
    host.append(clinical(f.clinical) || '');
  } else if (kind === 'bone') {
    const f = REL.bones[rec.name];
    host.append(factRows([['T', 'Type', f.type], ['J', 'Articulates with', f.articulates?.length ? links(f.articulates, side) : 'None (held by muscles and ligaments)'], ['K', 'Key features', f.features]]));
    if (f.articulates?.length) host.append(el('div', { className: 'actions ktrace' }, traceBtn('Show articulating bones', () => highlight([...atlas.siblingsOf(rec).filter((r) => !side || r.side === side), ...many(f.articulates, side)], `${atlas.nameOf(rec)} and the bones it articulates with`), true)));
    host.append(clinical(f.clinical) || '');
  }
  host.append(source());
}
atlas.registerTab({ id: 'key', label: 'Key facts', order: 5, applies: (sib) => !!kindOf(sib[0]), render: renderKey });

// --------------------------------------------- data-derived summary -------
// For structures with no written description: only facts the atlas itself holds (name, hierarchy, translations, links).
function describe(rec) {
  const box = el('div', { className: 'ksummary' });
  const path = []; let g = S.groups.get(rec.group);
  while (g) { path.unshift(g.name); g = S.groups.get(g.parent); }
  const facts = [];
  const latin = atlas.latinOf(rec);
  if (latin && latin.toLowerCase() !== rec.name.toLowerCase()) facts.push(['L', 'Latin', latin]);
  facts.push(['P', 'Part of', [atlas.SYS[rec.system]?.[0] || rec.system, ...path].join(' › ')]);
  if (rec.side) facts.push(['S', 'Side', 'Paired: present on the left and the right']);
  const m = rec.name.replace(/^\(|\)$/g, '').match(/^(?:.+? )?(?:branch(?:es)?|tributar(?:y|ies)) (?:of|to) (?:the )?(.+)$/i);
  if (m) {
    const parent = [...byName.keys()].find((n) => n.toLowerCase() === m[1].toLowerCase());
    facts.push(['B', 'Branch of', parent ? links([parent], rec.side) : m[1]]);
  }
  const sup = REL.vessels[rec.name]?.muscles || REL.nerves[rec.name]?.muscles;
  if (sup?.length) facts.push(['M', 'Muscles supplied', links(sup, rec.side)]);
  box.append(factRows(facts));
  if (rec.name.startsWith('(')) box.append(el('p', { className: 'fine' }, 'Names in brackets mark inconstant or minor structures in Z-Anatomy.'));
  box.append(el('p', { className: 'fine' }, 'No written description yet. This summary is generated from the atlas\'s own data (name, hierarchy and translations).'));
  return box;
}
atlas.describe = describe;
atlas.registerFactsExtra?.(muscleSupply);
atlas.relations = REL;
document.dispatchEvent(new CustomEvent('atlas:knowledge-ready'));
if (S.cur) atlas.showInfo(atlas.siblingsOf(S.cur));
