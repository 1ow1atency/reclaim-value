const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');

async function main() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    console.error(`\nCould not connect to MongoDB at ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
    console.error('Start MongoDB locally or set MONGO_URI in backend/.env (MongoDB Atlas works too).\n');
    console.error(err.message);
    process.exit(1);
  }
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Reclaim Value API on http://localhost:${config.port}  (AI service: ${config.aiServiceUrl})`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use. Stop the other process or set PORT in backend/.env.`);
    } else console.error(err);
    process.exit(1);
  });
  const shutdown = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
