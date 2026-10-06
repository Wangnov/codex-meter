const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('independent page button opens panel without requests or official DOM changes', async () => {
  const dom = new JSDOM('<main><section id="official">Official usage chart</section></main>', {
    url: 'https://chatgpt.com/settings/usage?tab=analytics', runScripts: 'outside-only',
  });
  const w = dom.window;
  let requests = 0;
  let refreshes = 0;
  let poll;
  w.fetch = () => { requests++; throw new Error('Network forbidden'); };
  w.setInterval = (fn) => { poll = fn; return 1; };
  w.chrome = { runtime: { onMessage: { addListener() {} } }, storage: {
    local: { get: async () => ({}), set: async () => {} },
  } };
  for (const file of ['shared/config.js', 'domain/usage-domain.js', 'domain/quota-history.js']) {
    w.eval(fs.readFileSync(`codex-meter-extension/${file}`, 'utf8'));
  }
  w.CodexMeterChatGptClient = { bootstrapLocale: () => 'en-US' };
  w.CodexMeterReportRepository = { load: async () => ({ latest: {
    capturedAt: '2026-09-22T12:51:19Z', capturedAtLocal: '2026/9/22 20:51:19',
    dailyList: [], currentCycleList: [], historyList: [], windows: [],
    currentStats: w.CodexMeterDomain.getStats([]),
    historyStats: w.CodexMeterDomain.getStats([]),
    totalStats: w.CodexMeterDomain.getStats([]),
  } }) };
  w.CodexMeterReportService = { createReportService: () => ({
    refreshReport: async () => { refreshes++; throw new Error('Explicit refresh test'); },
  }) };
  const original = w.document.querySelector('main').outerHTML;
  w.eval(fs.readFileSync('codex-meter-extension/content.js', 'utf8'));
  const button = w.document.getElementById('codex-quota-compass-button');
  assert.ok(button);
  assert.equal(button.parentElement, w.document.documentElement);
  for (let i = 0; i < 20; i++) poll();
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.document.getElementById('codex-quota-compass-panel').dataset.open, 'true');
  assert.equal(requests, 0);
  assert.equal(refreshes, 0);
  assert.equal(w.document.querySelector('main').outerHTML, original);
  w.history.pushState({}, '', '/settings/usage?tab=overview');
  poll();
  assert.equal(w.document.getElementById('codex-quota-compass-button'), null);
  assert.equal(w.document.getElementById('codex-quota-compass-panel').dataset.open, 'false');
  dom.window.close();
});
