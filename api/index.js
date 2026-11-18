// Vercel function: all /api/* requests are rewritten here (see vercel.json).
// The handler lives in backend/ so its dependencies resolve from backend/node_modules.
module.exports = require('../backend/src/serverless');
