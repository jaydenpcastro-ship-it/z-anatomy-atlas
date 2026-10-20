// What the atlas itself says about a structure or lesson step, read from web/data so the flag reviewer can check
// a report against the real content (vercel.json ships data/** with the functions that need it).
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const SYSTEMS = new Set(['skeletal', 'joints', 'insertions', 'muscular', 'fascia', 'cardiovascular', 'lymphoid', 'nervous', 'visceral', 'regions', 'reference']);
const MAX_DESC = 6000;

const cache = new Map();
function load(rel) {
  if (!cache.has(rel)) {
    try { cache.set(rel, JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'))); } catch { cache.set(rel, null); }
  }
  return cache.get(rel);
}

// Description text as the info panel shows it: drop the all-caps title line and wiki heading markup.
function cleanDesc(text, name) {
  if (!text) return '';
  const out = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .filter((b) => b.toLowerCase() !== String(name).toLowerCase() && !(/^[A-Z0-9 ,()'’\-/&]+$/.test(b) && b.length < 70))
    .map((b) => b.replace(/^={2,3}\s*(.+?)\s*={2,3}$/, '[$1]'))
    .join('\n');
  return out.length > MAX_DESC ? `${out.slice(0, MAX_DESC)} …[truncated]` : out;
}

// { name, system, description, muscleFacts, supply, keyFacts } — fields are null when the atlas has none.
function structureFacts(structure) {
  if (!structure || typeof structure.name !== 'string' || !SYSTEMS.has(structure.system)) return null;
  const { name, system } = structure;
  const desc = load(`desc/${system}.json`) || {};
  const rel = load('relations.json') || {};
  const muscles = load('muscles.json') || {};
  const keyFacts = (rel.nerves || {})[name] || (rel.vessels || {})[name] || (rel.bones || {})[name] || null;
  return {
    name,
    system,
    description: cleanDesc(desc[name], name) || null,
    muscleFacts: muscles[name] || null,
    supply: (rel.muscles || {})[name] || null,
    keyFacts,
  };
}

// The lesson step a page was showing, from its link state ("lesson=knee.3", steps counted from 1), or null.
function lessonStep(hash) {
  const m = /(?:^|[#&])lesson=([a-z0-9-]+)\.(\d+)/i.exec(String(hash || ''));
  if (!m) return null;
  const lesson = ((load('lessons.json') || {}).lessons || []).find((l) => l.id === m[1]);
  const n = Math.max(1, Number(m[2]));
  const step = lesson && lesson.steps[n - 1];
  return step ? { lesson: lesson.title, step: n, of: lesson.steps.length, title: step.title, text: step.text } : null;
}

// The atlas record for a reported structure, or null when the page sent a name the atlas doesn't have.
let known;
function findStructure(system, name) {
  if (!known) {
    known = new Map();
    for (const r of (load('manifest.json') || {}).structures || []) known.set(`${r.system}|${r.name}`, r);
  }
  return known.get(`${system}|${name}`) || null;
}

module.exports = { structureFacts, lessonStep, findStructure, SYSTEMS };
