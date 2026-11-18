// Wanted alerts + notifications against a real MongoDB (runs only with MONGO_TEST_URI; wipes that DB).
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'rv-test-uploads');
process.env.GEMINI_API_KEY = '';

const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../src/app');

const URI = process.env.MONGO_TEST_URI;
const d = URI ? describe : describe.skip;

d('Wanted alerts', () => {
  let app;
  const tok = {};
  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  let alertId;

  beforeAll(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    app = createApp();
    const reg = async (who, role, city) => {
      const r = await request(app).post('/api/auth/register')
        .send({ name: `${who} user`, email: `${who}@test.dev`, password: 'password123', role, city }).expect(201);
      tok[who] = r.body.token;
    };
    await reg('company', 'Company', 'Patiala');
    await reg('buyer', 'Buyer', 'Patiala');
    await reg('recycler', 'Recycler', 'Mumbai');
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  const material = (o) => request(app).post('/api/materials').set(auth('company'))
    .send({ title: 'Red bricks', materialType: 'brick', conditionScore: 75, quantityKg: 3000, ...o }).expect(201)
    .then((r) => r.body.material._id);

  test('only buyers/recyclers post alerts; input is validated', async () => {
    await request(app).post('/api/wanted').set(auth('company')).send({ materialType: 'brick' }).expect(403);
    await request(app).post('/api/wanted').set(auth('buyer')).send({ materialType: 'gold' }).expect(400);
    await request(app).post('/api/wanted').set(auth('buyer')).send({ materialType: 'brick', city: 'Atlantis' }).expect(400);
    await request(app).get('/api/wanted/demand').set(auth('buyer')).expect(403);
  });

  test('posting an alert nudges a nearby supplier with matching inventory', async () => {
    await material({});
    const r = await request(app).post('/api/wanted').set(auth('buyer'))
      .send({ materialType: 'brick', minQuantityKg: 2000, maxPricePerKg: 3, maxDistanceKm: 25 }).expect(201);
    alertId = r.body.wanted._id;
    expect(r.body.wanted.city).toBe('Patiala');
    expect(r.body.wanted.summary).toMatch(/Bricks, at least 2 t/);
    expect(r.body.matches).toHaveLength(0);
    expect(r.body.suppliersNudged).toBe(1);

    const n = await request(app).get('/api/notifications').set(auth('company')).expect(200);
    expect(n.body.unread).toBe(1);
    expect(n.body.items[0].kind).toBe('demand_nudge');
    expect(n.body.items[0].link).toBe('/inventory');

    const demand = await request(app).get('/api/wanted/demand').set(auth('company')).expect(200);
    expect(demand.body.total).toBe(1);
    expect(demand.body.items[0].inRange).toBe(true);
    expect(demand.body.items[0].buyer).toBeUndefined(); // identity hidden
  });

  test('publishing a matching listing notifies the buyer once; non-matching ones do not', async () => {
    const tooPricey = await material({});
    await request(app).post('/api/listings').set(auth('company')).send({ materialId: tooPricey, price: 12000 }).expect(201); // 4/kg
    let n = await request(app).get('/api/notifications').set(auth('buyer')).expect(200);
    expect(n.body.unread).toBe(0);

    const ok = await material({});
    const l = await request(app).post('/api/listings').set(auth('company')).send({ materialId: ok, price: 7500 }).expect(201); // 2.5/kg
    expect(l.body.buyersAlerted).toBe(1);
    n = await request(app).get('/api/notifications').set(auth('buyer')).expect(200);
    expect(n.body.unread).toBe(1);
    expect(n.body.items[0].link).toBe(`/marketplace?listing=${l.body.listing._id}`);

    // withdraw + re-activate does not notify twice
    await request(app).patch(`/api/listings/${l.body.listing._id}`).set(auth('company')).send({ status: 'withdrawn' }).expect(200);
    await request(app).patch(`/api/listings/${l.body.listing._id}`).set(auth('company')).send({ status: 'active' }).expect(200);
    n = await request(app).get('/api/notifications').set(auth('buyer')).expect(200);
    expect(n.body.items).toHaveLength(1);

    // the far-away recycler's identical alert does not match Patiala stock
    await request(app).post('/api/wanted').set(auth('recycler')).send({ materialType: 'brick', maxDistanceKm: 50 }).expect(201);
    const far = await request(app).get('/api/wanted').set(auth('recycler')).expect(200);
    expect(far.body.items[0].matchCount).toBe(0);
  });

  test('lowering the price makes the earlier listing match', async () => {
    const mine = await request(app).get('/api/listings/mine').set(auth('company')).expect(200);
    const pricey = mine.body.items.find((x) => x.price === 12000);
    await request(app).patch(`/api/listings/${pricey._id}`).set(auth('company')).send({ price: 8400 }).expect(200);
    const n = await request(app).get('/api/notifications').set(auth('buyer')).expect(200);
    expect(n.body.unread).toBe(2);
    const list = await request(app).get('/api/wanted').set(auth('buyer')).expect(200);
    expect(list.body.items[0].matchCount).toBe(2);
    const m = await request(app).get(`/api/wanted/${alertId}/matches`).set(auth('buyer')).expect(200);
    expect(m.body.items).toHaveLength(2);
  });

  test('mark read, pause, delete; other users cannot touch your alert', async () => {
    const n = await request(app).get('/api/notifications').set(auth('buyer')).expect(200);
    await request(app).patch(`/api/notifications/${n.body.items[0]._id}/read`).set(auth('company')).expect(404);
    await request(app).patch(`/api/notifications/${n.body.items[0]._id}/read`).set(auth('buyer')).expect(200);
    await request(app).post('/api/notifications/read-all').set(auth('buyer')).expect(200);
    expect((await request(app).get('/api/notifications').set(auth('buyer'))).body.unread).toBe(0);

    await request(app).patch(`/api/wanted/${alertId}`).set(auth('recycler')).send({ active: false }).expect(404);
    const p = await request(app).patch(`/api/wanted/${alertId}`).set(auth('buyer')).send({ active: false }).expect(200);
    expect(p.body.wanted.active).toBe(false);
    const third = await material({});
    await request(app).post('/api/listings').set(auth('company')).send({ materialId: third, price: 6000 }).expect(201);
    expect((await request(app).get('/api/notifications').set(auth('buyer'))).body.unread).toBe(0); // paused

    await request(app).delete(`/api/wanted/${alertId}`).set(auth('recycler')).expect(404);
    await request(app).delete(`/api/wanted/${alertId}`).set(auth('buyer')).expect(204);
  });
});
