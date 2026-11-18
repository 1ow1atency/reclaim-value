// Adds clearly-marked SAMPLE data so the marketplace isn't empty in a demo.
// Safe to rerun: keeps existing records and tops the demo supplier's active
// listings up to 50. Demo prices come from the baseline formula - they are
// not real inventory, market quotes or sales.
//
//   npm run seed:demo
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../src/config');
const { User, Listing, Wanted } = require('../src/models');
const { MATERIALS, conditionLabel, co2Saved, fallbackPrice } = require('../src/lib/catalog');
const { CITIES } = require('../src/lib/geo');

const TARGET = 50;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo-password-123';
const TITLES = {
  steel: ['ISMB 200 I-beams', 'TMT rebar offcuts 12 mm', 'MS angle sections', 'Steel channel sections', 'Corrugated steel roofing sheets'],
  concrete: ['Crushed concrete aggregate', 'Precast slab pieces', 'RCC rubble (sorted)', 'Concrete paver blocks'],
  brick: ['Red clay bricks, cleaned', 'Fly-ash bricks', 'Reclaimed bricks with old mortar'],
  wood: ['Teak door frames', 'Shuttering plywood sheets', 'Sal wood beams', 'Pine planks'],
  tiles: ['Vitrified floor tiles 600x600', 'Ceramic wall tiles', 'Marble slab offcuts'],
  glass: ['Toughened glass panes', 'Window glass panels', 'Glass block units'],
};
const QTY = { steel: [200, 4000], concrete: [2000, 30000], brick: [800, 12000], wood: [100, 2500], tiles: [150, 3000], glass: [80, 1200] };
// weight towards the Patiala/Chandigarh region so "near me" searches find something
const CITY_POOL = ['Patiala', 'Patiala', 'Patiala', 'Rajpura', 'Chandigarh', 'Chandigarh', 'Mohali', 'Panchkula',
  'Ludhiana', 'Ambala', 'Delhi', 'Gurugram', 'Noida', 'Jaipur', 'Dehradun', 'Mumbai', 'Pune', 'Bengaluru'];

// deterministic pseudo-random so reruns look similar
let seed = 42;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);

async function demoUser(email, name, role, city, organization) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email, name, role, organization, city, isDemo: true, location: CITIES[city],
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    });
    console.log(`created demo ${role}: ${email}`);
  }
  return user;
}

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  const supplier = await demoUser('demo.supplier@example.com', 'Demo Supplier', 'Company', 'Patiala', '[Demo] Reclaim Sample Constructions');
  const buyer = await demoUser('demo.buyer@example.com', 'Demo Buyer', 'Buyer', 'Patiala', '[Demo] Sample Builders');
  const recycler = await demoUser('demo.recycler@example.com', 'Demo Recycler', 'Recycler', 'Chandigarh', '[Demo] Sample Recyclers');

  // sample "Wanted" alerts so the Buyer demand page isn't empty
  if (!await Wanted.exists({ buyer: { $in: [buyer._id, recycler._id] } })) {
    const at = (u) => ({ city: u.city, location: u.location });
    await Wanted.insertMany([
      { buyer: buyer._id, materialType: 'brick', minQuantityKg: 2000, maxPricePerKg: 3.5, maxDistanceKm: 50, ...at(buyer), note: '[Demo] For a boundary wall' },
      { buyer: buyer._id, materialType: 'steel', minQuantityKg: 500, maxPricePerKg: 45, minCondition: 60, maxDistanceKm: 50, ...at(buyer), note: '[Demo] Rebar or sections' },
      { buyer: recycler._id, materialType: 'glass', maxDistanceKm: 100, ...at(recycler), note: '[Demo] Any condition, we recycle' },
    ]);
    console.log('added 3 demo wanted alerts');
  }

  const active = await Listing.countDocuments({ seller: supplier._id, status: 'active', isDemo: true });
  const missing = Math.max(0, TARGET - active);
  const docs = [];
  for (let i = 0; i < missing; i += 1) {
    const material = pick(Object.keys(MATERIALS));
    const city = pick(CITY_POOL);
    const conditionScore = Math.round(between(35, 96));
    const [lo, hi] = QTY[material];
    const quantityKg = Math.round(between(lo, hi) / 10) * 10;
    const price = fallbackPrice(material, conditionScore, quantityKg, 10).price;
    const base = CITIES[city];
    const publishedAt = new Date(Date.now() - between(0, 20) * 864e5);
    docs.push({
      seller: supplier._id,
      title: `[Demo] ${pick(TITLES[material])}`,
      description: `Sample listing for testing the marketplace - not real inventory. ${MATERIALS[material].label}, condition ${conditionScore}/100, collected from a demolition site in ${city}.`,
      materialType: material,
      conditionScore,
      conditionLabel: conditionLabel(conditionScore),
      quantityKg,
      price: Math.round(price * between(0.9, 1.08) / 10) * 10,
      suggestedPrice: price,
      city,
      location: { lat: base.lat + between(-0.05, 0.05), lng: base.lng + between(-0.05, 0.05) },
      co2SavedKg: co2Saved(material, quantityKg, 'Sell'),
      isDemo: true,
      publishedAt,
    });
  }
  if (docs.length) await Listing.insertMany(docs);
  console.log(`demo supplier now has ${active + docs.length} active sample listings (added ${docs.length})`);
  console.log(`demo accounts use the password: ${DEMO_PASSWORD}  (local testing only)`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
