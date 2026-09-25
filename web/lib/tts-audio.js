// Shared by api/tts.js and scripts/warm-tts-cache.js so live and pre-generated narration are
// byte-for-byte the same pipeline and land at the same Blob pathname.
//
// Storage budget: the Vercel Hobby Blob store is capped at 1 GB. Fish Audio's own mp3 output is
// 128 kbps (and its opus_bitrate option is ignored — "24 kbps" comes back at ~270 kbps), which
// put ~2,700 narrations at ~4.5 GB. So we request raw 16 kHz PCM and encode it ourselves to
// 24 kbps mono MP3 — ~5.5x smaller, still clear for speech, and playable in every browser.
const crypto = require('crypto');

const SAMPLE_RATE = 16000;
const MP3_KBPS = 24;
// Bump when the audio format changes so old-format files are never served; the old prefix can
// then be deleted wholesale (see scripts/warm-tts-cache.js --prune).
const CACHE_PREFIX = 'tts/v2/';

// Some Wikipedia-derived descriptions run past 20k characters — tens of minutes of narration
// nobody is going to sit through. Cap what's actually spoken; the full text still reads fine on
// the page. Cut at the last sentence boundary before the cap rather than mid-word.
const MAX_NARRATION_CHARS = 2500;
function capNarration(text) {
  if (text.length <= MAX_NARRATION_CHARS) return text;
  const cut = text.lastIndexOf('. ', MAX_NARRATION_CHARS);
  const end = cut > MAX_NARRATION_CHARS * 0.5 ? cut + 1 : MAX_NARRATION_CHARS;
  return `${text.slice(0, end)} The full text continues above.`;
}

// A stable id (e.g. "skeletal:Humerus") caches per-structure regardless of incidental text
// changes; without one we cache by exact text. Must match ttsKey() in js/app.js.
const cachePathname = (idOrText) => `${CACHE_PREFIX}${crypto.createHash('sha1').update(idOrText).digest('hex')}.mp3`;

async function encodeMp3(pcmBuf) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const samples = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.length >> 1);
  const enc = new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS);
  const out = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const chunk = enc.encodeBuffer(samples.subarray(i, i + 1152));
    if (chunk.length) out.push(Buffer.from(chunk));
  }
  out.push(Buffer.from(enc.flush()));
  return Buffer.concat(out);
}

// Throws with .status set to Fish Audio's status on an upstream error.
async function synthesize(text, { apiKey, referenceId, model }) {
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model },
    body: JSON.stringify({ text: capNarration(text), reference_id: referenceId, format: 'pcm', sample_rate: SAMPLE_RATE }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`fish audio ${res.status}: ${detail.slice(0, 200)}`), { status: res.status, detail });
  }
  return encodeMp3(Buffer.from(await res.arrayBuffer()));
}

const fishConfig = () => ({
  apiKey: process.env.FISH_AUDIO_API_KEY,
  referenceId: process.env.FISH_AUDIO_VOICE_ID || '76bb6ae7b26c41fbbd484514fdb014c2',
  model: process.env.FISH_AUDIO_MODEL || 's2.1-pro-free',
});

module.exports = { CACHE_PREFIX, MAX_NARRATION_CHARS, capNarration, cachePathname, synthesize, fishConfig };
