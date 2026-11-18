const { fallbackPrice, fallbackRecommendation, co2Saved, conditionLabel } = require('../src/lib/catalog');
const { summarise, median } = require('../src/lib/impact');

test('fallback price grows with condition and never drops below scrap', () => {
  expect(fallbackPrice('steel', 90, 500).price).toBeGreaterThan(fallbackPrice('steel', 20, 500).price);
  expect(fallbackPrice('tiles', 0, 100).price).toBeGreaterThanOrEqual(50);
});

test('fallback recommendation', () => {
  expect(fallbackRecommendation('steel', 80, 100).action).toBe('Sell');
  expect(fallbackRecommendation('glass', 20, 100).action).toBe('Recycle');
  expect(fallbackRecommendation('tiles', 10, 100).action).toBe('Dispose');
});

test('co2 shares by action', () => {
  expect(co2Saved('steel', 100, 'Reuse')).toBe(185);
  expect(co2Saved('steel', 100, 'Recycle')).toBeCloseTo(83.3, 1);
  expect(co2Saved('steel', 100, 'Dispose')).toBe(0);
});

test('labels', () => {
  expect([conditionLabel(85), conditionLabel(65), conditionLabel(45), conditionLabel(5)])
    .toEqual(['Excellent', 'Good', 'Fair', 'Poor']);
});

test('impact summary diversion rate and median', () => {
  const s = summarise([
    { materialType: 'steel', quantityKg: 300, action: 'Sell', at: new Date() },
    { materialType: 'tiles', quantityKg: 100, action: 'Dispose', at: new Date() },
  ]);
  expect(s.divertedKg).toBe(300);
  expect(s.diversionRate).toBe(75);
  expect(median([5, 1, 3])).toBe(3);
  expect(median([1, 2, 3, 4])).toBe(2.5);
});
