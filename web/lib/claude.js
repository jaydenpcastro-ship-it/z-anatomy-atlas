// Claude API settings shared by the tutor chat (api/chat.js) and the flag reviewer (lib/review.js).
//
// Env: ANTHROPIC_API_KEY (required). Optional: TUTOR_MODEL (default claude-haiku-5-5), REVIEW_MODEL (default
// claude-opus-5-5) and TUTOR_EFFORT / REVIEW_EFFORT (default low / high). Switching the tutor to a bigger model,
// e.g. TUTOR_MODEL=claude-sonnet-5-5, needs no code change.
const Anthropic = require('@anthropic-ai/sdk');

let client;
const getClient = () => client || (client = new Anthropic({ maxRetries: 2 }));
const configured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const effort = (v, def) => (EFFORTS.has(v) ? v : def);

const tutor = () => ({ model: process.env.TUTOR_MODEL || 'claude-haiku-5-5', effort: effort(process.env.TUTOR_EFFORT, 'low') });
const reviewer = () => ({ model: process.env.REVIEW_MODEL || 'claude-opus-5-5', effort: effort(process.env.REVIEW_EFFORT, 'high') });

// If the model's safety classifiers decline a request, let the API re-run it on Anthropic's recommended
// fallback model instead of returning a refusal. Haiku has no server-side fallback, so it gets nothing.
const fallbackParams = (model) =>
  /^claude-(opus|sonnet-5-5|fable)/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};

module.exports = { Anthropic, getClient, configured, tutor, reviewer, fallbackParams };
