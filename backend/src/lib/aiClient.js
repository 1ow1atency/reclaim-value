// HTTP client for the Python AI microservice. Every call has a timeout and
// read-only helpers fall back to local logic so the marketplace keeps working
// when the AI service is offline.
const config = require('../config');
const local = require('./nlpLocal');
const { fallbackPrice, fallbackRecommendation, MATERIALS } = require('./catalog');

class AiUnavailableError extends Error {
  constructor(message = 'AI service is unavailable') {
    super(message);
    this.status = 503;
  }
}

async function call(path, { method = 'POST', body, json, timeoutMs = 5000 } = {}) {
  if (config.aiDisabled) throw new AiUnavailableError("Photo recognition isn't available in this online version");
  let res;
  try {
    res = await fetch(`${config.aiServiceUrl}${path}`, {
      method,
      body: json ? JSON.stringify(json) : body,
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AiUnavailableError(`AI service unreachable at ${config.aiServiceUrl} (${err.name})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(typeof data.detail === 'string' ? data.detail : `AI service error ${res.status}`);
    e.status = res.status >= 500 ? 502 : 400;
    throw e;
  }
  return data;
}

async function health() {
  try {
    return { reachable: true, ...(await call('/health', { method: 'GET', timeoutMs: 8000 })) };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

async function analyze({ buffer, filename, mimetype, quantityKg, distanceKm }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename || 'photo.jpg');
  form.append('quantity_kg', String(quantityKg || 100));
  form.append('distance_km', String(distanceKm ?? 10));
  return call('/analyze', { body: form, timeoutMs: 60000 }); // allows for a cold start on serverless hosts
}

async function withFallback(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiUnavailableError) return fallback();
    throw err;
  }
}

const valid = (m) => (MATERIALS[m] ? m : 'steel');

module.exports = {
  AiUnavailableError,
  health,
  analyze,
  price: (b) => withFallback(() => call('/price', { json: b }),
    () => fallbackPrice(valid(b.material), b.condition_score ?? 70, b.quantity_kg || 100, b.distance_km ?? 10)),
  recommend: (b) => withFallback(() => call('/recommend', { json: b }),
    () => fallbackRecommendation(valid(b.material), b.condition_score ?? 70, b.quantity_kg || 100)),
  parse: (text) => withFallback(
    async () => ({ ...(await call('/nlp/parse', { json: { text }, timeoutMs: 3000 })), parser: 'ai-service' }),
    () => ({ query: text, filters: local.parseQuery(text), parser: 'local' }),
  ),
  agent: (text) => withFallback(
    async () => ({ ...(await call('/agent', { json: { text }, timeoutMs: 3000 })), parser: 'ai-service' }),
    () => ({ ...local.agentIntent(text), parser: 'local' }),
  ),
};
