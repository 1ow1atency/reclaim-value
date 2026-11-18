// Impact / ESG metrics. Computed in JS over lean documents - fine at pilot
// scale (thousands of records); move to $group pipelines if it grows.
const { Material, Listing, Request } = require('../models');
const { co2Saved, MATERIAL_TYPES } = require('./catalog');

const STATUS_ACTION = { sold: 'Sell', reused: 'Reuse', recycled: 'Recycle' };
const r1 = (x) => Math.round(x * 10) / 10;

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  }
  return out;
}

// One "outcome" = some kg of a material that left the site by some route.
function summarise(outcomes) {
  const byMaterial = Object.fromEntries(MATERIAL_TYPES.map((m) => [m, { material: m, divertedKg: 0, disposedKg: 0, co2SavedKg: 0 }]));
  const months = lastMonths(6);
  const monthly = Object.fromEntries(months.map((m) => [m, { month: m, divertedKg: 0, co2SavedKg: 0 }]));
  let diverted = 0;
  let disposed = 0;
  let co2 = 0;
  const byAction = { Reuse: 0, Sell: 0, Recycle: 0, Dispose: 0 };
  for (const o of outcomes) {
    const bucket = byMaterial[o.materialType];
    if (!bucket) continue;
    byAction[o.action] += o.quantityKg;
    if (o.action === 'Dispose') {
      disposed += o.quantityKg;
      bucket.disposedKg += o.quantityKg;
      continue;
    }
    const c = co2Saved(o.materialType, o.quantityKg, o.action);
    diverted += o.quantityKg;
    co2 += c;
    bucket.divertedKg += o.quantityKg;
    bucket.co2SavedKg += c;
    const mk = o.at && monthKey(o.at);
    if (monthly[mk]) {
      monthly[mk].divertedKg += o.quantityKg;
      monthly[mk].co2SavedKg += c;
    }
  }
  return {
    divertedKg: r1(diverted),
    disposedKg: r1(disposed),
    co2SavedKg: r1(co2),
    diversionRate: diverted + disposed > 0 ? r1((diverted / (diverted + disposed)) * 100) : null,
    byAction: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, r1(v)])),
    byMaterial: Object.values(byMaterial).map((b) => ({
      ...b, divertedKg: r1(b.divertedKg), disposedKg: r1(b.disposedKg), co2SavedKg: r1(b.co2SavedKg),
    })),
    monthly: Object.values(monthly).map((m) => ({ ...m, divertedKg: r1(m.divertedKg), co2SavedKg: r1(m.co2SavedKg) })),
  };
}

const pct = (num, den) => (den ? r1((num / den) * 100) : null);

async function supplySummary(match = {}) {
  const [materials, listings, requests] = await Promise.all([
    Material.find(match.owner ? { owner: match.owner } : {}).lean(),
    Listing.find(match.owner ? { seller: match.owner } : {}).lean(),
    Request.find(match.owner ? { seller: match.owner } : {}).lean(),
  ]);

  const outcomes = [];
  for (const m of materials) {
    const action = STATUS_ACTION[m.status] || (m.status === 'disposed' ? 'Dispose' : null);
    if (action) outcomes.push({ materialType: m.materialType, quantityKg: m.quantityKg, action, at: m.closedAt || m.updatedAt });
  }
  // sold listings created without an inventory item (e.g. demo data)
  for (const l of listings) {
    if (l.status === 'sold' && !l.material) {
      outcomes.push({ materialType: l.materialType, quantityKg: l.quantityKg, action: 'Sell', at: l.soldAt || l.updatedAt });
    }
  }

  const ttmHours = listings.filter((l) => l.firstInterestAt)
    .map((l) => (new Date(l.firstInterestAt) - new Date(l.publishedAt)) / 36e5);
  const withAi = materials.filter((m) => m.ai && m.ai.material);
  const priced = listings.filter((l) => typeof l.priceAccepted === 'boolean');
  const requestCounts = requests.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  return {
    scope: match.owner ? 'company' : 'platform',
    counts: {
      materials: materials.length,
      inInventory: materials.filter((m) => m.status === 'inventory').length,
      activeListings: listings.filter((l) => l.status === 'active').length,
      soldListings: listings.filter((l) => l.status === 'sold').length,
      requests: requestCounts,
    },
    revenue: r1(requests.filter((r) => r.status === 'completed').reduce((s, r) => s + (r.offerPrice || 0), 0)),
    ...summarise(outcomes),
    ttm: {
      medianHours: ttmHours.length ? r1(median(ttmHours)) : null,
      matchedListings: ttmHours.length,
      within48h: pct(ttmHours.filter((h) => h <= 48).length, ttmHours.length),
      targetHours: 48,
    },
    classificationAccuracy: pct(withAi.filter((m) => !m.materialOverridden).length, withAi.length),
    aiReviewed: withAi.length,
    priceAcceptanceRate: pct(priced.filter((l) => l.priceAccepted).length, priced.length),
  };
}

async function demandSummary(buyerId) {
  const requests = await Request.find({ buyer: buyerId })
    .populate('listing', 'materialType quantityKg').lean();
  const done = requests.filter((r) => r.status === 'completed' && r.listing);
  const outcomes = done.map((r) => ({
    materialType: r.listing.materialType, quantityKg: r.quantityKg || r.listing.quantityKg, action: 'Sell', at: r.completedAt,
  }));
  const s = summarise(outcomes);
  return {
    scope: 'buyer',
    counts: { requests: requests.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}) },
    spend: r1(done.reduce((sum, r) => sum + (r.offerPrice || 0), 0)),
    purchases: done.length,
    divertedKg: s.divertedKg,
    co2SavedKg: s.co2SavedKg,
    byMaterial: s.byMaterial,
    monthly: s.monthly,
  };
}

function summaryFor(user) {
  if (user.role === 'Admin') return supplySummary();
  if (user.role === 'Company') return supplySummary({ owner: user._id });
  return demandSummary(user._id);
}

module.exports = { summaryFor, supplySummary, demandSummary, median, summarise };
