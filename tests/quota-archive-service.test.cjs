const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const window = {};
  vm.runInNewContext(fs.readFileSync('codex-meter-extension/application/quota-archive-service.js', 'utf8'), { window, Date });
  return window.CodexMeterQuotaArchiveService;
}
const report = { capturedAt: new Date().toISOString(), startDate: '2026-09-01', endDate: '2026-10-07', accountScope: 'a:u', dailyList: [] };
test('archive is explicit only, coalesces requests and preserves upstream report', async () => {
  const service = setup(); let calls = 0, saves = 0;
  const original = JSON.stringify(report);
  const client = { getBootstrapToken: () => 'fixture', apiGet: async path => {
    calls++;
    return path.endsWith('/usage') ? { account_id: 'a', user_id: 'u' } : { units: 'percent', group_by: 'day', data: [] };
  } };
  assert.equal(calls, 0);
  const args = { report, client, persist: async r => { saves++; assert.ok(r.percentageData); } };
  await Promise.all([service.capture(args), service.capture(args)]);
  assert.equal(calls, 2); assert.equal(saves, 1);
  assert.equal(JSON.stringify(report), original);
});
test('account switch and unit mismatch never persist, failure does not retry', async () => {
  for (const account of ['b', 'a']) {
    const service = setup(); let calls = 0;
    await assert.rejects(service.capture({ report, client: {
      getBootstrapToken: () => 'fixture', apiGet: async path => { calls++; return path.endsWith('/usage') ?
        { account_id: account, user_id: 'u' } : { units: 'credits', group_by: 'day' }; },
    }, persist: async () => assert.fail('must not save') }));
    assert.equal(calls, 2);
  }
});

test('stale or unscoped reports cannot silently archive', async () => {
  let calls = 0;
  const service = setup();
  await assert.rejects(service.capture({ report: { ...report, capturedAt: '2020-01-01T00:00:00Z' },
    client: { getBootstrapToken: () => 'fixture', apiGet: async () => { calls++; } }, persist: async () => assert.fail() }));
  assert.equal(calls, 0);
});
