const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('codex-meter-extension/shared/config.js', 'utf8'), { window, URLSearchParams });
const { isAnalyticsRoute, ROUTES } = window.CodexMeterConfig;
test('current usage analytics route and legacy route are supported', () => {
  assert.equal(isAnalyticsRoute(new URL('https://chatgpt.com/settings/usage?tab=analytics')), true);
  assert.equal(isAnalyticsRoute(new URL('https://chatgpt.com/codex/cloud/settings/analytics')), true);
  assert.equal(ROUTES.analyticsUrl, 'https://chatgpt.com/settings/usage?tab=analytics');
});
test('overview, unrelated settings and foreign origins are excluded', () => {
  for (const url of ['https://chatgpt.com/settings/usage', 'https://chatgpt.com/settings/usage?tab=overview', 'https://chatgpt.com/settings/account?tab=analytics', 'https://example.com/settings/usage?tab=analytics']) {
    assert.equal(isAnalyticsRoute(new URL(url)), false, url);
  }
});
