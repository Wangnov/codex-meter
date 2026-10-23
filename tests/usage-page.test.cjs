const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { window: {}, Intl, Date };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../codex-meter-extension/infrastructure/usage-page.js"), "utf8"), sandbox);
const parse = (...args) => JSON.parse(JSON.stringify(sandbox.window.CodexMeterUsagePage.parseDateRange(...args)));

test("读取官方完整日期范围，不受7天和30天按钮干扰", () => {
  assert.deepEqual(parse("2026/9/30 – 2026/10/6", "zh-CN"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("2026/9/7 – 2026/10/6", "zh-CN"), { startDate: "2026-09-07", endDate: "2026-10-06" });
});

test("根据页面locale区分日月顺序，并接受跨年历史时段", () => {
  assert.deepEqual(parse("9/30/2026 – 10/6/2026", "en-US"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("30/09/2026 – 06/10/2026", "fr-FR"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("30.09.2026 – 06.10.2026", "de-DE"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("2025-12-28 – 2026-01-03"), { startDate: "2025-12-28", endDate: "2026-01-03" });
});

test("拒绝溢出日期、倒序区间、单日tooltip和不完整坐标轴", () => {
  for (const input of ["2026/2/30 – 2026/3/6", "2026/10/6 – 2026/9/30", "2026/10/6", "9月30日 10月3日 10月6日", "", "7 天 30 天"]) {
    assert.equal(parse(input, "zh-CN"), null);
  }
});

test("月份名称日期与省略重复年份的历史范围", () => {
  assert.deepEqual(parse("Sep 30, 2026 – Oct 6, 2026", "en-US"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("Sep 30 – Oct 6, 2026", "en-US"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(parse("Dec 28 – Jan 3, 2026", "en-US"), { startDate: "2025-12-28", endDate: "2026-01-03" });
  assert.deepEqual(parse("30 sept. 2026 – 6 oct. 2026", "fr-FR"), { startDate: "2026-09-30", endDate: "2026-10-06" });
});

test("官方选中单日后仍保留完整历史区间", () => {
  const fromDay = (...args) => JSON.parse(JSON.stringify(sandbox.window.CodexMeterUsagePage.rangeFromSelectedDay(...args)));
  assert.deepEqual(fromDay("2026年9月30日", 1, 7, "zh-CN"), { startDate: "2026-09-30", endDate: "2026-10-06" });
  assert.deepEqual(fromDay("Aug 20, 2026", 13, 30, "en-US"), { startDate: "2026-08-08", endDate: "2026-09-06" });
  assert.deepEqual(fromDay("2 janv. 2026", 6, 7, "fr-FR"), { startDate: "2025-12-28", endDate: "2026-01-03" });
  assert.equal(fromDay("2026/9/30 – 2026/10/6", 1, 7, "zh-CN"), null);
  assert.equal(fromDay("2026年9月30日", 0, 7, "zh-CN"), null);
});
