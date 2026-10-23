const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the selectors used by the actual summary cards, including old snapshots.
const source = fs.readFileSync(path.join(__dirname, "../codex-meter-extension/content.js"), "utf8");
const selectors = source.slice(source.indexOf("  const weeklyLimitWindow ="), source.indexOf("  const renderQuotaCard ="));
const sandbox = { n: (value) => Number(value) || 0 };
vm.runInNewContext(`${selectors}\nthis.select = { weeklyLimitWindow, shortLimitWindow, sparkLimitWindow };`, sandbox);
const { weeklyLimitWindow, shortLimitWindow, sparkLimitWindow } = sandbox.select;
const weekly = { key: "secondary_window", role: "secondary", label: "secondary", limitWindowSeconds: 604800, usedPercent: 22 };
const primary = { key: "primary_window", role: "primary", limitWindowSeconds: 18000, usedPercent: 44 };
const report = { windows: [weekly, primary], primaryWindow: weekly };
assert.equal(weeklyLimitWindow(report), weekly);
assert.equal(shortLimitWindow(report), primary, "ordinary primary 5h must populate the 5h card");
const short = { ...primary, key: "tertiary_window", role: "tertiary" };
assert.equal(shortLimitWindow({ windows: [weekly, short] }), short);
assert.equal(weeklyLimitWindow({ windows: [short], primaryWindow: short }), null, "short fallback must not populate weekly quota");
assert.equal(shortLimitWindow({ windows: [{ key: "secondary_window" }] }), null);
const spark = { source: "spark", kind: "short", limitWindowSeconds: 18000, usedPercent: 12 };
assert.equal(sparkLimitWindow({ ...report, customWindows: [spark] }, "short"), spark);
assert.equal(
  shortLimitWindow({ ...report, customWindows: [spark] }),
  primary,
  "Spark 5h must not replace the ordinary Codex 5h card",
);
console.log("quota selection tests passed");
