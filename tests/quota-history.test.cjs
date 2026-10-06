const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({window:{}, Date});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../codex-meter-extension/domain/quota-history.js'), 'utf8'), context);
const {buildRows, parseResetTime} = context.window.CodexMeterQuotaHistory;
const input = (dates, values) => ({
  dailyList: dates.map((date,i)=>({date,totals:{credits:values[i][0]}})),
  percentageData:{units:'percent',group_by:'day',data:dates.map((date,i)=>({date,product_surface_usage_values:{cli:values[i][1]}}))},
});
test('daily ratio, zero and >100%; no double counting models',()=>{
  const data = input(['2026-09-01','2026-09-02','2026-09-03'],[[21754.135,50],[0,0],[65262.405,150]]);
  data.percentageData.data[0].models=[{credits:50}];
  const rows=buildRows(data);
  assert.equal(rows[0].fullCredits,43508.27);
  assert.equal(rows[1].fullCredits,null);
  assert.equal(rows[2].percent,150);
  assert.ok(Math.abs(rows[2].fullCredits-43508.27)<1e-8);
});
test('missing/null metrics and unexpected units never become a fabricated ratio',()=>{
  const data=input(['2026-09-01'],[[100,null]]);
  assert.equal(buildRows(data)[0].percent,null);
  data.percentageData.units='credit';
  assert.equal(buildRows(data)[0].fullCredits,null);
  delete data.percentageData;
  assert.equal(buildRows(data)[0].fullCredits,null);
});
test('UTC reset date, known events take precedence over inference; granted ignored',()=>{
  const data=input(['2026-09-01','2026-09-02','2026-09-03'],[[100,100],[50,50],[20,20]]);
  data.resetEvents=[{kind:'granted',occurred_at:'2026-09-01T00:00:00Z'},{kind:'used',occurred_at:'2026-09-02T09:00:00Z'}];
  data.globalResets=[{at:'2026-09-04T01:00:00+08:00'}];
  const rows=buildRows(data);
  assert.equal(rows[0].period,'起点未知');
  assert.match(rows[1].notes,/手动周重置/);
  assert.doesNotMatch(rows[1].notes,/此前累计/);
  assert.match(rows[2].notes,/全局重置/);
});
test('seven-day inference survives missing usage days; idle reset not used',()=>{
  const data=input(['2026-09-01','2026-09-09'],[[5,5],[6,6]]);
  data.resetEvents=[{kind:'used',occurred_at:'2026-09-01T12:00:00Z'}];
  data.primaryWindow={usedPercent:0,limitWindowSeconds:604800,resetAt:1789810353};
  const rows=buildRows(data);
  assert.equal(rows.length,9);
  assert.match(rows[7].notes,/自然周重置/);
  assert.equal(rows[1].credits,null);
});
test('timestamp accepts seconds/milliseconds/explicit timezone, rejects ambiguous/future',()=>{
  assert.equal(parseResetTime('1788743391'),parseResetTime('1788743391000'));
  assert.equal(parseResetTime('2026-09-07T09:09:51+08:00'),'2026-09-07T01:09:51.000Z');
  for (const value of ['', '2026-09-07T09:00', 'invalid', '2099-01-01T00:00:00Z']) assert.throws(()=>parseResetTime(value));
});
test('future placeholder buckets are excluded at the capture time',()=>{
  const data=input(['2026-09-12','2026-09-13'],[[0,0],[0,0]]);
  data.capturedAt='2026-09-12T10:00:00Z';
  assert.equal(buildRows(data).length,1);
});
