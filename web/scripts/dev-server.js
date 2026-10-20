// Local stand-in for Vercel: serves web/ with clean URLs and runs the api/*.js functions with Vercel's
// req.body / req.query / res.status().json() helpers, so the tutor, flags and owner page work offline.
//
//   node scripts/dev-server.js [--port 8770] [--mock-claude]
//
// Reads web/.env.local. Without Upstash variables the flag store is in memory (lost on exit). ADMIN_TOKEN
// defaults to "dev-admin". --mock-claude points the Anthropic SDK at a fake endpoint on this server that answers
// with canned text, so nothing is billed; GET /__mock/requests lists what the SDK sent it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 8770;
const MOCK = argv.includes('--mock-claude');

for (const line of (fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8') : '').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
process.env.ADMIN_TOKEN ||= 'dev-admin';
if (MOCK) {
  process.env.ANTHROPIC_API_KEY = 'mock-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}/__mock/anthropic`;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';                                     // cleanUrls: /admin -> admin.html
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || /^(api|lib|scripts|node_modules)[\\/]|^\.env/.test(rel)) { res.writeHead(404).end('Not found'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if (/json/.test(req.headers['content-type'] || '')) { try { return JSON.parse(raw); } catch { return raw; } }
  return raw;
}

async function runApi(req, res, url) {
  const file = path.join(ROOT, `${url.pathname.replace(/\/$/, '')}.js`);
  if (!file.startsWith(path.join(ROOT, 'api') + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end('No such function'); return; }
  req.query = Object.fromEntries(url.searchParams);
  req.body = await readBody(req);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.send = (data) => { res.end(data); return res; };
  try {
    await require(file)(req, res);
  } catch (err) {
    console.error(`[api] ${url.pathname} threw:`, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Function crashed' }));
    else res.end();
  }
}

// ------------------------------------------------------------------------------------- fake Claude API --
const mockLog = [];
const CHAT_REPLY = [
  'Here is the short version. The **femur** is the longest and strongest bone in the body.\n\n',
  '### Key points\n',
  '- Its head sits in the acetabulum of the [[Hip bone]], forming the hip joint.\n',
  '- Distally it meets the [[Tibia]] and the [[Patella]] at the knee.\n',
  '- The [[Quadriceps femoris muscle]] wraps its front; the [[Sciatic nerve]] runs behind it.\n',
  '- The [[Heart]] is nowhere near it, and *Imaginary structure* tests plain text: [[Not a real structure]].\n\n',
  '1. Find the [[Femur]] in the model.\n2. Try **Isolate** to see it alone.\n\n',
  'Quick check: which bone does the femur **not** touch — tibia, patella or fibula?',
];
function mockClaude(req, res, bodyObj) {
  mockLog.push({ at: new Date().toISOString(), beta: req.headers['anthropic-beta'] || '', body: bodyObj });
  if (mockLog.length > 50) mockLog.shift();
  const model = bodyObj.model || 'claude-opus-5-5';
  const base = { id: `msg_mock_${Date.now()}`, type: 'message', role: 'assistant', model, stop_sequence: null };
  const usage = { input_tokens: 1200, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  if (!bodyObj.stream) {
    const text = String(JSON.stringify(bodyObj.messages || []));
    const junk = /\b(asdf|test only|lorem)\b/i.test(text);
    const out = junk
      ? { verdict: 'invalid', confidence: 'high', priority: 'low', summary: 'Test message with no actionable content', reasoning: 'The report contains no description of a problem or request.', suggested_fix: '' }
      : { verdict: 'valid', confidence: 'medium', priority: 'medium', summary: 'Plausible report worth checking', reasoning: 'The report is specific and refers to content or behaviour that exists in the atlas.', suggested_fix: 'Check the referenced text against Gray\'s Anatomy and correct it.' };
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_mock' });
      res.end(JSON.stringify({ ...base, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage }));
    }, 400);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': 'req_mock' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...base, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  let i = 0;
  const pieces = CHAT_REPLY.join('').match(/[\s\S]{1,18}/g);
  const tick = setInterval(() => {
    if (i < pieces.length) { ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: pieces[i++] } }); return; }
    clearInterval(tick);
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 180 } });
    ev('message_stop', {});
    res.end();
  }, 25);
  res.on('close', () => clearInterval(tick));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (MOCK && url.pathname === '/__mock/anthropic/v1/messages' && req.method === 'POST') { mockClaude(req, res, (await readBody(req)) || {}); return; }
  if (MOCK && url.pathname === '/__mock/requests') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(mockLog)); return; }
  if (url.pathname.startsWith('/api/')) { await runApi(req, res, url); return; }
  serveStatic(req, res, url.pathname);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`VTL dev server on http://127.0.0.1:${PORT}  (owner page: /admin, token "${process.env.ADMIN_TOKEN === 'dev-admin' ? 'dev-admin' : 'from .env.local'}")`);
  console.log(MOCK ? 'Claude: mocked (no API calls)' : `Claude: ${process.env.ANTHROPIC_API_KEY ? 'live API' : 'not configured'}`);
});
