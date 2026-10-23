const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const configSource = fs.readFileSync(
  path.join(__dirname, "../codex-meter-extension/shared/config.js"),
  "utf8",
);

const loadConfig = (href = "https://chatgpt.com/settings/usage?tab=analytics") => {
  const window = { location: new URL(href) };
  vm.runInNewContext(configSource, { URL, window });
  return window.CodexMeterConfig;
};

test("matches the canonical ChatGPT usage analytics route", () => {
  const { ROUTES, isAnalyticsRoute } = loadConfig();

  assert.equal(ROUTES.analyticsUrl, "https://chatgpt.com/settings/usage?tab=analytics");
  assert.equal(isAnalyticsRoute(), true);
  assert.equal(isAnalyticsRoute(new URL(ROUTES.analyticsUrl)), true);
});

test("accepts unrelated query parameters while requiring tab=analytics", () => {
  const { isAnalyticsRoute } = loadConfig();

  assert.equal(
    isAnalyticsRoute(new URL("https://chatgpt.com/settings/usage?tab=analytics&range=30d")),
    true,
  );
  assert.equal(isAnalyticsRoute(new URL("https://chatgpt.com/settings/usage")), false);
  assert.equal(
    isAnalyticsRoute(new URL("https://chatgpt.com/settings/usage?tab=overview")),
    false,
  );
});

test("rejects other origins and other settings pages", () => {
  const { isAnalyticsRoute } = loadConfig();

  assert.equal(
    isAnalyticsRoute(new URL("https://example.com/settings/usage?tab=analytics")),
    false,
  );
  assert.equal(
    isAnalyticsRoute(new URL("https://chatgpt.com/settings/data-controls?tab=analytics")),
    false,
  );
  assert.equal(
    isAnalyticsRoute(new URL("https://chatgpt.com/codex/cloud/settings/analytics")),
    false,
  );
});

test("keeps the canonical no-trailing-slash path exact", () => {
  const { isAnalyticsRoute } = loadConfig();

  assert.equal(
    isAnalyticsRoute(new URL("https://chatgpt.com/settings/usage/?tab=analytics")),
    false,
  );
});

test("returns false for malformed route values", () => {
  const { isAnalyticsRoute } = loadConfig();

  assert.equal(isAnalyticsRoute("not a URL"), false);
  assert.equal(isAnalyticsRoute(null), false);
});
