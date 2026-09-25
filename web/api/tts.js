// Vercel serverless function: proxies Fish Audio TTS so the API key never reaches the browser,
// and caches the result in Vercel Blob so the same structure/group/category is only ever
// synthesized once. Requires FISH_AUDIO_API_KEY (and optionally FISH_AUDIO_VOICE_ID /
// FISH_AUDIO_MODEL) plus BLOB_READ_WRITE_TOKEN (added automatically when the project's Blob
// store is connected). See web/.env.example and lib/tts-audio.js for the audio format.
//
// The browser reads cached audio straight from the public Blob URL first (ATLAS_CONFIG.ttsBase),
// so this function — and its head() call, which counts against the Hobby plan's advanced-operation
// quota — only runs on a cache miss.
const { head, put } = require('@vercel/blob');
const { cachePathname, synthesize, fishConfig } = require('../lib/tts-audio');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const fish = fishConfig();
  if (!fish.apiKey) { res.status(500).json({ error: 'FISH_AUDIO_API_KEY is not configured' }); return; }

  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string') { res.status(400).json({ error: 'Missing "text"' }); return; }
  const id = req.body && typeof req.body.id === 'string' ? req.body.id : null;

  const pathname = cachePathname(id || text);

  try {
    const cached = await head(pathname);
    if (cached) { res.setHeader('Location', cached.url); res.status(302).end(); return; }
  } catch (err) {
    // Not found in cache (BlobNotFoundError) — fall through and generate it.
  }

  let audio;
  try {
    audio = await synthesize(text, fish);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: 'Fish Audio TTS failed', detail: err.detail });
    else res.status(502).json({ error: 'Failed to reach Fish Audio' });
    return;
  }

  // Awaited so the cache is actually populated before the function's execution context is
  // frozen post-response; caching is still best-effort — a failed write doesn't fail the reply.
  try {
    await put(pathname, audio, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/mpeg' });
  } catch (err) { /* next request will just regenerate */ }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(audio);
};
