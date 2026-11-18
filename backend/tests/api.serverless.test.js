// Hosted mode: the serverless handler (Vercel) with photos stored in MongoDB.
// Runs only with MONGO_TEST_URI; wipes that database.
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'off';
process.env.IMAGE_STORE = 'db';
process.env.GEMINI_API_KEY = '';
if (process.env.MONGO_TEST_URI) process.env.MONGO_URI = process.env.MONGO_TEST_URI;

const mongoose = require('mongoose');
const request = require('supertest');

const URI = process.env.MONGO_TEST_URI;
const d = URI ? describe : describe.skip;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

d('serverless handler + photos in MongoDB', () => {
  let handler;
  beforeAll(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect(); // the handler must open its own connection
    handler = require('../src/serverless');
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test('connects on first request, stores the photo in the DB and serves it back', async () => {
    await request(handler).get('/api/health').expect(200);
    const reg = await request(handler).post('/api/auth/register')
      .send({ name: 'Co', email: 'co@test.dev', password: 'password123', role: 'Company', city: 'Patiala' }).expect(201);
    const r = await request(handler).post('/api/ai/analyze').set({ Authorization: `Bearer ${reg.body.token}` })
      .attach('image', PNG, { filename: 'site.png', contentType: 'image/png' }).field('quantityKg', '100');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/isn't available in this online version/);
    expect(r.body.imageUrl).toMatch(/^\/api\/images\/[0-9a-f]{24}$/);
    const img = await request(handler).get(r.body.imageUrl).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    await request(handler).get('/api/images/0123456789abcdef01234567').expect(404);
    await request(handler).get('/api/images/nope').expect(404);
  });
});
