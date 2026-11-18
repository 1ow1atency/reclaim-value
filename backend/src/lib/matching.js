// Smart matching: S = w1*Sim + w2*Dist + w3*Price + w4*Rating (each 0..1).
const config = require('../config');
const { haversineKm } = require('./geo');

const clamp = (x) => Math.max(0, Math.min(1, x));
const round = (x) => Math.round(x * 1000) / 1000;

function similarity(listing, filters = {}) {
  let sim = filters.material ? (listing.materialType === filters.material ? 1 : 0.1) : 0.6;
  const words = (filters.keywords || []).map((w) => w.toLowerCase());
  if (words.length) {
    const text = `${listing.title} ${listing.description || ''}`.toLowerCase();
    const hits = words.filter((w) => text.includes(w)).length;
    sim += 0.4 * (hits / words.length) - (filters.material ? 0.15 : 0);
  }
  if (filters.min_condition != null) {
    sim += listing.conditionScore >= filters.min_condition ? 0.05 : -0.3;
  }
  return clamp(sim);
}

function distanceScore(distanceKm, radiusKm = config.maxMatchRadiusKm) {
  if (distanceKm == null) return 0.5;
  return clamp(1 - distanceKm / radiusKm);
}

// Cheaper per-kg than other results of the same material scores higher.
function priceScores(listings) {
  const byMat = {};
  for (const l of listings) (byMat[l.materialType] ||= []).push(l.price / l.quantityKg);
  return (l) => {
    const arr = byMat[l.materialType] || [];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (!arr.length || max === min) return 0.5;
    return clamp(1 - (l.price / l.quantityKg - min) / (max - min));
  };
}

function scoreListings(listings, { filters = {}, origin = null, weights = config.matchWeights } = {}) {
  const radius = filters.max_distance_km || config.maxMatchRadiusKm;
  const priceOf = priceScores(listings);
  return listings.map((l) => {
    const distanceKm = haversineKm(origin, l.location);
    const parts = {
      sim: round(similarity(l, filters)),
      dist: round(distanceScore(distanceKm, Math.max(radius, 1))),
      price: round(priceOf(l)),
      rating: round(clamp(((l.seller && l.seller.rating) || 4) / 5)),
    };
    const score = weights.sim * parts.sim + weights.dist * parts.dist
      + weights.price * parts.price + weights.rating * parts.rating;
    return { listing: l, distanceKm, match: { score: round(score), parts } };
  });
}

module.exports = { similarity, distanceScore, priceScores, scoreListings };
