// Inventory CRUD for Company accounts.
const express = require('express');
const { Material, Listing } = require('../models');
const { MATERIALS, ACTIONS, conditionLabel } = require('../lib/catalog');
const { cityLocation } = require('../lib/geo');
const {
  HttpError, authenticate, requireRole, objectId, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate, requireRole('Company'));

const LOCKED = ['listed', 'reserved', 'sold'];

async function ownMaterial(req) {
  const m = await Material.findOne({ _id: objectId(req.params.id), owner: req.user._id });
  if (!m) throw new HttpError(404, 'Material not found');
  return m;
}

function readFields(body, { partial = false } = {}) {
  const out = {};
  const req = !partial;
  if (!partial || body.title !== undefined) out.title = str(body.title, { name: 'Title', max: 120, required: req });
  if (!partial || body.materialType !== undefined) {
    if (!MATERIALS[body.materialType]) throw new HttpError(400, `Material type must be one of: ${Object.keys(MATERIALS).join(', ')}`);
    out.materialType = body.materialType;
  }
  if (!partial || body.conditionScore !== undefined) {
    out.conditionScore = num(body.conditionScore, { name: 'Condition score', min: 0, max: 100, required: req });
    out.conditionLabel = conditionLabel(out.conditionScore);
  }
  if (!partial || body.quantityKg !== undefined) {
    out.quantityKg = num(body.quantityKg, { name: 'Quantity (kg)', min: 0.1, max: 1e7, required: req });
  }
  if (body.notes !== undefined) out.notes = str(body.notes, { name: 'Notes', max: 1000 });
  if (body.estimatedPrice !== undefined) out.estimatedPrice = num(body.estimatedPrice, { name: 'Price', min: 0, max: 1e10 });
  if (body.chosenAction !== undefined) {
    if (body.chosenAction && !ACTIONS.includes(body.chosenAction)) throw new HttpError(400, 'Invalid action');
    out.chosenAction = body.chosenAction || null;
  }
  return out;
}

router.get('/', async (req, res) => {
  const q = { owner: req.user._id };
  if (req.query.status) q.status = String(req.query.status);
  if (req.query.materialType) q.materialType = String(req.query.materialType);
  if (req.query.q) q.title = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const items = await Material.find(q).sort({ createdAt: -1 }).limit(500);
  res.json({ items });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const fields = readFields(body);
  const own = req.user.location?.lat != null
    ? { city: req.user.city, lat: req.user.location.lat, lng: req.user.location.lng } : null;
  const loc = cityLocation(body.city) || own;
  const ai = body.ai && typeof body.ai === 'object' ? body.ai : null;
  const material = await Material.create({
    ...fields,
    owner: req.user._id,
    imageUrl: typeof body.imageUrl === 'string' && /^(\/uploads\/|https:\/\/)/.test(body.imageUrl) ? body.imageUrl : undefined,
    city: loc?.city,
    location: loc ? { lat: loc.lat, lng: loc.lng } : undefined,
    ai: ai ? {
      material: ai.material,
      confidence: Number(ai.confidence) || undefined,
      model: ai.model,
      demoMode: Boolean(ai.demoMode),
      conditionScore: Number(ai.conditionScore) || undefined,
      recommendedAction: ACTIONS.includes(ai.recommendedAction) ? ai.recommendedAction : undefined,
      suggestedPrice: Number(ai.suggestedPrice) || undefined,
    } : undefined,
    // only a real AI answer can be overridden; "unsure" results don't count either way
    materialOverridden: ai?.material ? ai.material !== fields.materialType : false,
  });
  res.status(201).json({ material });
});

router.get('/:id', async (req, res) => res.json({ material: await ownMaterial(req) }));

router.put('/:id', async (req, res) => {
  const m = await ownMaterial(req);
  if (LOCKED.includes(m.status)) throw new HttpError(409, 'Withdraw the listing before editing this material');
  const fields = readFields(req.body || {}, { partial: true });
  Object.assign(m, fields);
  if (fields.materialType && m.ai?.material) m.materialOverridden = m.ai.material !== fields.materialType;
  await m.save();
  res.json({ material: m });
});

// Close an item without the marketplace: reused on own site, sent to a recycler, or disposed.
router.post('/:id/close', async (req, res) => {
  const m = await ownMaterial(req);
  const outcome = { Reuse: 'reused', Recycle: 'recycled', Dispose: 'disposed' }[req.body?.action];
  if (!outcome) throw new HttpError(400, 'Action must be Reuse, Recycle or Dispose');
  if (m.status !== 'inventory') throw new HttpError(409, 'Only items still in inventory can be closed');
  m.status = outcome;
  m.chosenAction = req.body.action;
  m.closedAt = new Date();
  await m.save();
  res.json({ material: m });
});

router.delete('/:id', async (req, res) => {
  const m = await ownMaterial(req);
  if (LOCKED.includes(m.status)) throw new HttpError(409, 'This material has a listing - withdraw it first');
  await Listing.updateMany({ material: m._id, status: 'withdrawn' }, { $unset: { material: 1 } });
  await m.deleteOne();
  res.status(204).end();
});

module.exports = router;
