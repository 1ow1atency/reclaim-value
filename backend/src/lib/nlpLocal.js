// Lightweight fallback for ai-service/nlp.py so search and the assistant keep
// working if the Python service is down. Covers the common phrasings only.
const SYNONYMS = {
  steel: ['steel', 'iron', 'rebar', 'tmt', 'girder', 'beam', 'beams', 'metal', 'rod', 'rods'],
  concrete: ['concrete', 'rubble', 'aggregate', 'debris', 'cement', 'slab', 'rcc', 'block'],
  brick: ['brick', 'bricks', 'masonry'],
  wood: ['wood', 'wooden', 'timber', 'plank', 'planks', 'lumber', 'plywood', 'door', 'doors'],
  tiles: ['tile', 'tiles', 'ceramic', 'marble', 'granite'],
  glass: ['glass', 'pane', 'panes', 'window', 'windows', 'glazing'],
};
const MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, l: 1e5, cr: 1e7, crore: 1e7 };
const num = (n, s) => parseFloat(n.replace(/,/g, '')) * (MULT[(s || '').toLowerCase()] || 1);
const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|thousand|lakhs?|lac|l|cr|crore)?';
const NOT_UNIT = '(?!\\s*(?:km|kms|kilomet|kg|kgs|tonnes?|tons?))';

function findMaterial(text) {
  let best = null;
  let pos = Infinity;
  for (const [mat, words] of Object.entries(SYNONYMS)) {
    for (const w of words) {
      const m = new RegExp(`\\b${w}\\b`).exec(text);
      if (m && m.index < pos) { best = mat; pos = m.index; }
    }
  }
  return best;
}

function parseQuery(query) {
  const text = String(query || '').toLowerCase();
  const f = {};
  const material = findMaterial(text);
  if (material) f.material = material;
  let m = new RegExp(`between\\s+(?:rs\\.?|inr|₹)?\\s*${NUM}\\s+(?:and|-|to)\\s+(?:rs\\.?|inr|₹)?\\s*${NUM}`).exec(text);
  if (m) { f.min_price = num(m[1], m[2]); f.max_price = num(m[3], m[4]); } else {
    m = new RegExp(`(?:under|below|less than|max|upto|up to|<|cheaper than)\\s*(?:rs\\.?|inr|₹)?\\s*${NUM}${NOT_UNIT}`).exec(text);
    if (m) f.max_price = num(m[1], m[2]);
    m = new RegExp(`(?:over|above|more than|min|>|at least)\\s*(?:rs\\.?|inr|₹)?\\s*${NUM}${NOT_UNIT}`).exec(text);
    if (m) f.min_price = num(m[1], m[2]);
  }
  m = /(?:within|in|under|less than|<)\s*(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet)/.exec(text);
  if (m) f.max_distance_km = parseFloat(m[1]);
  else if (/\b(near me|nearby|close by|around me|local)\b/.test(text)) f.max_distance_km = 25;
  m = /(\d[\d,]*(?:\.\d+)?)\s*(kg|kgs|tonnes?|tons?|t)\b/.exec(text);
  if (m) f.min_quantity_kg = parseFloat(m[1].replace(/,/g, '')) * (m[2].startsWith('t') ? 1000 : 1);
  if (/\b(excellent|like new|mint)\b/.test(text)) f.min_condition = 80;
  else if (/\bvery good\b/.test(text)) f.min_condition = 70;
  else if (/\bgood\b/.test(text)) f.min_condition = 60;
  else if (/\b(fair|usable)\b/.test(text)) f.min_condition = 40;
  if (/\b(cheapest|lowest price|cheap)\b/.test(text)) f.sort = 'price';
  return f;
}

const INTENTS = [
  ['greeting', null, [/^(hi|hello|hey|namaste)\b/]],
  ['impact', 'impact_summary', [/\bco2\b/, /carbon/, /impact/, /diver/, /landfill/, /\besg\b/, /stats|statistics|summary/]],
  ['requests', 'list_requests', [/\brequests?\b/, /\boffers?\b/, /\borders?\b/]],
  ['price', 'estimate_price', [/\bprice\b.*\bof\b/, /how much (is|are|for|would|can i get)/, /\bworth\b/, /\bvalue\b/, /estimate/]],
  ['recommend', 'recommend_action', [/should i (sell|reuse|recycle|dispose|scrap)/, /what (should|to) do with/, /recommend/]],
  ['inventory', 'list_inventory', [/\b(my|our)\b.*\b(inventory|stock|materials|items)\b/, /\binventory\b/]],
  ['listings', 'list_my_listings', [/\bmy listings\b/, /\bpublished\b/]],
  ['search', 'search_listings', [/\b(find|search|show|looking for|need|want|buy|any)\b/, /\bunder\b|\bbelow\b|\bnear\b/]],
];

function agentIntent(message) {
  const text = String(message || '').toLowerCase().trim();
  const filters = parseQuery(text);
  for (const [intent, tool, patterns] of INTENTS) {
    if (!patterns.some((p) => p.test(text))) continue;
    if (intent === 'search' && !filters.material && filters.max_price == null
      && filters.max_distance_km == null && filters.min_condition == null) continue;
    const args = { ...filters };
    if (tool === 'estimate_price' || tool === 'recommend_action') {
      args.min_condition ??= 60;
      args.min_quantity_kg ??= 100;
    }
    return { intent, tool, args };
  }
  return { intent: 'general', tool: null, args: {} };
}

module.exports = { parseQuery, agentIntent };
