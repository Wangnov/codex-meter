(function () {
  "use strict";

  const createReportService = ({
    chatGptClient,
    config,
    domain,
    getDateRange,
    getPageLocale,
    pageHref,
    reportRepository,
    translate,
  }) => {
    const parseIsoDate = (value) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
      return date;
    };

    const selectedRequestRange = async (today) => {
      if (typeof getDateRange !== "function") return null;

      let selected;
      try {
        selected = await getDateRange();
      } catch {
        return null;
      }

      const selectedStart = parseIsoDate(selected?.startDate);
      const selectedEnd = parseIsoDate(selected?.endDate);
      if (
        !selectedStart ||
        !selectedEnd ||
        selected.startDate > selected.endDate ||
        selected.startDate > today ||
        selected.endDate > today
      ) {
        return null;
      }

      selectedEnd.setUTCDate(selectedEnd.getUTCDate() + 1);
      return {
        startDate: selected.startDate,
        endDate: selectedEnd.toISOString().slice(0, 10),
      };
    };

    const labelFromPath = (path, window) => {
      const seconds = Number(window?.limit_window_seconds);
      if (seconds === 604800) return translate("limits.primary");
      if (seconds === 18000) return translate("limits.secondary");
      const raw = path
        .join(".")
        .replaceAll("_", " ")
        .replace(/\bwindow\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      return raw || translate("limits.fallback");
    };

    const buildReport = async () => {
      const token = chatGptClient.getBootstrapToken();
      if (!token) throw new Error(translate("noToken"));

      const now = new Date();
      const defaultEndDate = domain.localDate(domain.addDays(now, 1));
      const defaultStartDate = domain.localDate(domain.addDays(now, -config.LOOKBACK_DAYS));
      const selectedRange = await selectedRequestRange(domain.localDate(now));
      const startDate =
        selectedRange?.startDate < defaultStartDate ? selectedRange.startDate : defaultStartDate;
      const endDate =
        selectedRange?.endDate > defaultEndDate ? selectedRange.endDate : defaultEndDate;
      const usage = await chatGptClient.apiGet("/backend-api/wham/usage", token);
      const windows = domain.extractOrdinaryLimitWindows(usage?.rate_limit || {}, {
        labelFromPath,
        locale: getPageLocale(),
      });
      const customWindows = domain.extractAdditionalLimitWindows(usage?.additional_rate_limits, {
        labelFromPath,
        locale: getPageLocale(),
      });
      const primaryWindow =
        windows.find(
          (window) =>
            Number(window?.limitWindowSeconds) >= 6 * 24 * 60 * 60 &&
            !/spark/i.test(`${window?.key || ""} ${window?.label || ""}`),
        ) ||
        windows[0] ||
        null;
      const cycleStartDate = primaryWindow?.cycleStart || startDate;
      const [dailyData, tokenBreakdownData] = await Promise.all([
        chatGptClient.apiGet(
          `/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=${startDate}&end_date=${endDate}&group_by=day`,
          token,
        ),
        chatGptClient
          .apiGet(
            `/backend-api/wham/usage/daily-workspace-user-token-usage-breakdown?start_date=${startDate}&end_date=${endDate}&group_by=day`,
            token,
          )
          .catch(() => null),
      ]);
      const dailyList = Array.isArray(dailyData?.data) ? dailyData.data : [];
      const tokenBreakdownList = Array.isArray(tokenBreakdownData?.data) ? tokenBreakdownData.data : [];
      const currentCycleList = dailyList.filter(
        (item) => item?.date && new Date(`${item.date}T00:00:00`) >= new Date(`${cycleStartDate}T00:00:00`),
      );
      const historyList = dailyList.filter(
        (item) => item?.date && new Date(`${item.date}T00:00:00`) < new Date(`${cycleStartDate}T00:00:00`),
      );
      const currentTokenBreakdownList = tokenBreakdownList.filter(
        (item) => item?.date && new Date(`${item.date}T00:00:00`) >= new Date(`${cycleStartDate}T00:00:00`),
      );

      return {
        id: `${Date.now()}`,
        capturedAt: now.toISOString(),
        capturedAtLocal: now.toLocaleString(getPageLocale()),
        pageUrl: pageHref(),
        startDate,
        endDate,
        cycleStartDate,
        windows,
        customWindows,
        primaryWindow,
        currentCycleList,
        historyList,
        dailyList,
        tokenBreakdownList,
        currentTokenBreakdownList,
        currentStats: domain.getStats(currentCycleList),
        historyStats: domain.getStats(historyList),
        totalStats: domain.getStats(dailyList),
        currentModelTokenStats: domain.getModelTokenStats(
          currentTokenBreakdownList,
          config.TOKEN_CREDIT_RATES,
        ),
        modelTokenStats: domain.getModelTokenStats(tokenBreakdownList, config.TOKEN_CREDIT_RATES),
        tokenRateCardDate: config.TOKEN_RATE_CARD_DATE,
        tokenRateCardUrl: config.TOKEN_RATE_CARD_URL,
      };
    };

    const refreshReport = async () => {
      const report = await buildReport();
      await reportRepository.save(report);
      return report;
    };

    return {
      buildReport,
      refreshReport,
    };
  };

  window.CodexMeterReportService = {
    createReportService,
  };
})();
