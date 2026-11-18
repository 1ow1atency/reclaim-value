// Serverless handler (used by api/index.js on Vercel): the whole Express API as one function.
// The MongoDB connection is opened once per warm instance and reused.
const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
let connecting = null;

function connect() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    connecting = mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .catch((err) => {
        connecting = null; // retry on the next request
        throw err;
      });
  }
  return connecting;
}

module.exports = async (req, res) => {
  try {
    await connect();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database unavailable. Check MONGO_URI and the Atlas IP access list.' }));
    return;
  }
  return app(req, res);
};
