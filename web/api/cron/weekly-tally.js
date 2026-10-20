// Vercel Cron (vercel.json, Mondays 13:00 UTC): freezes last week's flag tally into a weekly report that the
// owner's page lists. Vercel sends `Authorization: Bearer <CRON_SECRET>`; the owner can also run it by hand with
// the ADMIN_TOKEN, optionally for a specific week: /api/cron/weekly-tally?week=2026-W42
const { json, ownerError, isoWeek, weekStart } = require('../../lib/http');
const { getStore } = require('../../lib/store');
const { K, listFlags, tallies, decisionsByWeek } = require('../../lib/flags');

module.exports = async function handler(req, res) {
  const tokens = [process.env.CRON_SECRET, process.env.ADMIN_TOKEN].filter(Boolean);
  if (!tokens.length) { json(res, 503, { error: 'Set CRON_SECRET (or ADMIN_TOKEN) to enable the weekly tally.' }); return; }
  if (tokens.every((t) => ownerError(req, t))) { json(res, 401, { error: 'Not authorised.' }); return; }
  const store = getStore();
  if (!store) { json(res, 503, { error: 'No database is connected.' }); return; }

  // default: the most recent full week (the one that ended last Sunday)
  const asked = String((req.query && req.query.week) || '');
  const thisMonday = weekStart(isoWeek());
  const week = /^\d{4}-W\d{2}$/.test(asked) ? asked : isoWeek(new Date(thisMonday.getTime() - 86400000));
  const start = weekStart(week), end = new Date(start.getTime() + 6 * 86400000);

  const [tally] = await tallies(store, [week]);
  const flags = (await listFlags(store, 1000)).filter((f) => f.week === week);
  const decisions = decisionsByWeek(flags)[week] || { awaiting: 0, accepted: 0, declined: 0, implemented: 0, unreviewed: 0 };
  const report = {
    week,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    ...tally,
    ...decisions,
    highPriority: flags.filter((f) => f.status === 'open' && f.review && f.review.priority === 'high').length,
    generatedAt: new Date().toISOString(),
  };
  await store.pipe([
    ['SET', K.report(week), JSON.stringify(report)],
    ['ZADD', K.reports, start.getTime(), week],
  ]);
  json(res, 200, { report });
};
