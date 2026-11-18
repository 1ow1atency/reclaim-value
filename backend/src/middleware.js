const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
const config = require('./config');
const { User } = require('./models');
const { ALLOWED_TYPES } = require('./lib/storage');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const signToken = (user) => jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret,
  { expiresIn: config.jwtExpiresIn });

async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Session expired - please sign in again');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw new HttpError(401, 'Account no longer exists');
  if (user.suspended) throw new HttpError(403, 'This account is suspended');
  req.user = user;
  next();
}

const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) {
    throw new HttpError(403, `Only ${roles.join(' / ')} accounts can do this`);
  }
  next();
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED_TYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(new HttpError(400, 'Upload a JPG, PNG, WEBP or GIF image'))),
});

function objectId(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Not found');
  return id;
}

// Small validation helpers - keeps routes readable without a schema library.
const num = (v, { name, min = -Infinity, max = Infinity, required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  }
  return n;
};
const str = (v, { name, max = 200, required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return s || undefined;
};

function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 8 MB' : err.message;
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join('; ');
  } else if (err.code === 11000) {
    status = 409;
    message = 'An account with this email already exists';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : message });
}

module.exports = { HttpError, signToken, authenticate, requireRole, upload, objectId, num, str, errorHandler };
