const { fitsWanted, describeWanted } = require('../src/lib/wanted');
const { cityLocation } = require('../src/lib/geo');

const patiala = cityLocation('Patiala');
const mumbai = cityLocation('Mumbai');
const W = (o) => ({ buyer: 'b1', materialType: 'brick', maxDistanceKm: 50, location: patiala, ...o });
const L = (o) => ({ seller: 's1', materialType: 'brick', quantityKg: 2000, conditionScore: 70, price: 6000, location: patiala, ...o });

test('matches on material, quantity, condition, price per kg and distance', () => {
  expect(fitsWanted(L({}), W({ minQuantityKg: 1000, minCondition: 60, maxPricePerKg: 3 }))).toEqual({ distanceKm: 0 });
  expect(fitsWanted(L({ materialType: 'steel' }), W({}))).toBeNull();
  expect(fitsWanted(L({ quantityKg: 500 }), W({ minQuantityKg: 1000 }))).toBeNull();
  expect(fitsWanted(L({ conditionScore: 40 }), W({ minCondition: 60 }))).toBeNull();
  expect(fitsWanted(L({ price: 8000 }), W({ maxPricePerKg: 3 }))).toBeNull(); // 4 /kg
  expect(fitsWanted(L({ location: mumbai }), W({}))).toBeNull();
});

test('never matches your own stock; unknown distance is allowed', () => {
  expect(fitsWanted(L({ seller: 'b1' }), W({}))).toBeNull();
  expect(fitsWanted(L({ location: undefined }), W({}))).toEqual({ distanceKm: null });
});

test('inventory items (no price) can match, with owner and location passed in', () => {
  const item = { materialType: 'brick', quantityKg: 3000, conditionScore: 80 };
  expect(fitsWanted(item, W({ maxPricePerKg: 1 }), { ownerId: 's2', location: patiala })).toEqual({ distanceKm: 0 });
  expect(fitsWanted(item, W({}), { ownerId: 'b1', location: patiala })).toBeNull();
});

test('describes an alert in plain words', () => {
  expect(describeWanted(W({ minQuantityKg: 2000, maxPricePerKg: 3.5, city: 'Patiala' })))
    .toBe('Bricks, at least 2 t, up to ₹3.5/kg, within 50 km of Patiala');
});
