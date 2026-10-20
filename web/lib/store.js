// Small Redis client for the flag list, weekly tallies and rate limits.
//
// On Vercel it talks to Upstash Redis over its REST API (Vercel dashboard → Storage → Upstash for Redis, free
// tier). The integration adds KV_REST_API_URL + KV_REST_API_TOKEN; plain Upstash names
// (UPSTASH_REDIS_REST_URL / _TOKEN) work too. Off Vercel with neither set (local dev), an in-memory stand-in is
// used so the whole site runs end to end; its data is lost when the process exits.
//
// Every command is a Redis command array, e.g. cmd('HINCRBY', key, field, 1); pipe([...]) sends several in one
// round trip and returns their results in order.

function upstash(url, token) {
  const call = async (path, body) => {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`redis ${res.status}: ${data && data.error ? data.error : 'request failed'}`);
    return data;
  };
  return {
    kind: 'upstash',
    async cmd(...args) {
      const data = await call('', args.map(String));
      if (data.error) throw new Error(`redis: ${data.error}`);
      return data.result;
    },
    async pipe(cmds) {
      if (!cmds.length) return [];
      const data = await call('/pipeline', cmds.map((c) => c.map(String)));
      return data.map((d) => { if (d.error) throw new Error(`redis: ${d.error}`); return d.result; });
    },
  };
}

// In-memory stand-in covering only the commands this site uses. Values come back as strings, like Redis.
function memory() {
  const kv = new Map(), exp = new Map();
  const alive = (k) => { const t = exp.get(k); if (t && t <= Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
  const get = (k, make) => { if (!alive(k) && make) kv.set(k, make()); return kv.get(k); };
  const run = (name, ...a) => {
    const k = a[0];
    switch (name.toUpperCase()) {
      case 'GET': return alive(k) ? kv.get(k) : null;
      case 'MGET': return a.map((x) => (alive(x) ? kv.get(x) : null));
      case 'SET': {
        const opts = a.slice(2).map((x) => String(x).toUpperCase());
        if (opts.includes('NX') && alive(k)) return null;
        kv.set(k, String(a[1])); exp.delete(k);
        const ex = opts.indexOf('EX'); if (ex >= 0) exp.set(k, Date.now() + Number(a[2 + ex + 1]) * 1000);
        return 'OK';
      }
      case 'DEL': return a.reduce((n, x) => n + (kv.delete(x) ? 1 : 0), 0);
      case 'INCR': case 'INCRBY': {
        const v = Number(alive(k) ? kv.get(k) : 0) + (name.toUpperCase() === 'INCR' ? 1 : Number(a[1]));
        kv.set(k, String(v)); return v;
      }
      case 'EXPIRE': if (!alive(k)) return 0; exp.set(k, Date.now() + Number(a[1]) * 1000); return 1;
      case 'HINCRBY': { const h = get(k, () => new Map()); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); return v; }
      case 'HGETALL': { const h = alive(k) ? kv.get(k) : null; return h ? [...h].flat() : []; }
      case 'ZADD': { const z = get(k, () => new Map()); const had = z.has(a[2]); z.set(a[2], Number(a[1])); return had ? 0 : 1; }
      case 'ZREM': { const z = alive(k) ? kv.get(k) : null; return z && z.delete(a[1]) ? 1 : 0; }
      case 'ZCARD': return alive(k) ? kv.get(k).size : 0;
      case 'ZREVRANGE': {
        const z = alive(k) ? kv.get(k) : null; if (!z) return [];
        const sorted = [...z].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
        const stop = Number(a[2]); return sorted.slice(Number(a[1]), stop < 0 ? sorted.length + stop + 1 : stop + 1);
      }
      default: throw new Error(`memory store: ${name} not supported`);
    }
  };
  return {
    kind: 'memory',
    async cmd(...args) { return run(...args.map(String)); },
    async pipe(cmds) { return cmds.map((c) => run(...c.map(String))); },
  };
}

let cached;
// Returns null when no store is configured on Vercel (callers answer 503 with a setup hint).
function getStore() {
  if (cached !== undefined) return cached;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) cached = upstash(url, token);
  else cached = process.env.VERCEL ? null : memory();
  return cached;
}

// Rate limits must never be skipped: without Redis they fall back to counters in this process, which still
// catch a burst from one visitor on a warm instance.
let local;
const limiterStore = () => getStore() || local || (local = memory());

// HGETALL replies come back as a flat [field, value, field, value, ...] list.
const hashOf = (flat) => {
  const out = {};
  for (let i = 0; flat && i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]);
  return out;
};

module.exports = { getStore, limiterStore, hashOf };
