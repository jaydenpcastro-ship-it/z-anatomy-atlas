// Vercel serverless function: proxies Fish Audio TTS so the API key never reaches the browser.
// Requires FISH_AUDIO_API_KEY (and optionally FISH_AUDIO_VOICE_ID / FISH_AUDIO_MODEL) set as
// environment variables in the Vercel project (Settings > Environment Variables), and in
// web/.env.local for local `vercel dev`. See web/.env.example.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'FISH_AUDIO_API_KEY is not configured' }); return; }

  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string') { res.status(400).json({ error: 'Missing "text"' }); return; }

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
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(audio);
};
