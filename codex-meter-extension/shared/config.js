(function () {
  "use strict";

  const CONFIG = {
    USD_PER_CREDIT: 40 / 1000,
    LOOKBACK_DAYS: 45,
    MAX_SNAPSHOTS: 180,
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
    analyticsPath: "/codex/cloud/settings/analytics",
    analyticsUrl: "https://chatgpt.com/codex/cloud/settings/analytics",
  };

  const isAnalyticsRoute = (currentLocation = window.location) =>
    currentLocation.origin === ROUTES.analyticsOrigin &&
    currentLocation.pathname === ROUTES.analyticsPath;

  window.CodexMeterConfig = {
    CONFIG,
    DEFAULT_SETTINGS,
    IDS,
    ROUTES,
    isAnalyticsRoute,
  };
})();
