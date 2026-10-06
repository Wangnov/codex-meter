(function () {
  "use strict";

  const createReportService = ({
    chatGptClient,
    config,
    domain,
    getPageLocale,
    pageHref,
    reportRepository,
    translate,
  }) => {
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
      const endDate = domain.localDate(domain.addDays(now, 1));
      const startDate = domain.localDate(domain.addDays(now, -config.LOOKBACK_DAYS));
      const usage = await chatGptClient.apiGet("/backend-api/wham/usage", token);
      const accountScope = usage?.account_id && usage?.user_id ? `${usage.account_id}:${usage.user_id}` : null;
      const windows = domain.extractLimitWindows(usage?.rate_limit || {}, {
        labelFromPath,
        locale: getPageLocale(),
      });
      const primaryWindow = windows[0] || null;
      const cycleStartDate = primaryWindow?.cycleStart || startDate;
      const dailyData = await chatGptClient.apiGet(
        `/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=${startDate}&end_date=${endDate}&group_by=day&workspace_user=true`,
        token,
      );
      const dailyList = Array.isArray(dailyData?.data) ? dailyData.data : [];
      const historyWarnings = [];
      const optionalGet = async (path, label) => {
        try { return await chatGptClient.apiGet(path, token); }
        catch { historyWarnings.push(`${label}读取失败；相关数据标记为未知。`); return null; }
      };
      const [percentageData, resetHistory, globalResets] = await Promise.all([
        optionalGet(`/backend-api/wham/usage/daily-token-usage-breakdown?start_date=${startDate}&end_date=${endDate}&group_by=day`, "历史百分比"),
        optionalGet("/backend-api/wham/rate-limit-reset-credits/history", "手动重置记录"),
        reportRepository.loadGlobalResets(accountScope),
      ]);
      if (percentageData && (percentageData.units !== "percent" || percentageData.group_by !== "day")) historyWarnings.push("历史接口单位或粒度不匹配，未计算百分比及折算值。");
      if (resetHistory?.next_cursor) historyWarnings.push("手动重置记录尚有后续页；周期标记可能不完整。");
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
        accountScope,
        percentageData,
        resetEvents: resetHistory?.events || [],
        resetHistoryStart: resetHistory?.window_start || null,
        globalResets,
        historyWarnings,
        currentStats: domain.getStats(currentCycleList),
        historyStats: domain.getStats(historyList),
        totalStats: domain.getStats(dailyList),
      };
    };

    const refreshReport = async () => {
      const report = await buildReport();
      if (reportRepository.archive) {
        try { await reportRepository.archive(report); }
        catch { report.historyWarnings.push("额度基准历史归档失败；请导出数据备份。"); }
      }
      try {
        await reportRepository.save(report);
      } catch {
        // A full local store must not discard successfully fetched fresh data.
        // Keep existing history intact; surface the persistence failure instead.
        report.historyWarnings = [...(report.historyWarnings || []),
          translate("storageSaveFailed")];
      }
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
