// Vercel serverless function behind the owner's review page (admin.html). Every request needs
// `Authorization: Bearer <ADMIN_TOKEN>`.
//
// GET  → { flags, tally, decisions, reports, setup }      flags newest first; tally = last 12 ISO weeks
// POST { id, action, note? } → { flag }   action: accept | decline | implemented | reopen | restore | review | delete
const { json, body, ownerError, recentWeeks, clean } = require('../lib/http');
const { getStore } = require('../lib/store');
const { K, getFlag, saveFlag, deleteFlag, listFlags, tallies, decisionsByWeek } = require('../lib/flags');
const { reviewFlag } = require('../lib/review');
const { configured, tutor, reviewer } = require('../lib/claude');

const STATUS_FOR = { accept: 'accepted', decline: 'declined', implemented: 'implemented', reopen: 'open', restore: 'open' };

module.exports = async function handler(req, res) {
  const denied = ownerError(req);
  if (denied) { json(res, 401, { error: denied }); return; }
  const store = getStore();
  if (!store) { json(res, 503, { error: 'No database is connected. Add Upstash for Redis in the Vercel dashboard (Storage tab).' }); return; }

  if (req.method === 'GET') {
    const flags = await listFlags(store, 1000);
    const reportWeeks = await store.cmd('ZREVRANGE', K.reports, 0, 25);
    const reports = reportWeeks.length ? (await store.cmd('MGET', ...reportWeeks.map(K.report))).map((r) => JSON.parse(r)).filter(Boolean) : [];
    json(res, 200, {
      flags,
      tally: await tallies(store, recentWeeks(12)),
      decisions: decisionsByWeek(flags),
      reports,
      setup: { store: store.kind, reviewer: configured(), reviewerModel: reviewer().model, tutorModel: tutor().model },
    });
    return;
  }

  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
  const b = body(req) || {};
  const id = clean(b.id, 40), action = clean(b.action, 20);
  const flag = id && await getFlag(store, id);
  if (!flag) { json(res, 404, { error: 'No flag with that id.' }); return; }

  if (action === 'delete') { await deleteFlag(store, id); json(res, 200, { deleted: id }); return; }
  if (action === 'review') { json(res, 200, { flag: await reviewFlag(store, id) }); return; }
  if (!STATUS_FOR[action]) { json(res, 400, { error: `Unknown action "${action}".` }); return; }

  flag.status = STATUS_FOR[action];
  flag.decidedAt = action === 'reopen' || action === 'restore' ? null : new Date().toISOString();
  if (typeof b.note === 'string') flag.decisionNote = clean(b.note, 1000);
  if (action === 'restore') flag.restoredByOwner = true;
  await saveFlag(store, flag);
  json(res, 200, { flag });
};
