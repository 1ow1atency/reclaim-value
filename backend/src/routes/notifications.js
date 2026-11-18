const express = require('express');
const { Notification } = require('../models');
const { HttpError, authenticate, objectId } = require('../middleware');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ items, unread });
});

router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ unread: 0 });
});

router.patch('/:id/read', async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: objectId(req.params.id), user: req.user._id },
    { read: true }, { new: true });
  if (!n) throw new HttpError(404, 'Notification not found');
  res.json({ notification: n });
});

module.exports = router;
