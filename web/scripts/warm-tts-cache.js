#!/usr/bin/env node
// One-off (re-runnable) batch job: pre-generates Fish Audio TTS for every structure/group
// description and category blurb and stores it in the same Vercel Blob cache api/tts.js
// reads from, so no real visitor ever pays the first-generation cost. Safe to re-run --
// already-cached entries are skipped (one paginated list() of the cache prefix rather than a
// head() per entry: both are Blob "advanced operations", and the Hobby plan only includes 2,000
// a month), and it also picks up any entries that were added to data/desc/*.json since the last run.
//
// Usage (from web/): node scripts/warm-tts-cache.js [--limit=N] [--concurrency=N] [--prune]
//   --prune deletes every tts/ blob outside the current CACHE_PREFIX (old audio formats) first,
//   to free Blob storage after a format change. Nothing else is deleted.
// Requires web/.env.local with FISH_AUDIO_API_KEY, FISH_AUDIO_VOICE_ID (optional),
// FISH_AUDIO_MODEL (optional), and BLOB_READ_WRITE_TOKEN.

const fs = require('fs');
const path = require('path');
const { list, put, del } = require('@vercel/blob');
const { CACHE_PREFIX, cachePathname, synthesize, fishConfig } = require('../lib/tts-audio');

// --- load web/.env.local into process.env (no dotenv dependency needed for a one-off script) ---
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const FISH = fishConfig();
if (!FISH.apiKey) throw new Error('FISH_AUDIO_API_KEY missing from web/.env.local');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing from web/.env.local');

