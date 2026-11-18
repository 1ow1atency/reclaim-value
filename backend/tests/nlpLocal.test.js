const { parseQuery, agentIntent } = require('../src/lib/nlpLocal');

test('report example: steel under 30,000 near me', () => {
  expect(parseQuery('find steel under 30,000 near me')).toMatchObject({ material: 'steel', max_price: 30000, max_distance_km: 25 });
});

test('suffixes, ranges, km and tonnes', () => {
  expect(parseQuery('timber below 15k').max_price).toBe(15000);
  expect(parseQuery('bricks under 2 lakh').max_price).toBe(200000);
  expect(parseQuery('rebar between 10k and 20k')).toMatchObject({ min_price: 10000, max_price: 20000 });
  const f = parseQuery('concrete within 30 km');
  expect(f.max_price).toBeUndefined();
  expect(f.max_distance_km).toBe(30);
  expect(parseQuery('2 tonnes of bricks').min_quantity_kg).toBe(2000);
  expect(parseQuery('glass in good condition').min_condition).toBe(60);
});

test.each([
  ['show my inventory', 'list_inventory'],
  ['how much co2 did we save', 'impact_summary'],
  ['find tiles under 5000', 'search_listings'],
  ['any pending requests', 'list_requests'],
  ['how much is 500 kg of steel worth', 'estimate_price'],
])('%s -> %s', (msg, tool) => expect(agentIntent(msg).tool).toBe(tool));

test('general question has no tool', () => {
  expect(agentIntent('how does escrow work here').tool).toBeNull();
});
