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
