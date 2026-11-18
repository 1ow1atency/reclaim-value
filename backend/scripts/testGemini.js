// Finds a Gemini model that works with your GEMINI_API_KEY.
//   npm run test:gemini                 # list models, try up to 5 candidates
//   node scripts/testGemini.js <model>  # test one specific model
const config = require('../src/config');
const gemini = require('../src/lib/gemini');

async function tryModel(model) {
  const t = Date.now();
  const text = await gemini.generate({ model, message: 'Reply with exactly: OK', timeoutMs: 20000 });
  console.log(`  ✔ ${model} answered in ${Date.now() - t} ms: ${JSON.stringify(text.slice(0, 40))}`);
}

async function main() {
  if (!config.gemini.apiKey) {
    console.error('GEMINI_API_KEY is not set in backend/.env (create one at https://aistudio.google.com/apikey)');
    process.exit(1);
  }
  const specific = process.argv[2];
  let candidates;
  if (specific) candidates = [specific];
  else {
    const models = await gemini.listModels();
    console.log(`${models.length} models support generateContent for this key.`);
    const rank = (m) => (m === config.gemini.model ? 0 : /flash-lite/.test(m) ? 1 : /flash/.test(m) ? 2 : 3);
    candidates = models.filter((m) => /^gemini/.test(m) && !/(image|tts|audio|live|embedding|thinking)/.test(m))
      .sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  }
  for (const m of candidates) {
    try {
      await tryModel(m);
      console.log(`\nWorking model: ${m}\nPut GEMINI_MODEL=${m} in backend/.env and restart the backend.`);
      return;
    } catch (err) {
      console.log(`  ✘ ${m}: ${err.message.slice(0, 160)}`);
    }
  }
  console.error('\nNo candidate worked. Check the key, quota and region; the assistant will use its built-in guide meanwhile.');
  process.exit(1);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
