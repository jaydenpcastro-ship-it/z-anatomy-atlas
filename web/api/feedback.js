// Vercel serverless function: visitors flag wrong information, glitches, or request changes/additions.
//
// POST { category: "wrong_info" | "glitch" | "other", message, structure?: { name, system, side },
//        page?: { hash, mode, ua, viewport, gpu, errors[] }, website }      ("website" is a bot trap: leave empty)
// → 202 { ok: true, id }
//
// The flag is stored and counted in this week's tally at once; the reviewer agent (lib/review.js) then checks it
// in the background. Valid flags land on the owner's list in admin.html.
const { waitUntil } = require('@vercel/functions');
const { json, body, caller, underLimit, clean } = require('../lib/http');
const { getStore } = require('../lib/store');
const { CATEGORIES, createFlag } = require('../lib/flags');
const { reviewFlag } = require('../lib/review');
const { findStructure } = require('../lib/atlas-data');

const MAX_MESSAGE = 250;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
  const b = body(req);
  if (!b) { json(res, 400, { error: 'Expected a JSON body.' }); return; }
  if (clean(b.website, 200)) { json(res, 202, { ok: true }); return; }          // bot filled the hidden field

  const category = Object.hasOwn(CATEGORIES, b.category) ? b.category : null;
  const message = clean(b.message, MAX_MESSAGE + 1);
  if (!category) { json(res, 400, { error: 'Choose wrong information, glitch, or other.' }); return; }
  if (message.length < 3) { json(res, 400, { error: 'Please describe the issue in a few words.' }); return; }
  if (message.length > MAX_MESSAGE) { json(res, 400, { error: `Please keep it under ${MAX_MESSAGE} characters.` }); return; }

  const store = getStore();
  if (!store) { json(res, 503, { error: 'Reports are not switched on yet: the site owner needs to connect a database.' }); return; }

  const who = caller(req), day = new Date().toISOString().slice(0, 10);
  if (!(await underLimit(store, `vtl:rl:flag:hour:${who}`, 6, 3600) && await underLimit(store, `vtl:rl:flag:day:${who}:${day}`, 20, 86400))) {
    json(res, 429, { error: 'Thanks — you have sent a lot of reports today. Please try again later.' }); return;
  }

  let structure = null;
  if (b.structure && typeof b.structure === 'object') {
    const rec = findStructure(clean(b.structure.system, 40), clean(b.structure.name, 200));
    if (rec) structure = { name: rec.name, system: rec.system, side: ['l', 'r'].includes(b.structure.side) ? b.structure.side : '' };
  }
  const p = b.page && typeof b.page === 'object' ? b.page : {};
  const page = {
    hash: clean(p.hash, 600),
    mode: clean(p.mode, 60),
    ua: clean(p.ua || req.headers['user-agent'], 300),
    viewport: clean(p.viewport, 40),
    gpu: clean(p.gpu, 160),
    errors: (Array.isArray(p.errors) ? p.errors : []).slice(-8).map((e) => clean(e, 300)).filter(Boolean),
  };

  const flag = await createFlag(store, { category, message, structure, page, reporter: who });
  // Answer now; the review keeps running after the response (Vercel keeps the function alive for it).
  waitUntil(reviewFlag(store, flag.id).catch((err) => console.error('background review failed:', err.message)));
  json(res, 202, { ok: true, id: flag.id });
};
