// Helpers shared by the api/ functions: JSON bodies, caller identity for rate limits, ISO weeks, owner auth.
const crypto = require('crypto');

const json = (res, status, body) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
};

// Vercel parses JSON bodies into req.body; accept a raw string too.
function body(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch { return null; } }
  return null;
}

// A salted hash of the caller's IP: enough to rate-limit, without storing the address itself.
function caller(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const salt = process.env.VTL_HASH_SALT || process.env.ADMIN_TOKEN || 'vtl';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16);
}

// Fixed-window counter: true while `key` has been hit at most `limit` times in the current window.
async function underLimit(store, key, limit, windowSec) {
  const [, n] = await store.pipe([['SET', key, '0', 'EX', windowSec, 'NX'], ['INCR', key]]);
  return Number(n) <= limit;
}

// ISO-8601 week of a date, e.g. "2026-W43". Weeks run Monday–Sunday (UTC).
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);                  // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
// The Monday (UTC) that starts an ISO week key.
function weekStart(key) {
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  return monday;
}
// The `n` most recent week keys, newest first.
function recentWeeks(n, from = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(isoWeek(new Date(from.getTime() - i * 7 * 86400000)));
  return out;
}

// Owner endpoints: `Authorization: Bearer <ADMIN_TOKEN>`. Returns an error message, or null when allowed.
function ownerError(req, token = process.env.ADMIN_TOKEN) {
  if (!token) return 'ADMIN_TOKEN is not configured on the server.';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : 'Wrong owner token.';
}

const clean = (s, max) => String(s == null ? '' : s).replace(/\u0000/g, '').trim().slice(0, max);

module.exports = { json, body, caller, underLimit, isoWeek, weekStart, recentWeeks, ownerError, clean };
