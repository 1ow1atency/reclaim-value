const express = require('express');
const ai = require('../lib/aiClient');
const gemini = require('../lib/gemini');
const config = require('../config');
const { saveImage, usesCloudinary } = require('../lib/storage');
const { runAgent } = require('../lib/agent');
const { MATERIALS, conditionLabel } = require('../lib/catalog');
const {
  HttpError, authenticate, requireRole, upload, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

router.get('/status', async (_req, res) => {
  res.json({
    aiService: await ai.health(),
    gemini: { configured: gemini.isConfigured(), model: config.gemini.model },
    storage: usesCloudinary() ? 'cloudinary' : 'local',
  });
});

// Photo -> AI inspection. The image is stored first so it can be attached to
// the inventory item; the analysis itself is NOT saved until the user confirms.
router.post('/analyze', requireRole('Company'), upload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Attach a photo (field name "image")');
  const quantityKg = num(req.body.quantityKg, { name: 'Quantity (kg)', min: 0.1, max: 1e7 }) || 100;
  const distanceKm = num(req.body.distanceKm, { name: 'Distance', min: 0, max: 5000 }) ?? 10;
  const imageUrl = await saveImage(req.file.buffer, req.file.mimetype);
  try {
    const analysis = await ai.analyze({
      buffer: req.file.buffer, filename: req.file.originalname, mimetype: req.file.mimetype, quantityKg, distanceKm,
    });
    res.json({ imageUrl, analysis });
  } catch (err) {
    if (err instanceof ai.AiUnavailableError) {
      // Let the user continue with manual entry instead of losing the upload.
      return res.status(503).json({ imageUrl, error: `${err.message}. You can still enter the details manually.` });
    }
    throw err;
  }
});

function materialBody(body = {}) {
  if (!MATERIALS[body.material]) throw new HttpError(400, 'Unknown material');
  return {
    material: body.material,
    condition_score: num(body.conditionScore, { name: 'Condition', min: 0, max: 100 }) ?? 70,
    quantity_kg: num(body.quantityKg, { name: 'Quantity', min: 0.1, max: 1e7 }) || 100,
    distance_km: num(body.distanceKm, { name: 'Distance', min: 0, max: 5000 }) ?? 10,
  };
}

// Re-price / re-recommend after the user corrects the AI's material or condition.
router.post('/estimate', async (req, res) => {
  const b = materialBody(req.body);
  const [price, recommendation] = await Promise.all([ai.price(b), ai.recommend(b)]);
  res.json({ price, recommendation, conditionLabel: conditionLabel(b.condition_score) });
});

router.post('/agent', async (req, res) => {
  const message = str(req.body?.message, { name: 'Message', max: 500, required: true });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  res.json(await runAgent({ message, history, user: req.user }));
});

module.exports = router;
