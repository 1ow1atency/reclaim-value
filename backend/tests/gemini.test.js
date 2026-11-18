const gemini = require('../src/lib/gemini');

afterEach(() => { jest.restoreAllMocks(); });

test('history is mapped to Gemini roles and trimmed', () => {
  const hist = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }));
  const c = gemini.toContents(hist, 'now');
  expect(c).toHaveLength(9);
  expect(c[c.length - 1]).toEqual({ role: 'user', parts: [{ text: 'now' }] });
  expect(c.some((x) => x.role === 'model')).toBe(true);
});

test('generate sends key in header and parses text', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hello' }, { text: '!' }] } }] }),
  });
  const out = await gemini.generate({ apiKey: 'k', model: 'm1', message: 'hi', system: 'sys' });
  expect(out).toBe('Hello!');
  const [url, opts] = spy.mock.calls[0];
  expect(url).toContain('/models/m1:generateContent');
  expect(url).not.toContain('k');
  expect(opts.headers['x-goog-api-key']).toBe('k');
  expect(JSON.parse(opts.body).systemInstruction.parts[0].text).toBe('sys');
});

test('generate surfaces API errors', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) });
  await expect(gemini.generate({ apiKey: 'k', model: 'bad', message: 'hi' })).rejects.toThrow('model not found');
});

test('missing key is reported', async () => {
  await expect(gemini.generate({ apiKey: '', message: 'hi' })).rejects.toThrow('GEMINI_API_KEY');
});
