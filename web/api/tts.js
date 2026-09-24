// Vercel serverless function: proxies Fish Audio TTS so the API key never reaches the browser,
// and caches the result in Vercel Blob so the same structure/group/category is only ever
// synthesized once. Requires FISH_AUDIO_API_KEY (and optionally FISH_AUDIO_VOICE_ID /
// FISH_AUDIO_MODEL) plus BLOB_READ_WRITE_TOKEN (added automatically when the project's Blob
// store is connected). See web/.env.example.
const crypto = require('crypto');
const { head, put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'FISH_AUDIO_API_KEY is not configured' }); return; }

  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string') { res.status(400).json({ error: 'Missing "text"' }); return; }
  const id = req.body && typeof req.body.id === 'string' ? req.body.id : null;

  // A stable id (e.g. "skeletal:Humerus") caches per-structure regardless of incidental text
  // changes; without one (e.g. the ad-hoc "currently selected" readout) we cache by exact text.
  const cacheKey = crypto.createHash('sha1').update(id || text).digest('hex');
  const pathname = `tts/${cacheKey}.mp3`;

  try {
    const cached = await head(pathname);
    if (cached) { res.setHeader('Location', cached.url); res.status(302).end(); return; }
  } catch (err) {
    // Not found in cache (BlobNotFoundError) — fall through and generate it.
  }

  const referenceId = process.env.FISH_AUDIO_VOICE_ID || '76bb6ae7b26c41fbbd484514fdb014c2';
  const model = process.env.FISH_AUDIO_MODEL || 's2.1-pro-free';

  let upstream;
  try {
    upstream = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model,
      },
      body: JSON.stringify({ text, reference_id: referenceId, format: 'mp3' }),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Fish Audio' });
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    res.status(upstream.status).json({ error: 'Fish Audio TTS failed', detail });
    return;
  }

  const audio = Buffer.from(await upstream.arrayBuffer());

  // Awaited so the cache is actually populated before the function's execution context is
  // frozen post-response; caching is still best-effort — a failed write doesn't fail the reply.
  try {
    await put(pathname, audio, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/mpeg' });
  } catch (err) { /* next request will just regenerate */ }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(audio);
};
