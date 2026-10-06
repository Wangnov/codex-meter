const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
function setup() {
  const window = {};
  const context = { window, indexedDB: new IDBFactory(), Date };
  for (const file of ['domain/quota-history.js', 'domain/quota-snapshot.js', 'infrastructure/quota-archive.js']) {
    vm.runInNewContext(fs.readFileSync(`codex-meter-extension/${file}`, 'utf8'), context);
  }
  return window;
}
function report(capturedAt, basis, scope = 'a:u') {
  return { capturedAt, accountScope: scope, dailyList: [{ date: '2026-09-16', totals: { credits: 2416.081 } }],
    percentageData: { units: 'percent', group_by: 'day', data: [{ date: '2026-09-16', product_surface_usage_values: { cli: 2416.081 / basis * 100 } }] } };
}
test('keeps old and new baselines for the same usage day, deduplicates and scopes accounts', async () => {
  const w = setup(), archive = w.CodexMeterQuotaArchive;
  const old = report('2026-09-22T12:51:19Z', 43508.266);
  const fresh = report('2026-10-06T12:00:00Z', 31767.032);
  await archive.saveReports([old, fresh, old, report(fresh.capturedAt, 50000, 'b:u')]);
  const rows = await archive.list();
  assert.equal(rows.length, 3);
  assert.ok(rows.some(row => Math.abs(row.basis - 43508.266) < 0.001));
  assert.ok(rows.some(row => Math.abs(row.basis - 31767.032) < 0.001));
  assert.equal(rows[0].samples[0].date, '2026-09-16');
});
test('missing percentages are unknown, not zero or fabricated quota', async () => {
  const w = setup();
  const r = report('2026-10-06T12:00:00Z', 100);
  delete r.percentageData;
  await w.CodexMeterQuotaArchive.saveReports([r]);
  const [row] = await w.CodexMeterQuotaArchive.list();
  assert.equal(row.basis, null);
  assert.equal(row.count, 0);
});
