// AI agent with function calling. Intent + arguments come from the AI
// service (rule-based by default, local fallback if it is down); the tools
// below run here against MongoDB with the caller's permissions. Tools are
// read-only on purpose: every state change happens on a page where the user
// confirms it.
const ai = require('./aiClient');
const gemini = require('./gemini');
const guide = require('./guide');
const { Material, Listing, Request } = require('../models');
const { MATERIALS } = require('./catalog');
const { searchListings } = require('./search');
const { summaryFor } = require('./impact');

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const kg = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} t` : `${Math.round(n)} kg`);
const label = (m) => MATERIALS[m]?.label.toLowerCase() || 'material';

const ROLE_TOOLS = {
  Company: ['list_inventory', 'list_my_listings', 'list_requests', 'impact_summary', 'estimate_price', 'recommend_action', 'search_listings'],
  Buyer: ['search_listings', 'list_requests', 'impact_summary', 'estimate_price'],
  Recycler: ['search_listings', 'list_requests', 'impact_summary', 'estimate_price', 'recommend_action'],
  Admin: ['impact_summary', 'search_listings', 'estimate_price', 'recommend_action'],
};

const TOOLS = {
  async search_listings(args, user) {
    const r = await searchListings({ filters: args, user, limit: 5 });
    if (!r.total) return { reply: 'No active listings match that. Try widening the price or distance, or drop the condition filter.', data: { type: 'listings', items: [], filters: args } };
    const lines = r.items.map((l) => `• **${l.title}** - ${kg(l.quantityKg)}, ${inr(l.price)}${l.distanceKm != null ? `, ${l.distanceKm} km away` : ''} (match ${(l.match.score * 100).toFixed(0)}%)`);
    return {
      reply: `Found ${r.total} listing${r.total > 1 ? 's' : ''}. Top matches:\n${lines.join('\n')}`,
      data: { type: 'listings', items: r.items, filters: args },
    };
  },

  async list_inventory(args, user) {
    const q = { owner: user._id, status: 'inventory' };
    if (args.material) q.materialType = args.material;
    const items = await Material.find(q).sort({ createdAt: -1 }).limit(20).lean();
    if (!items.length) return { reply: `You have no ${args.material ? `${label(args.material)} ` : ''}items waiting in inventory. Use **Capture** to add one.`, data: { type: 'materials', items } };
    const total = items.reduce((s, m) => s + m.quantityKg, 0);
    const lines = items.slice(0, 8).map((m) => `• **${m.title}** - ${kg(m.quantityKg)}, condition ${m.conditionScore}/100${m.ai?.recommendedAction ? `, AI suggests ${m.ai.recommendedAction}` : ''}`);
    return { reply: `${items.length} item${items.length > 1 ? 's' : ''} in inventory (${kg(total)} total):\n${lines.join('\n')}`, data: { type: 'materials', items } };
  },

  async list_my_listings(args, user) {
    const q = { seller: user._id, status: { $in: ['active', 'reserved'] } };
    if (args.material) q.materialType = args.material;
    const items = await Listing.find(q).sort({ createdAt: -1 }).limit(20).lean();
    if (!items.length) return { reply: 'You have no live listings. Publish one from **Inventory**.', data: { type: 'listings', items } };
    const lines = items.slice(0, 8).map((l) => `• **${l.title}** - ${inr(l.price)} (${l.status})`);
    return { reply: `${items.length} live listing${items.length > 1 ? 's' : ''}:\n${lines.join('\n')}`, data: { type: 'listings', items } };
  },

  async list_requests(_args, user) {
    const mine = user.role === 'Company' ? { seller: user._id } : { buyer: user._id };
    const items = await Request.find({ ...mine, status: { $in: ['pending', 'accepted'] } })
      .populate('listing', 'title price').populate('buyer', 'name organization').sort({ createdAt: -1 }).limit(20).lean();
    if (!items.length) return { reply: 'No open requests right now.', data: { type: 'requests', items } };
    const lines = items.slice(0, 8).map((r) => `• ${r.listing?.title || 'Listing'} - ${r.status}${user.role === 'Company' ? ` from ${r.buyer?.organization || r.buyer?.name}` : ''}, offer ${inr(r.offerPrice || 0)}`);
    return { reply: `${items.length} open request${items.length > 1 ? 's' : ''}:\n${lines.join('\n')}\nOpen **Requests** to respond.`, data: { type: 'requests', items } };
  },

  async impact_summary(_args, user) {
    const s = await summaryFor(user);
    const parts = [`**${kg(s.divertedKg)}** kept out of landfill and about **${kg(s.co2SavedKg)} CO₂e** avoided (estimate).`];
    if (s.diversionRate != null) parts.push(`Diversion rate: ${s.diversionRate}%.`);
    if (s.ttm?.medianHours != null) parts.push(`Median time-to-match: ${s.ttm.medianHours} h (target ≤ 48 h).`);
    if (s.revenue) parts.push(`Revenue from completed trades: ${inr(s.revenue)}.`);
    if (s.spend) parts.push(`Spent on reclaimed material: ${inr(s.spend)}.`);
    return { reply: parts.join(' '), data: { type: 'impact', value: s } };
  },

  async estimate_price(args) {
    if (!args.material) return { reply: 'Which material? For example: "price of 500 kg of steel in good condition".', data: null };
    const qty = args.min_quantity_kg || 100;
    const p = await ai.price({ material: args.material, condition_score: args.min_condition ?? 60, quantity_kg: qty });
    return {
      reply: `Estimated value for ${kg(qty)} of ${label(args.material)} (condition ≥ ${args.min_condition ?? 60}/100): **${inr(p.price)}** (range ${inr(p.low)}-${inr(p.high)}, ${inr(p.per_kg)}/kg, ${p.model} model). Scrap value would be about ${inr(p.scrap_value ?? 0)}.`,
      data: { type: 'price', value: p },
    };
  },

  async recommend_action(args) {
    if (!args.material) return { reply: 'Tell me the material and roughly its condition, e.g. "should I recycle 300 kg of cracked tiles?"', data: null };
    const qty = args.min_quantity_kg || 100;
    const cond = /cracked|broken|rusty|damaged|old|poor/.test(args._text || '') ? 30 : (args.min_condition ?? 60);
    const r = await ai.recommend({ material: args.material, condition_score: cond, quantity_kg: qty });
    return {
      reply: `For ${kg(qty)} of ${label(args.material)} at condition ~${cond}/100 I'd suggest **${r.action}**. ${r.reasons?.join('; ') || ''}. Estimated CO₂ saving: ${kg(r.co2_saved_kg || 0)}.`,
      data: { type: 'recommendation', value: r },
    };
  },
};

