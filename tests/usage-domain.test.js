const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "codex-meter-extension", "domain", "usage-domain.js"), "utf8"),
  sandbox,
);

const {
  compactReport,
  extractAdditionalLimitWindows,
  extractOrdinaryLimitWindows,
  getModelTokenStats,
} = sandbox.window.CodexMeterDomain;
const rates = {
  "gpt-5.6-sol": { uncachedInput: 100, cachedInput: 10, output: 500 },
};

const report = getModelTokenStats(
  [
    {
      date: "2026-09-08",
      models: [
        {
          model: "gpt-5.6-sol",
          uncached_text_input_tokens: 1_000_000,
          cached_text_input_tokens: 2_000_000,
          text_output_tokens: 100_000,
          text_total_tokens: 3_100_000,
        },
        {
          model: "gpt-5.3-codex-spark",
          uncached_text_input_tokens: 500_000,
          cached_text_input_tokens: 0,
          text_output_tokens: 0,
          text_total_tokens: 500_000,
        },
      ],
    },
    {
      date: "2026-09-09",
      models: [
        {
          model: "gpt-5.6-sol",
          uncached_text_input_tokens: 500_000,
          cached_text_input_tokens: 0,
          text_output_tokens: 100_000,
        },
        {
          model: "unknown-model",
          uncached_text_input_tokens: 400_000,
          cached_text_input_tokens: 0,
          text_output_tokens: 0,
        },
      ],
    },
  ],
  rates,
);

assert.equal(report.models.length, 3);
assert.equal(report.models[0].model, "gpt-5.6-sol");
assert.equal(report.models[0].tokens, 3_700_000);
assert.equal(report.models[0].creditEquivalent, 270);
assert.equal(report.models.find((model) => model.separateQuota).creditEquivalent, 0);
assert.equal(report.totals.tokens, 4_600_000);
assert.equal(report.totals.separateQuotaTokens, 500_000);
assert.equal(report.totals.ratedTokens, 3_700_000);
assert.ok(Math.abs(report.totals.rateCoverage - 3_700_000 / 4_100_000) < 1e-12);

const compact = compactReport({
  customWindows: [{ source: "spark", kind: "weekly", remainingPercent: 80 }],
  tokenBreakdownList: [{ date: "2026-09-09", models: [{ model: "gpt-5.6-sol" }] }],
  currentTokenBreakdownList: [{ date: "2026-09-09", models: [{ model: "gpt-5.6-sol" }] }],
  modelTokenStats: report,
  currentModelTokenStats: report,
});
assert.equal("tokenBreakdownList" in compact, false);
assert.equal("currentTokenBreakdownList" in compact, false);
assert.equal(compact.currentModelTokenStats.totals.creditEquivalent, 270);
assert.equal(compact.customWindows[0].source, "spark");

const windowValue = (seconds, usedPercent) => ({
  reset_at: 1788998400,
  limit_window_seconds: seconds,
  used_percent: usedPercent,
});
const ordinaryWindows = extractOrdinaryLimitWindows({
  primary_window: windowValue(5 * 60 * 60, 44),
  secondary_window: windowValue(7 * 24 * 60 * 60, 22),
});
assert.equal(ordinaryWindows.find((window) => window.key === "primary_window").usedPercent, 44);
assert.equal(ordinaryWindows.find((window) => window.key === "secondary_window").usedPercent, 22);

const sparkWindows = extractAdditionalLimitWindows([
  {
    limit_name: "GPT-5.3-Codex-Spark Weekly",
    metered_feature: "codex_bengalfox",
    rate_limit: {
      primary_window: windowValue(5 * 60 * 60, 12),
      secondary_window: windowValue(7 * 24 * 60 * 60, 20),
    },
  },
]);
assert.equal(sparkWindows.length, 2);
assert.equal(sparkWindows.find((window) => window.kind === "short").usedPercent, 12);
assert.equal(sparkWindows.find((window) => window.kind === "weekly").usedPercent, 20);
assert.equal(sparkWindows.every((window) => window.source === "spark"), true);

console.log("usage-domain tests passed");
