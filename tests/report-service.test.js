const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {} };
for (const file of ["domain/usage-domain.js", "application/report-service.js"]) {
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "codex-meter-extension", file), "utf8"),
    sandbox,
  );
}

const domain = sandbox.window.CodexMeterDomain;
const { createReportService } = sandbox.window.CodexMeterReportService;
const rates = {
  "gpt-5.6-sol": { uncachedInput: 100, cachedInput: 10, output: 500 },
};

const makeService = ({ breakdownFails = false } = {}) => {
  const requests = [];
  const chatGptClient = {
    getBootstrapToken: () => "test-token",
    apiGet: async (url) => {
      requests.push(url);
      if (url.endsWith("/wham/usage")) {
        return {
          rate_limit: {
            primary_window: {
              used_percent: 25,
              reset_at: 1788998400,
              limit_window_seconds: 604800,
            },
          },
          additional_rate_limits: [
            {
              limit_name: "GPT-5.3-Codex-Spark Weekly",
              metered_feature: "codex_bengalfox",
              rate_limit: {
                primary_window: {
                  used_percent: 10,
                  reset_at: 1788998400,
                  limit_window_seconds: 18000,
                },
                secondary_window: {
                  used_percent: 20,
                  reset_at: 1788998400,
                  limit_window_seconds: 604800,
                },
              },
            },
          ],
        };
      }
      if (url.includes("daily-workspace-user-token-usage-breakdown")) {
        if (breakdownFails) throw new Error("not available");
        return {
          data: [
            {
              date: "2026-09-09",
              models: [
                {
                  model: "gpt-5.6-sol",
                  uncached_text_input_tokens: 1_000_000,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
          ],
        };
      }
      return { data: [] };
    },
  };
  return {
    requests,
    service: createReportService({
      chatGptClient,
      config: {
        LOOKBACK_DAYS: 45,
        TOKEN_CREDIT_RATES: rates,
        TOKEN_RATE_CARD_DATE: "2026-09-09",
        TOKEN_RATE_CARD_URL: "https://learn.chatgpt.com/docs/pricing",
      },
      domain,
      getPageLocale: () => "en-US",
      pageHref: () => "https://chatgpt.com/codex/cloud/settings/analytics",
      reportRepository: { save: async () => {} },
      translate: (key) => key,
    }),
  };
};

(async () => {
  const success = makeService();
  const report = await success.service.buildReport();
  assert.ok(
    success.requests.some((url) => url.includes("daily-workspace-user-token-usage-breakdown")),
  );
  assert.equal(
    success.requests.some((url) => /\/daily-token-usage-breakdown\?/.test(url)),
    false,
  );
  assert.equal(report.modelTokenStats.models[0].model, "gpt-5.6-sol");
  assert.equal(report.modelTokenStats.totals.creditEquivalent, 100);
  assert.equal(report.customWindows.find((window) => window.kind === "short").usedPercent, 10);
  assert.equal(report.customWindows.find((window) => window.kind === "weekly").usedPercent, 20);

  const fallback = makeService({ breakdownFails: true });
  const fallbackReport = await fallback.service.buildReport();
  assert.equal(fallbackReport.tokenBreakdownList.length, 0);
  assert.equal(fallbackReport.currentModelTokenStats.models.length, 0);

  console.log("report-service tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
