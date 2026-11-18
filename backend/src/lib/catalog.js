// Mirror of ai-service/catalog.py, used for labels, CO2 maths and as a
// fallback when the AI microservice is unreachable. Keep the two in sync.
const MATERIALS = {
  steel: { label: 'Structural steel', pricePerKg: 52, scrapPerKg: 34, co2PerKg: 1.85, recyclability: 0.95 },
  concrete: { label: 'Concrete / rubble', pricePerKg: 0.9, scrapPerKg: 0.4, co2PerKg: 0.12, recyclability: 0.75 },
  brick: { label: 'Bricks', pricePerKg: 3.2, scrapPerKg: 0.6, co2PerKg: 0.24, recyclability: 0.6 },
  wood: { label: 'Timber / wood', pricePerKg: 24, scrapPerKg: 4, co2PerKg: 0.45, recyclability: 0.55 },
  tiles: { label: 'Tiles / ceramics', pricePerKg: 14, scrapPerKg: 0.5, co2PerKg: 0.6, recyclability: 0.35 },
  glass: { label: 'Glass', pricePerKg: 9, scrapPerKg: 2, co2PerKg: 0.85, recyclability: 0.9 },
};
const MATERIAL_TYPES = Object.keys(MATERIALS);
const ACTIONS = ['Reuse', 'Sell', 'Recycle', 'Dispose'];
const ACTION_CO2_SHARE = { Reuse: 1, Sell: 1, Recycle: 0.45, Dispose: 0 };

function conditionLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

function co2Saved(materialType, quantityKg, action = 'Sell') {
  const m = MATERIALS[materialType];
  if (!m) return 0;
  return Math.round(m.co2PerKg * quantityKg * (ACTION_CO2_SHARE[action] ?? 0) * 10) / 10;
}

// Same formula as ai-service price.baseline_price (without the trained model).
function fallbackPrice(materialType, conditionScore, quantityKg, distanceKm = 10) {
  const m = MATERIALS[materialType];
  const c = Math.max(0, Math.min(conditionScore, 100)) / 100;
  const perKg = Math.max(m.pricePerKg * (0.3 + 0.7 * c), m.scrapPerKg);
  const bulk = quantityKg < 1000 ? 1 : quantityKg < 10000 ? 0.93 : 0.86;
  const freight = 1 - (Math.min(Math.max(distanceKm, 0), 50) / 50) * 0.08;
  const raw = perKg * quantityKg * bulk * freight;
  const price = raw >= 100 ? Math.round(raw / 10) * 10 : Math.round(raw * 100) / 100;
  return {
    price, low: +(price * 0.85).toFixed(2), high: +(price * 1.15).toFixed(2),
    per_kg: +(price / quantityKg).toFixed(2), currency: 'INR', model: 'backend-fallback',
  };
}

function fallbackRecommendation(materialType, conditionScore, quantityKg) {
  const m = MATERIALS[materialType];
  let action = 'Dispose';
  if (conditionScore >= 60) action = 'Sell';
  else if (m.recyclability >= 0.5 || conditionScore >= 35) action = 'Recycle';
  return {
    action, scores: {}, reasons: ['Based on condition and how recyclable the material is (built-in rules)'],
    co2_saved_kg: co2Saved(materialType, quantityKg, action),
    landfill_diverted_kg: action === 'Dispose' ? 0 : quantityKg, model: 'backend-fallback',
  };
}

module.exports = {
  MATERIALS, MATERIAL_TYPES, ACTIONS, ACTION_CO2_SHARE,
  conditionLabel, co2Saved, fallbackPrice, fallbackRecommendation,
};
