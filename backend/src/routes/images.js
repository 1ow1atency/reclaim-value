// Photos stored in MongoDB (see lib/storage.js). Public like any image URL:
// <img> tags can't send the sign-in token, and the ids are unguessable.
const express = require('express');
const { StoredImage } = require('../models');
const { HttpError, objectId } = require('../middleware');

const router = express.Router();

router.get('/:id', async (req, res) => {
  const img = await StoredImage.findById(objectId(req.params.id)).lean();
  if (!img) throw new HttpError(404, 'Image not found');
  res.set({
    'Content-Type': img.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(Buffer.from(img.data.buffer || img.data));
});

module.exports = router;
