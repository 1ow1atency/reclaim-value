// Minimal Gemini Developer API client (REST, no SDK). Used only for general
// questions; it never sees live inventory and never performs actions.
const config = require('../config');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const isConfigured = () => Boolean(config.gemini.apiKey);

function toContents(history = [], message) {
  const contents = history
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .slice(-8)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text.slice(0, 2000) }] }));
  contents.push({ role: 'user', parts: [{ text: message.slice(0, 2000) }] });
  return contents;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

async function generate({ system, history, message, model = config.gemini.model, apiKey = config.gemini.apiKey,
  timeoutMs = 15000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: toContents(history, message),
      generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || 'request failed'}`);
  const text = extractText(data);
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function listModels(apiKey = config.gemini.apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || 'list failed'}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

module.exports = { isConfigured, generate, listModels, toContents, extractText };
