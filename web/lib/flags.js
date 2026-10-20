// Flags (reports and change requests from visitors) and their weekly tally, stored in Redis (lib/store.js).
//
//   vtl:flag:<id>      one flag as JSON
//   vtl:flags          sorted set of flag ids by submission time
//   vtl:tally:<week>   hash per ISO week: submitted, wrong_info, glitch, other, valid, rejected
//   vtl:report:<week>  frozen weekly report written by the Monday cron (api/cron/weekly-tally.js)
//   vtl:reports        sorted set of report weeks
//
// A flag's status moves: reviewing → open (reviewer says valid) | rejected (reviewer says not valid)
// | review_failed (reviewer could not run); then the owner decides: accepted → implemented, or declined.
// The tally counts what came in, so deleting a flag later does not change past weeks.
const crypto = require('crypto');
const { isoWeek } = require('./http');
const { hashOf } = require('./store');

const CATEGORIES = { wrong_info: 'Wrong information', glitch: 'Glitch', other: 'Other' };
const DECISIONS = ['accepted', 'declined', 'implemented'];
const K = {
  flag: (id) => `vtl:flag:${id}`,
  index: 'vtl:flags',
  tally: (week) => `vtl:tally:${week}`,
  report: (week) => `vtl:report:${week}`,
  reports: 'vtl:reports',
};

const newId = () => `f${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function createFlag(store, fields) {
  const now = new Date();
  const flag = {
    id: newId(), createdAt: now.toISOString(), week: isoWeek(now), status: 'reviewing',
    review: null, reviewError: null, decisionNote: '', decidedAt: null, ...fields,
  };
  await store.pipe([
    ['SET', K.flag(flag.id), JSON.stringify(flag)],
    ['ZADD', K.index, now.getTime(), flag.id],
    ['HINCRBY', K.tally(flag.week), 'submitted', 1],
    ['HINCRBY', K.tally(flag.week), flag.category, 1],
  ]);
  return flag;
}

const getFlag = async (store, id) => parse(await store.cmd('GET', K.flag(id)));
const saveFlag = (store, flag) => store.cmd('SET', K.flag(flag.id), JSON.stringify(flag));
const deleteFlag = (store, id) => store.pipe([['DEL', K.flag(id)], ['ZREM', K.index, id]]);

// Newest first.
async function listFlags(store, limit = 500) {
  const ids = await store.cmd('ZREVRANGE', K.index, 0, limit - 1);
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const vals = await store.cmd('MGET', ...chunk.map(K.flag));
    for (const v of vals) { const f = parse(v); if (f) out.push(f); }
  }
  return out;
}

// Record the reviewer's verdict. Re-reviews move the week's valid/rejected count rather than adding to it, and
// never undo a decision the owner already made.
async function applyReview(store, flag, review) {
  const prev = flag.review && flag.review.verdict;
  const field = (v) => (v === 'valid' ? 'valid' : 'rejected');
  flag.review = review;
  flag.reviewError = null;
  if (!DECISIONS.includes(flag.status)) flag.status = review.verdict === 'valid' ? 'open' : 'rejected';
  const cmds = [['SET', K.flag(flag.id), JSON.stringify(flag)]];
  if (prev !== review.verdict) {
    if (prev) cmds.push(['HINCRBY', K.tally(flag.week), field(prev), -1]);
    cmds.push(['HINCRBY', K.tally(flag.week), field(review.verdict), 1]);
  }
  await store.pipe(cmds);
  return flag;
}

const ZERO = { submitted: 0, wrong_info: 0, glitch: 0, other: 0, valid: 0, rejected: 0 };
async function tallies(store, weeks) {
  const rows = await store.pipe(weeks.map((w) => ['HGETALL', K.tally(w)]));
  return weeks.map((week, i) => ({ week, ...ZERO, ...hashOf(rows[i]) }));
}

// Where that week's flags stand now: how many await a decision, were accepted, implemented or declined.
function decisionsByWeek(flags) {
  const out = {};
  for (const f of flags) {
    const d = out[f.week] || (out[f.week] = { awaiting: 0, accepted: 0, declined: 0, implemented: 0, unreviewed: 0 });
    if (f.status === 'open') d.awaiting++;
    else if (f.status === 'reviewing' || f.status === 'review_failed') d.unreviewed++;
    else if (DECISIONS.includes(f.status)) d[f.status]++;
  }
  return out;
}

module.exports = {
  CATEGORIES, DECISIONS, K, createFlag, getFlag, saveFlag, deleteFlag, listFlags, applyReview, tallies, decisionsByWeek,
};
