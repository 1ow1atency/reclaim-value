const express = require('express');
const { Wanted } = require('../models');
const { MATERIALS } = require('../lib/catalog');
const { cityLocation, haversineKm } = require('../lib/geo');
const {
  describeWanted, matchingListings, nudgeSuppliersForWanted,
} = require('../lib/wanted');
const {
  HttpError, authenticate, requireRole, objectId, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

const MAX_ACTIVE = 20;
const buyerOnly = requireRole('Buyer', 'Recycler');

// Company view: open demand from buyers, closest first. Buyer identity stays hidden.
router.get('/demand', requireRole('Company', 'Admin'), async (req, res) => {
  const rows = await Wanted.find({ active: true }).sort({ createdAt: -1 }).limit(300)
    .populate('buyer', 'role suspended').lean();
  const items = rows.filter((w) => w.buyer && !w.buyer.suspended).map((w) => {
    const distanceKm = haversineKm(req.user.location, w.location);
    return {
      _id: w._id,
      materialType: w.materialType,
      minQuantityKg: w.minQuantityKg,
      maxPricePerKg: w.maxPricePerKg,
      minCondition: w.minCondition,
      maxDistanceKm: w.maxDistanceKm,
      city: w.city,
      note: w.note,
      buyerRole: w.buyer.role,
      createdAt: w.createdAt,
      summary: describeWanted(w),
      distanceKm,
      inRange: distanceKm == null ? null : distanceKm <= w.maxDistanceKm,
    };
  }).sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  const byMaterial = {};
  for (const w of items) {
    const m = (byMaterial[w.materialType] ||= { alerts: 0, minKg: 0, inRange: 0 });
    m.alerts += 1;
    m.minKg += w.minQuantityKg || 0;
    if (w.inRange) m.inRange += 1;
  }
  res.json({ items: items.slice(0, 100), byMaterial, total: items.length });
});

router.get('/', buyerOnly, async (req, res) => {
  const rows = await Wanted.find({ buyer: req.user._id }).sort({ active: -1, createdAt: -1 }).lean();
  const items = await Promise.all(rows.map(async (w) => ({
    ...w,
    summary: describeWanted(w),
    matchCount: w.active ? (await matchingListings(w, 200)).length : null,
  })));
  res.json({ items });
});

router.post('/', buyerOnly, async (req, res) => {
  const body = req.body || {};
  if (!MATERIALS[body.materialType]) throw new HttpError(400, 'Choose a material');
  const active = await Wanted.countDocuments({ buyer: req.user._id, active: true });
  if (active >= MAX_ACTIVE) throw new HttpError(409, `You can have up to ${MAX_ACTIVE} active alerts. Pause or delete one first.`);

  const place = body.city ? cityLocation(body.city) : null;
  if (body.city && !place) throw new HttpError(400, 'Unknown city');
  const location = place ? { lat: place.lat, lng: place.lng } : req.user.location;
  const wanted = await Wanted.create({
    buyer: req.user._id,
    materialType: body.materialType,
    minQuantityKg: num(body.minQuantityKg, { name: 'Minimum quantity', min: 0, max: 1e7 }),
    maxPricePerKg: num(body.maxPricePerKg, { name: 'Maximum price per kg', min: 0, max: 1e5 }),
    minCondition: num(body.minCondition, { name: 'Minimum condition', min: 0, max: 100 }),
    maxDistanceKm: num(body.maxDistanceKm, { name: 'Distance', min: 1, max: 5000 }) || 50,
    city: place?.city || req.user.city,
    location: location?.lat != null ? { lat: location.lat, lng: location.lng } : undefined,
    note: str(body.note, { name: 'Note', max: 300 }),
  });
  const matches = await matchingListings(wanted, 20);
  const suppliersNudged = await nudgeSuppliersForWanted(wanted);
  res.status(201).json({
    wanted: { ...wanted.toObject(), summary: describeWanted(wanted), matchCount: matches.length },
    matches,
    suppliersNudged,
  });
});

router.get('/:id/matches', buyerOnly, async (req, res) => {
  const wanted = await Wanted.findOne({ _id: objectId(req.params.id), buyer: req.user._id }).lean();
  if (!wanted) throw new HttpError(404, 'Alert not found');
  res.json({ items: await matchingListings(wanted, 50) });
});

// Pause / resume.
router.patch('/:id', buyerOnly, async (req, res) => {
  const wanted = await Wanted.findOne({ _id: objectId(req.params.id), buyer: req.user._id });
  if (!wanted) throw new HttpError(404, 'Alert not found');
  if (typeof req.body?.active !== 'boolean') throw new HttpError(400, 'Send { active: true | false }');
  if (req.body.active && !wanted.active) {
    const active = await Wanted.countDocuments({ buyer: req.user._id, active: true });
    if (active >= MAX_ACTIVE) throw new HttpError(409, `You can have up to ${MAX_ACTIVE} active alerts`);
  }
  wanted.active = req.body.active;
  await wanted.save();
  res.json({ wanted: { ...wanted.toObject(), summary: describeWanted(wanted) } });
});

router.delete('/:id', buyerOnly, async (req, res) => {
  const r = await Wanted.deleteOne({ _id: objectId(req.params.id), buyer: req.user._id });
  if (!r.deletedCount) throw new HttpError(404, 'Alert not found');
  res.status(204).end();
});

module.exports = router;
