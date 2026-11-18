// "Wanted" alerts: match buyer requirements against listings and inventory,
// and create in-app notifications. Matching is a plain filter (material,
// quantity, price per kg, condition, distance), so every alert is explainable.
const { Listing, Material, Notification, Wanted } = require('../models');
const { MATERIALS } = require('./catalog');
const { haversineKm } = require('./geo');

const kgText = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} t` : `${Math.round(n)} kg`);
const inrText = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

const idOf = (x) => String(x?._id || x);

// Returns { distanceKm } when the item satisfies the alert, otherwise null.
// `item` is a listing (has price) or an inventory material (no price yet).
function fitsWanted(item, wanted, { ownerId, location } = {}) {
  if (!item || !wanted || item.materialType !== wanted.materialType) return null;
  const owner = ownerId || item.seller;
  if (owner && idOf(owner) === idOf(wanted.buyer)) return null; // never match your own stock
  if (wanted.minQuantityKg && item.quantityKg < wanted.minQuantityKg) return null;
  if (wanted.minCondition && item.conditionScore < wanted.minCondition) return null;
  if (wanted.maxPricePerKg != null && item.price != null
    && item.price / item.quantityKg > wanted.maxPricePerKg + 1e-9) return null;
  const distanceKm = haversineKm(wanted.location, location || item.location);
  // unknown distance (no city set) is allowed rather than hidden
  if (wanted.maxDistanceKm && distanceKm != null && distanceKm > wanted.maxDistanceKm) return null;
  return { distanceKm };
}

function describeWanted(w) {
  const parts = [MATERIALS[w.materialType]?.label || w.materialType];
  if (w.minQuantityKg) parts.push(`at least ${kgText(w.minQuantityKg)}`);
  if (w.maxPricePerKg != null) parts.push(`up to ${inrText(w.maxPricePerKg)}/kg`);
  if (w.minCondition) parts.push(`condition ${w.minCondition}+`);
  parts.push(`within ${w.maxDistanceKm} km${w.city ? ` of ${w.city}` : ''}`);
  return parts.join(', ');
}

async function insertNotifications(docs) {
  if (!docs.length) return 0;
  try {
    const res = await Notification.insertMany(docs, { ordered: false });
    return res.length;
  } catch (err) {
    // duplicate keys mean "already notified" - expected on reruns
    if (err.code === 11000 || err.writeErrors) return err.insertedDocs?.length ?? 0;
    throw err;
  }
}

// Active listings that satisfy an alert, closest first.
async function matchingListings(wanted, limit = 50) {
  const query = { status: 'active', materialType: wanted.materialType, seller: { $ne: wanted.buyer } };
  if (wanted.minQuantityKg) query.quantityKg = { $gte: wanted.minQuantityKg };
  if (wanted.minCondition) query.conditionScore = { $gte: wanted.minCondition };
  const rows = await Listing.find(query).sort({ publishedAt: -1 }).limit(500)
    .populate('seller', 'name organization rating suspended').lean();
  return rows
    .filter((l) => !l.seller?.suspended)
    .map((l) => ({ l, fit: fitsWanted(l, wanted) }))
    .filter((x) => x.fit)
    .sort((a, b) => (a.fit.distanceKm ?? 1e9) - (b.fit.distanceKm ?? 1e9))
    .slice(0, limit)
    .map(({ l, fit }) => ({ ...l, distanceKm: fit.distanceKm }));
}

// Called when a listing goes live (published, re-activated, price lowered,
// back on the market after a cancelled deal). Notifies matching buyers once.
async function notifyBuyersForListing(listing) {
  if (!listing || listing.status !== 'active') return 0;
  const alerts = await Wanted.find({ active: true, materialType: listing.materialType, buyer: { $ne: listing.seller } })
    .populate('buyer', 'suspended').lean();
  const docs = [];
  for (const w of alerts) {
    if (!w.buyer || w.buyer.suspended) continue;
    const fit = fitsWanted(listing, { ...w, buyer: w.buyer._id });
    if (!fit) continue;
    const where = listing.city ? ` in ${listing.city}${fit.distanceKm == null ? '' : fit.distanceKm < 1 ? ' (nearby)' : ` (${fit.distanceKm} km away)`}` : '';
    docs.push({
      user: w.buyer._id,
      kind: 'wanted_match',
      title: `New match: ${listing.title}`.slice(0, 160),
      body: `${kgText(listing.quantityKg)} for ${inrText(listing.price)}${where}. Matches your alert for ${describeWanted(w)}.`.slice(0, 400),
      link: `/marketplace?listing=${listing._id}`,
      key: `match:${w._id}:${listing._id}`,
    });
  }
  return insertNotifications(docs);
}

// Called when a buyer posts an alert. Suppliers holding matching stock in
// inventory (not yet listed) get one nudge per alert to publish it.
async function nudgeSuppliersForWanted(wanted) {
  const items = await Material.find({
    status: 'inventory', materialType: wanted.materialType, owner: { $ne: wanted.buyer },
  }).populate('owner', 'location suspended role').limit(1000).lean();
  const perOwner = new Map();
  for (const m of items) {
    if (!m.owner || m.owner.suspended || m.owner.role !== 'Company') continue;
    const loc = m.location?.lat != null ? m.location : m.owner.location;
    if (!fitsWanted(m, wanted, { ownerId: m.owner._id, location: loc })) continue;
    const entry = perOwner.get(idOf(m.owner)) || { kg: 0, n: 0 };
    entry.kg += m.quantityKg;
    entry.n += 1;
    perOwner.set(idOf(m.owner), entry);
  }
  const docs = [...perOwner.entries()].map(([owner, { kg, n }]) => ({
    user: owner,
    kind: 'demand_nudge',
    title: `A buyer is looking for ${(MATERIALS[wanted.materialType]?.label || wanted.materialType).toLowerCase()}`,
    body: `Wanted: ${describeWanted(wanted)}. You have ${n} matching item${n === 1 ? '' : 's'} (${kgText(kg)}) in inventory. Publish to reach this buyer.`.slice(0, 400),
    link: '/inventory',
    key: `nudge:${wanted._id}:${owner}`,
  }));
  return insertNotifications(docs);
}

// Never let a notification problem break the main action.
const safely = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    console.error('wanted alerts:', err.message);
    return 0;
  }
};

module.exports = {
  fitsWanted,
  describeWanted,
  matchingListings,
  notifyBuyersForListing: safely(notifyBuyersForListing),
  nudgeSuppliersForWanted: safely(nudgeSuppliersForWanted),
};
