require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
const DEV_SECRET = 'dev-only-insecure-secret-change-me';

const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/reclaim_value',
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  aiServiceUrl: (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
  // AI_SERVICE_URL=off: hosted without the Python service (photo recognition off,
  // search/price/recommendations use the built-in rules)
  aiDisabled: ['off', 'none', 'disabled'].includes(String(process.env.AI_SERVICE_URL || '').trim().toLowerCase()),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  // where photos go when Cloudinary isn't configured: 'local' disk (dev) or 'db' (MongoDB).
  // Hosts without a lasting disk (production, Vercel) default to 'db'.
  imageStore: process.env.IMAGE_STORE || (isProd || process.env.VERCEL ? 'db' : 'local'),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  // Smart-matching weights: S = w1*Sim + w2*Dist + w3*Price + w4*Rating
  matchWeights: (() => {
    const [sim, dist, price, rating] = (process.env.MATCH_WEIGHTS || '0.4,0.25,0.2,0.15')
      .split(',').map(Number);
    return { sim, dist, price, rating };
  })(),
  maxMatchRadiusKm: Number(process.env.MAX_MATCH_RADIUS_KM) || 50,
};

if (isProd && config.jwtSecret === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = config;
