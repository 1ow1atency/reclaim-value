const { similarity, distanceScore, scoreListings } = require('../src/lib/matching');
const { haversineKm, cityLocation } = require('../src/lib/geo');

const L = (o) => ({ title: 'x', materialType: 'steel', conditionScore: 70, quantityKg: 100, price: 5000, seller: { rating: 4 }, ...o });

test('haversine Patiala -> Chandigarh is ~60 km', () => {
  const d = haversineKm(cityLocation('patiala'), cityLocation('Chandigarh'));
  expect(d).toBeGreaterThan(50);
  expect(d).toBeLessThan(70);
});

test('material match dominates similarity', () => {
  expect(similarity(L({}), { material: 'steel' })).toBeGreaterThan(similarity(L({ materialType: 'glass' }), { material: 'steel' }));
});

test('condition below the requested minimum is penalised', () => {
  expect(similarity(L({ conditionScore: 30 }), { material: 'steel', min_condition: 60 }))
    .toBeLessThan(similarity(L({ conditionScore: 80 }), { material: 'steel', min_condition: 60 }));
});

test('distance score falls to 0 at the radius and is neutral when unknown', () => {
  expect(distanceScore(0, 50)).toBe(1);
  expect(distanceScore(60, 50)).toBe(0);
  expect(distanceScore(null)).toBe(0.5);
});

test('S = w1*Sim + w2*Dist + w3*Price + w4*Rating and cheaper per-kg ranks higher', () => {
  const origin = cityLocation('Patiala');
  const items = [
    L({ price: 9000, location: origin }),
    L({ price: 3000, location: origin }),
  ];
  const w = { sim: 0.4, dist: 0.25, price: 0.2, rating: 0.15 };
  const [a, b] = scoreListings(items, { filters: { material: 'steel' }, origin, weights: w });
  expect(b.match.score).toBeGreaterThan(a.match.score);
  const p = b.match.parts;
  expect(b.match.score).toBeCloseTo(w.sim * p.sim + w.dist * p.dist + w.price * p.price + w.rating * p.rating, 3);
  expect(p.dist).toBe(1);
});
