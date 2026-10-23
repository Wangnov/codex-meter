(function () {
  "use strict";

  const CONFIG = {
    USD_PER_CREDIT: 40 / 1000,
    LOOKBACK_DAYS: 45,
    MAX_SNAPSHOTS: 180,
    // ChatGPT credit-equivalent rates per 1M tokens. Spark is intentionally
    // omitted because OpenAI does not publish a token rate for its separate
    // research-preview allowance.
    TOKEN_CREDIT_RATES: {
      "gpt-6-astra": { uncachedInput: 250, cachedInput: 25, output: 1250 },
      "gpt-6.1-sol": { uncachedInput: 50, cachedInput: 2.5, output: 250 },
      "gpt-6-sol": { uncachedInput: 50, cachedInput: 5, output: 250 },
      "gpt-6-luna": { uncachedInput: 2.5, cachedInput: 0.25, output: 12.5 },
      "gpt-5.6-sol": { uncachedInput: 100, cachedInput: 10, output: 500 },
      "gpt-5.6-terra": { uncachedInput: 50, cachedInput: 5, output: 300 },
      "gpt-5.6-luna": { uncachedInput: 5, cachedInput: 0.5, output: 30 },
      "daybreak-blue": { uncachedInput: 100, cachedInput: 10, output: 500 },
      "daybreak-red": { uncachedInput: 312.5, cachedInput: 31.25, output: 1875 },
      "gpt-rosalind-research": { uncachedInput: 125, cachedInput: 12.5, output: 625 },
    },
    TOKEN_RATE_CARD_DATE: "2026-10-23",
    TOKEN_RATE_CARD_URL: "https://learn.chatgpt.com/docs/pricing",
    STORAGE_LATEST: "codexQuotaCompassLatest",
    STORAGE_SNAPSHOTS: "codexQuotaCompassSnapshots",
    STORAGE_SETTINGS: "codexMeterSettings",
  };

  const DEFAULT_SETTINGS = {
    showPageButton: true,
    showChartControls: true,
    defaultChartMode: "source",
  };

  const IDS = {
    button: "codex-quota-compass-button",
    overlay: "codex-meter-dialog-overlay",
    panel: "codex-quota-compass-panel",
  };

  const ROUTES = {
    analyticsOrigin: "https://chatgpt.com",
    analyticsPath: "/settings/usage",
    analyticsTab: "analytics",
    analyticsUrl: "https://chatgpt.com/settings/usage?tab=analytics",
  };

  const isAnalyticsRoute = (currentLocation = window.location) => {
    let url;
    try {
      url = currentLocation instanceof URL
        ? currentLocation
        : new URL(currentLocation.href);
    } catch {
      return false;
    }

    return (
      url.origin === ROUTES.analyticsOrigin &&
      url.pathname === ROUTES.analyticsPath &&
      url.searchParams.get("tab") === ROUTES.analyticsTab
    );
  };

  window.CodexMeterConfig = {
    CONFIG,
    DEFAULT_SETTINGS,
    IDS,
    ROUTES,
    isAnalyticsRoute,
  };
})();