async function answerGeneral(message, history, user) {
  const entry = guide.findAnswer(message);
  if (gemini.isConfigured()) {
    try {
      const text = await gemini.generate({ system: guide.systemPrompt(user.role), history, message });
      return { reply: text, source: 'gemini' };
    } catch (err) {
      console.warn(`[agent] Gemini unavailable, using built-in guide: ${err.message}`);
    }
  }
  const fallback = guide.ENTRIES.find((e) => e.id === 'assistant');
  return { reply: (entry || fallback).answer, source: 'guide' };
}

async function runAgent({ message, history = [], user }) {
  const intent = await ai.agent(message);
  if (intent.intent === 'greeting') {
    return { reply: `Hi ${user.name.split(' ')[0]}! ${guide.ENTRIES.find((e) => e.id === 'assistant').answer}`, source: 'guide', intent };
  }
  if (intent.tool) {
    if (!ROLE_TOOLS[user.role]?.includes(intent.tool)) {
      return { reply: `That isn't available for ${user.role} accounts.`, source: 'tool', intent };
    }
    const out = await TOOLS[intent.tool]({ ...intent.args, _text: message.toLowerCase() }, user);
    return { ...out, source: 'tool', intent };
  }
  return { ...(await answerGeneral(message, history, user)), intent };
}

module.exports = { runAgent, TOOLS, ROLE_TOOLS };
