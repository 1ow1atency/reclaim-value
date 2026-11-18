// End-to-end API flow against a real MongoDB. Runs only when MONGO_TEST_URI
// is set (CI provides one); the database it points to is wiped.
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable -> exercises local fallbacks
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'rv-test-uploads');
process.env.GEMINI_API_KEY = '';

const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../src/app');
const { User } = require('../src/models');

const URI = process.env.MONGO_TEST_URI;
const d = URI ? describe : describe.skip;

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

d('Reclaim Value API', () => {
  let app;
  const tok = {};
  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  let materialId;
  let listingId;
  let requestId;

  beforeAll(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    app = createApp();
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test('register validates input and blocks Admin self-registration', async () => {
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'bad', password: '12345678', role: 'Buyer' }).expect(400);
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'a@b.co', password: 'short', role: 'Buyer' }).expect(400);
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'a@b.co', password: '12345678', role: 'Admin' }).expect(400);
  });

  test('register + login for company, buyer, admin', async () => {
    const reg = async (who, role, city) => {
      const r = await request(app).post('/api/auth/register')
        .send({ name: `${who} user`, email: `${who}@test.dev`, password: 'password123', role, city, organization: `${who} org` })
        .expect(201);
      expect(r.body.user.passwordHash).toBeUndefined();
      tok[who] = r.body.token;
    };
    await reg('company', 'Company', 'Patiala');
    await reg('buyer', 'Buyer', 'Patiala');
    await reg('far', 'Buyer', 'Mumbai');
    await reg('admin', 'Buyer', 'Delhi');
    await User.updateOne({ email: 'admin@test.dev' }, { role: 'Admin' });

    await request(app).post('/api/auth/register')
      .send({ name: 'dup', email: 'company@test.dev', password: 'password123', role: 'Buyer' }).expect(409);
    await request(app).post('/api/auth/login').send({ email: 'company@test.dev', password: 'nope' }).expect(401);
    const r = await request(app).post('/api/auth/login').send({ email: 'COMPANY@test.dev', password: 'password123' }).expect(200);
    expect(r.body.user.role).toBe('Company');
    expect(r.body.user.location.lat).toBeCloseTo(30.34, 1);
  });

  test('auth and RBAC are enforced', async () => {
    await request(app).get('/api/materials').expect(401);
    await request(app).get('/api/materials').set('Authorization', 'Bearer junk').expect(401);
    await request(app).get('/api/materials').set(auth('buyer')).expect(403);
    await request(app).get('/api/admin/users').set(auth('company')).expect(403);
  });

  test('analyze stores the photo and degrades gracefully when the AI service is down', async () => {
    const r = await request(app).post('/api/ai/analyze').set(auth('company'))
      .attach('image', PNG, { filename: 'site.png', contentType: 'image/png' }).field('quantityKg', '800');
    expect(r.status).toBe(503);
    expect(r.body.imageUrl).toMatch(/^\/uploads\/.+\.png$/);
    await request(app).get(r.body.imageUrl).expect(200);
    await request(app).post('/api/ai/analyze').set(auth('company'))
      .attach('image', Buffer.from('hi'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
  });

  test('estimate falls back to the backend formula', async () => {
    const r = await request(app).post('/api/ai/estimate').set(auth('company'))
      .send({ material: 'steel', conditionScore: 85, quantityKg: 800 }).expect(200);
    expect(r.body.price.model).toBe('backend-fallback');
    expect(r.body.recommendation.action).toBe('Sell');
  });

  test('company saves material (with AI override) and publishes a listing', async () => {
    const m = await request(app).post('/api/materials').set(auth('company')).send({
      title: 'ISMB beams', materialType: 'steel', conditionScore: 82, quantityKg: 800,
      ai: { material: 'concrete', confidence: 0.4, model: 'demo-heuristic', demoMode: true, recommendedAction: 'Sell', suggestedPrice: 30000 },
    }).expect(201);
    materialId = m.body.material._id;
    expect(m.body.material.materialOverridden).toBe(true);
    expect(m.body.material.conditionLabel).toBe('Excellent');

    await request(app).post('/api/materials').set(auth('company')).send({ title: 'x', materialType: 'gold', conditionScore: 5, quantityKg: 1 }).expect(400);

    const l = await request(app).post('/api/listings').set(auth('company'))
      .send({ materialId, price: 30000, description: 'Clean beams, no rust' }).expect(201);
    listingId = l.body.listing._id;
    expect(l.body.listing.priceAccepted).toBe(true);
    expect(l.body.listing.co2SavedKg).toBeCloseTo(1480, 0);
    await request(app).post('/api/listings').set(auth('company')).send({ materialId, price: 1 }).expect(409);
    await request(app).put(`/api/materials/${materialId}`).set(auth('company')).send({ title: 'new' }).expect(409);
  });

  test('natural-language search with distance filter and match score', async () => {
    const near = await request(app).get('/api/listings').query({ nl: 'steel under 35k near me' }).set(auth('buyer')).expect(200);
    expect(near.body.parser).toBe('local');
    expect(near.body.filters).toMatchObject({ material: 'steel', max_price: 35000, max_distance_km: 25 });
    expect(near.body.total).toBe(1);
    const item = near.body.items[0];
    expect(item.distanceKm).toBeLessThan(25);
    expect(item.match.score).toBeGreaterThan(0.5);

    const far = await request(app).get('/api/listings').query({ nl: 'steel near me' }).set(auth('far')).expect(200);
    expect(far.body.total).toBe(0);
    const cheap = await request(app).get('/api/listings').query({ nl: 'steel under 10k' }).set(auth('buyer')).expect(200);
    expect(cheap.body.total).toBe(0);
  });

  test('request -> accept -> complete (two-step) updates listing, material and rating', async () => {
    const r = await request(app).post('/api/requests').set(auth('buyer'))
      .send({ listingId, message: 'Can collect Monday' }).expect(201);
    requestId = r.body.request._id;
    await request(app).post('/api/requests').set(auth('buyer')).send({ listingId }).expect(409);
    await request(app).post('/api/requests').set(auth('company')).send({ listingId }).expect(403);
    const r2 = await request(app).post('/api/requests').set(auth('far')).send({ listingId }).expect(201);

    await request(app).patch(`/api/requests/${requestId}`).set(auth('buyer')).send({ action: 'complete' }).expect(409); // seller must accept first
    await request(app).patch(`/api/requests/${requestId}`).set(auth('company')).send({ action: 'accept' }).expect(200);
    const other = await request(app).get('/api/requests').set(auth('far')).expect(200);
    expect(other.body.items.find((x) => x._id === r2.body.request._id).status).toBe('rejected');

    const done = await request(app).patch(`/api/requests/${requestId}`).set(auth('buyer'))
      .send({ action: 'complete', rating: 5 }).expect(200);
    expect(done.body.request.status).toBe('completed');
    expect(done.body.request.listing.status).toBe('sold');
    expect(done.body.request.seller.rating).toBe(4.5);

    const mat = await request(app).get(`/api/materials/${materialId}`).set(auth('company')).expect(200);
    expect(mat.body.material.status).toBe('sold');
  });

  test('cancelling after acceptance puts the listing back on the market', async () => {
    const m = await request(app).post('/api/materials').set(auth('company'))
      .send({ title: 'Bricks', materialType: 'brick', conditionScore: 70, quantityKg: 2000 }).expect(201);
    const l = await request(app).post('/api/listings').set(auth('company')).send({ materialId: m.body.material._id, price: 5000 }).expect(201);
    const r = await request(app).post('/api/requests').set(auth('buyer')).send({ listingId: l.body.listing._id }).expect(201);
    await request(app).patch(`/api/requests/${r.body.request._id}`).set(auth('company')).send({ action: 'accept' }).expect(200);
    const c = await request(app).patch(`/api/requests/${r.body.request._id}`).set(auth('buyer'))
      .send({ action: 'cancel', reason: 'failed inspection' }).expect(200);
    expect(c.body.request.listing.status).toBe('active');
  });

  test('close an item as recycled and read impact analytics', async () => {
    const m = await request(app).post('/api/materials').set(auth('company'))
      .send({ title: 'Broken glass', materialType: 'glass', conditionScore: 15, quantityKg: 100 }).expect(201);
    await request(app).post(`/api/materials/${m.body.material._id}/close`).set(auth('company')).send({ action: 'Recycle' }).expect(200);

    const s = await request(app).get('/api/analytics/summary').set(auth('company')).expect(200);
    expect(s.body.divertedKg).toBe(900);
    expect(s.body.diversionRate).toBe(100);
    expect(s.body.revenue).toBe(30000);
    expect(s.body.ttm.matchedListings).toBe(2);
    expect(s.body.ttm.medianHours).toBeLessThan(1);
    expect(s.body.classificationAccuracy).toBe(0);
    expect(s.body.priceAcceptanceRate).toBe(100); // bricks had no AI price, so not counted

    const b = await request(app).get('/api/analytics/summary').set(auth('buyer')).expect(200);
    expect(b.body.purchases).toBe(1);
    expect(b.body.spend).toBe(30000);
  });

  test('agent routes intents to tools with role checks (local fallback, no Gemini)', async () => {
    const inv = await request(app).post('/api/ai/agent').set(auth('company')).send({ message: 'show my inventory' }).expect(200);
    expect(inv.body.intent.tool).toBe('list_inventory');
    expect(inv.body.source).toBe('tool');
    const search = await request(app).post('/api/ai/agent').set(auth('buyer')).send({ message: 'find bricks under 10k near me' }).expect(200);
    expect(search.body.data.items).toHaveLength(1);
    const denied = await request(app).post('/api/ai/agent').set(auth('buyer')).send({ message: 'show my inventory' }).expect(200);
    expect(denied.body.reply).toMatch(/isn't available/);
    const general = await request(app).post('/api/ai/agent').set(auth('buyer')).send({ message: 'how does the escrow inspection step work?' }).expect(200);
    expect(general.body.source).toBe('guide');
    expect(general.body.reply).toMatch(/inspect/i);
  });

  test('admin can suspend a seller, which withdraws their listings and blocks login', async () => {
    const users = await request(app).get('/api/admin/users').set(auth('admin')).expect(200);
    const company = users.body.items.find((u) => u.email === 'company@test.dev');
    await request(app).patch(`/api/admin/users/${company._id}`).set(auth('admin')).send({ suspended: true }).expect(200);
    await request(app).get('/api/materials').set(auth('company')).expect(403);
    await request(app).post('/api/auth/login').send({ email: 'company@test.dev', password: 'password123' }).expect(403);
    const live = await request(app).get('/api/listings').set(auth('buyer')).expect(200);
    expect(live.body.total).toBe(0);
    const o = await request(app).get('/api/admin/overview').set(auth('admin')).expect(200);
    expect(o.body.users.Buyer).toBe(2);
  });
});
