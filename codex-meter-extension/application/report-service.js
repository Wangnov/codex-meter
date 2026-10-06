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

    const labelFromPath = (path) => {
      const raw = path
        .join(".")
        .replaceAll("_", " ")
        .replace(/\bwindow\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (/secondary/i.test(path.join("."))) return translate("limits.secondary");
      if (/primary/i.test(path.join("."))) return translate("limits.primary");
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
      const windows = domain.extractLimitWindows(usage?.rate_limit || {}, {
        labelFromPath,
        locale: getPageLocale(),
      });
      const primaryWindow = windows[0] || null;
      const cycleStartDate = primaryWindow?.cycleStart || startDate;
      const dailyData = await chatGptClient.apiGet(
        `/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=${startDate}&end_date=${endDate}&group_by=day`,
        token,
      );
      const dailyList = Array.isArray(dailyData?.data) ? dailyData.data : [];
      const currentCycleList = dailyList.filter(
        (item) => item?.date && new Date(`${item.date}T00:00:00`) >= new Date(`${cycleStartDate}T00:00:00`),
      );
      const historyList = dailyList.filter(
        (item) => item?.date && new Date(`${item.date}T00:00:00`) < new Date(`${cycleStartDate}T00:00:00`),
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
        primaryWindow,
        currentCycleList,
        historyList,
        dailyList,
        currentStats: domain.getStats(currentCycleList),
        historyStats: domain.getStats(historyList),
        totalStats: domain.getStats(dailyList),
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
