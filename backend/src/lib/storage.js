// Image storage: Cloudinary when configured, local disk otherwise.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const usesCloudinary = () => Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey
  && config.cloudinary.apiSecret);

async function uploadCloudinary(buffer, mimetype) {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'reclaim-value';
  const signature = crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }));
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${data.error?.message || res.status}`);
  return data.secure_url;
}

async function saveImage(buffer, mimetype) {
  if (usesCloudinary()) return uploadCloudinary(buffer, mimetype);
  await fs.mkdir(config.uploadDir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[mimetype] || '.jpg'}`;
  await fs.writeFile(path.join(config.uploadDir, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveImage, usesCloudinary, ALLOWED_TYPES: Object.keys(EXT) };