// Mirrors web/js/app.js's descBlocks/plainDesc. Kept as a manual copy (pure string logic, low
// drift risk) rather than a shared module, since drift here only affects narration wording --
// the cache key is the id, not the text, so it can never desync the cache.
function descBlocks(text, title) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    let m;
    if ((m = b.match(/^===\s*(.+?)\s*===$/))) out.push({ t: 'h5', text: m[1] });
    else if ((m = b.match(/^==\s*(.+?)\s*==$/))) out.push({ t: 'h4', text: m[1] });
    else if (b.toLowerCase() === (title || '').toLowerCase() || (/^[A-Z0-9 ,()'’\-/&]+(\s\((MUSCLE|BONE)\))?$/.test(b) && b.length < 70)) continue;
    else out.push({ t: 'p', text: b });
  }
  return out;
}
const plainDesc = (text, title) => descBlocks(text, title).map((b) => (b.t === 'p' ? b.text : `${b.text}.`)).join(' ');

// Mirrors web/js/app.js's SYS_BLURB exactly (the category-level "Listen" text).
const SYS_BLURB = {
  skeletal: 'The skeletal system is the framework of bones and cartilage that supports the body, protects internal organs, and works with muscles to produce movement. It also stores minerals such as calcium and, within certain bones, produces blood cells in the bone marrow. This category includes the skull, spine, ribs, and the bones of the limbs and girdles.',
  joints: "Joints are the connections between bones, held together by ligaments and, in synovial joints, a fluid-filled capsule that allows smooth movement. This category groups the body's joints by type — fibrous, cartilaginous, and synovial — along with the ligaments that stabilize them.",
  insertions: "Muscular insertions show where each muscle attaches onto the skeleton, marking its origin and insertion points. Viewing them alongside the bones helps you understand how a muscle's pull translates into movement at a joint.",
  muscular: 'The muscular system is made up of skeletal muscles that contract to move the bones, stabilize joints, and maintain posture. Each muscle here has an origin, an insertion, and one or more actions it produces at a joint.',
  fascia: 'Fascia is the connective tissue envelope that wraps and separates muscles, organs, and other structures, giving the body its internal shape and letting tissues slide against one another. This category covers the major fascial layers and septa of the body.',
  cardiovascular: "The cardiovascular system is the network of the heart, arteries, veins, and capillaries that circulates blood, delivering oxygen and nutrients to tissues and carrying away waste. Explore the heart's chambers and the major vessels of systemic and pulmonary circulation.",
  lymphoid: "The lymphoid system includes the lymph nodes, spleen, thymus, and lymphatic vessels that drain excess fluid from tissues and support the body's immune defenses.",
  nervous: 'The nervous system includes the brain and spinal cord, known as the central nervous system, as well as the peripheral nerves and sense organs that connect the body to the outside world.',
  visceral: 'Visceral systems cover the internal organs of the digestive, respiratory, urinary, reproductive, and endocrine systems, such as the lungs, stomach, kidneys, and hormone-producing glands.',
  regions: 'Body regions divide the body into named surface areas, such as the head, neck, thorax, abdomen, and limbs, that are used to describe location. This category is a map of anatomical regions rather than individual structures.',
  reference: 'Reference lines and movements are the anatomical planes, directional terms, and joint movements — like flexion, extension, and rotation — used to describe position and motion throughout this atlas.',
};

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function warmOne(id, text, stats, cached) {
  const pathname = cachePathname(id);
  if (cached.has(pathname)) { stats.skipped++; return; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const audio = await synthesize(text, FISH);
      await put(pathname, audio, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/mpeg' });
      stats.generated++;
      return;
    } catch (err) {
      if (attempt === 3) { stats.failed++; stats.failures.push({ id, error: err.message }); return; }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// Simple bounded-concurrency worker pool -- no need for a dependency for this.
async function pool(items, worker, concurrency) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const descDir = path.join(__dirname, '..', 'data', 'desc');
  const jobs = [];
  for (const file of fs.readdirSync(descDir).filter((f) => f.endsWith('.json'))) {
    const system = file.replace(/\.json$/, '');
    const data = JSON.parse(fs.readFileSync(path.join(descDir, file), 'utf8'));
    for (const name of Object.keys(data)) {
      jobs.push({ id: `${system}:${name}`, text: `${name}. ${plainDesc(data[name], name)}` });
    }
  }
  for (const k of Object.keys(SYS_BLURB)) jobs.push({ id: `category:${k}`, text: SYS_BLURB[k] });

  // --limit=N caps how many entries run, for a quick smoke test before a full warm-up.
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : jobs.length;
  const toRun = jobs.slice(0, limit);

  if (process.argv.includes('--prune')) {
    const stale = (await listAll('tts/')).filter((b) => !b.pathname.startsWith(CACHE_PREFIX));
    const mb = (stale.reduce((n, b) => n + b.size, 0) / 1e6).toFixed(1);
    for (let i = 0; i < stale.length; i += 500) await del(stale.slice(i, i + 500).map((b) => b.url));
    console.log(`Pruned ${stale.length} old-format blobs (${mb} MB) outside ${CACHE_PREFIX}`);
  }
  const cached = new Set((await listAll(CACHE_PREFIX)).map((b) => b.pathname));

  console.log(`Warming ${toRun.length} of ${jobs.length} entries (model=${FISH.model}, voice=${FISH.referenceId}, ${cached.size} already cached)...`);
  const stats = { generated: 0, skipped: 0, failed: 0, failures: [] };
  let done = 0;
  const started = Date.now();
  const concurrency = parseInt((process.argv.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1], 10) || 8;
  await pool(toRun, async (job) => {
    await warmOne(job.id, job.text, stats, cached);
    done++;
    if (done % 25 === 0 || done === toRun.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`[${done}/${toRun.length}] generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed} elapsed=${elapsed}s`);
    }
  }, concurrency);

  console.log('--- done ---');
  console.log(JSON.stringify({ generated: stats.generated, skipped: stats.skipped, failed: stats.failed }, null, 2));
  if (stats.failures.length) {
    const failPath = path.join(__dirname, 'warm-tts-failures.json');
    fs.writeFileSync(failPath, JSON.stringify(stats.failures, null, 2));
    console.log(`Wrote ${stats.failures.length} failures to ${failPath}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
