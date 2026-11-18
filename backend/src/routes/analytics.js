const express = require('express');
const { authenticate } = require('../middleware');
const { summaryFor } = require('../lib/impact');

const router = express.Router();
router.get('/summary', authenticate, async (req, res) => res.json(await summaryFor(req.user)));

module.exports = router;
