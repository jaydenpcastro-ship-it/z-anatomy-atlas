// Vercel serverless function: the anatomy tutor chat. Streams Claude's reply back as newline-delimited JSON:
//   {"t":"text…"}  (repeated)   then   {"done":true,"stop":"end_turn"}   or   {"error":"message for the learner"}
//
// The browser keeps the conversation and sends it whole each turn ({ messages: [{role, content}, …] }); user
// turns may start with an <atlas_context> block the page writes (see js/tutor.js). Nothing is stored here.
// Spend is capped per visitor and per day (TUTOR_DAILY_LIMIT, default 200 messages for the whole site).
const { Anthropic, getClient, configured, tutor, fallbackParams } = require('../lib/claude');
const SYSTEM = require('../lib/tutor-prompt');
const { json, body, caller, underLimit } = require('../lib/http');
const { limiterStore } = require('../lib/store');

const MAX_MESSAGES = 16;                       // the last 8 exchanges are plenty of context for a tutor
const MAX_QUESTION = 250;                      // what the learner types (js/tutor.js enforces the same limit)
const MAX_CONTEXT = 1500, MAX_ASSISTANT_CHARS = 8000;

// A user turn is an optional <atlas_context> block written by the page, then the learner's question.
function userTurn(text) {
  const m = /^\s*(<atlas_context>[\s\S]*?<\/atlas_context>)\s*/.exec(text);
  const ctx = m ? m[1].slice(0, MAX_CONTEXT) : '';
  const question = (m ? text.slice(m[0].length) : text).trim().slice(0, MAX_QUESTION);
  return question ? (ctx ? `${ctx}\n\n${question}` : question) : '';
}

function sanitize(list) {
  if (!Array.isArray(list)) return null;
  const msgs = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.role === 'user' ? userTurn(m.content) : m.content.slice(0, MAX_ASSISTANT_CHARS) }))
    .filter((m) => m.content)
    .slice(-MAX_MESSAGES);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs.length && msgs[msgs.length - 1].role === 'user' ? msgs : null;
}

function friendly(err) {
  if (err instanceof Anthropic.RateLimitError) return 'The tutor is busy right now. Please try again in a minute.';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'The tutor is not set up correctly (API key rejected).';
  if (err instanceof Anthropic.BadRequestError) return 'The tutor could not read that conversation. Start a new chat and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the tutor. Check your connection and try again.';
  if (err instanceof Anthropic.APIError && err.status >= 500) return 'The tutor is temporarily unavailable. Please try again shortly.';
  return 'Something went wrong. Please try again.';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
  if (!configured()) { json(res, 503, { error: 'The tutor is not set up yet: the site owner needs to add an ANTHROPIC_API_KEY.' }); return; }
  const messages = sanitize(body(req)?.messages);
  if (!messages) { json(res, 400, { error: 'Send { messages: [...] } ending with a user message.' }); return; }

  const store = limiterStore(), who = caller(req), day = new Date().toISOString().slice(0, 10);
  try {
    const ok = await underLimit(store, `vtl:rl:chat:burst:${who}`, 20, 600)
      && await underLimit(store, `vtl:rl:chat:day:${who}:${day}`, 150, 86400)
      && await underLimit(store, `vtl:rl:chat:site:${day}`, Number(process.env.TUTOR_DAILY_LIMIT) || 200, 86400);
    if (!ok) { json(res, 429, { error: 'You have reached the question limit for now. Please try again a little later.' }); return; }
  } catch (err) {
    console.error('chat rate limit check failed:', err.message);   // a store hiccup should not take the tutor down
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(`${JSON.stringify(o)}\n`);

  const { model, effort } = tutor();
  const stream = getClient().beta.messages.stream({
    model,
    max_tokens: 4096,                     // thinking counts toward this too; replies are short by design
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
    output_config: { effort },
    ...fallbackParams(model),
  });
  let gone = false;
  res.on('close', () => { if (!res.writableFinished) { gone = true; stream.abort(); } });

  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send({ t: ev.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: "The tutor can't answer that one. Try asking about the anatomy in a different way.", discard: true });
    else send({ done: true, stop: final.stop_reason });
  } catch (err) {
    if (gone) return;
    console.error('chat failed:', err.status || '', err.message);
    send({ error: friendly(err) });
  }
  res.end();
};
