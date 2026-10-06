(function () {
  "use strict";

  const n = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const localDate = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const utcDate = (date = new Date()) => date.toISOString().split("T")[0];

  const addDays = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const tokenTotal = (obj = {}) =>
    n(obj.text_total_tokens) ||
    n(obj.cached_text_input_tokens) +
      n(obj.uncached_text_input_tokens) +
      n(obj.text_output_tokens);

  const tokenInput = (obj = {}) =>
    n(obj.cached_text_input_tokens) + n(obj.uncached_text_input_tokens);

  const chartMetricValue = (totals = {}, metric) => {
    if (metric === "tokens") return tokenTotal(totals);
    if (metric === "credits" || metric === "usd") return n(totals.credits);
    if (metric === "turns") return n(totals.turns);
    return 0;
  };

  const chartValueTolerance = (value) =>
    Math.max(1e-9, Math.abs(n(value)) * 1e-12);

  const addChartSeriesValue = (seriesByKey, key, label, value) => {
    const amount = n(value);
    if (!(amount > 0)) return;
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      const current = seriesByKey.get("unclassified");
      seriesByKey.set("unclassified", {
        key: "unclassified",
        label: "",
        value: n(current?.value) + amount,
      });
      return;
    }
    const current = seriesByKey.get(normalizedKey);
    seriesByKey.set(normalizedKey, {
      key: normalizedKey,
      label:
        normalizedKey === "unclassified"
          ? ""
          : current?.label || String(label || normalizedKey),
      value: n(current?.value) + amount,
    });
  };

  const chartSeries = (row = {}, metric, grouping) => {
    const totals = row.totals || {};
    const total = chartMetricValue(totals, metric);
    if (grouping === "total") {
      return total > 0 ? [{ key: "total", label: "", value: total }] : [];
    }

    const seriesByKey = new Map();
    if (grouping === "models" || grouping === "clients") {
      const entries = Array.isArray(row[grouping]) ? row[grouping] : [];
      const identityField = grouping === "models" ? "model" : "client_id";
      entries.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const identity = entry[identityField];
        addChartSeriesValue(seriesByKey, identity, identity, chartMetricValue(entry, metric));
      });
    } else if (grouping === "tokens" && metric === "tokens") {
      addChartSeriesValue(
        seriesByKey,
        "uncachedInput",
        "Uncached input",
        totals.uncached_text_input_tokens,
      );
      addChartSeriesValue(
        seriesByKey,
        "cachedInput",
        "Cached input",
        totals.cached_text_input_tokens,
      );
      addChartSeriesValue(seriesByKey, "output", "Output", totals.text_output_tokens);
    }

    const groupedTotal = [...seriesByKey.values()].reduce(
      (sum, series) => sum + n(series.value),
      0,
    );
    const residual = total - groupedTotal;
    if (residual > chartValueTolerance(total)) {
      addChartSeriesValue(seriesByKey, "unclassified", "", residual);
    }
    return [...seriesByKey.values()];
  };

  const chartSummary = (rows = [], metric, grouping) => {
    const seriesByKey = new Map();
    let reportedTotal = 0;
    let hasMismatch = false;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const reportedValue = chartMetricValue(row?.totals || {}, metric);
      const dailySeries = chartSeries(row, metric, grouping);
      const dailySeriesTotal = dailySeries.reduce(
        (sum, series) => sum + n(series.value),
        0,
      );
      reportedTotal += reportedValue;
      if (dailySeriesTotal - reportedValue > chartValueTolerance(reportedValue)) {
        hasMismatch = true;
      }
      dailySeries.forEach((series) => {
        addChartSeriesValue(seriesByKey, series.key, series.label, series.value);
      });
    });
    const total = [...seriesByKey.values()].reduce(
      (sum, series) => sum + n(series.value),
      0,
    );
    const series = [...seriesByKey.values()]
      .map((item) => ({
        ...item,
        share: total > 0 ? item.value / total : 0,
      }))
      .sort((a, b) => {
        const valueDelta = b.value - a.value;
        if (valueDelta !== 0) return valueDelta;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
    return { series, total, reportedTotal, hasMismatch };
  };

  const cacheRatio = (obj = {}) => {
    const cached = n(obj.cached_text_input_tokens);
    const input = tokenInput(obj);
    return input > 0 ? cached / input : 0;
  };

  const formatNumber = (value, locale, digits = 2) => {
    const num = n(value);
    if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(digits)}B`;
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(digits)}M`;
    if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(digits)}K`;
    return num.toLocaleString(locale || undefined);
  };

  const formatCredits = (value, digits = 3) => n(value).toFixed(digits);

  const formatUsd = (credits, usdPerCredit) =>
    `$ ${(n(credits) * n(usdPerCredit)).toFixed(2)}`;

  const normalizeLimitWindow = (value, path, { labelFromPath, locale } = {}) => {
    const usedPercent =
      value.used_percent != null
        ? n(value.used_percent)
        : value.remaining_percent != null
          ? Math.max(0, 100 - n(value.remaining_percent))
          : null;
    const remainingPercent =
      value.remaining_percent != null
        ? n(value.remaining_percent)
        : usedPercent != null
          ? Math.max(0, 100 - usedPercent)
          : null;
    const resetAt = n(value.reset_at);
    const seconds = n(value.limit_window_seconds);
    const cycleStart =
      resetAt > 0 && seconds > 0 ? utcDate(new Date((resetAt - seconds) * 1000)) : null;

    return {
      key: path.join("."),
      label: labelFromPath?.(path) || path.join("."),
      usedPercent,
      remainingPercent,
      resetAt: resetAt || null,
      resetAtIso: resetAt ? new Date(resetAt * 1000).toISOString() : null,
      resetAtLocal: resetAt ? new Date(resetAt * 1000).toLocaleString(locale || undefined) : null,
      limitWindowSeconds: seconds || null,
      cycleStart,
      raw: {
        limit: value.limit ?? null,
        used: value.used ?? null,
        remaining: value.remaining ?? null,
      },
    };
  };

  const extractLimitWindows = (root, options = {}) => {
    const windows = [];
    const seen = new Set();

    const visit = (value, path = []) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const looksLikeWindow =
        value.reset_at != null &&
        value.limit_window_seconds != null &&
        (value.used_percent != null ||
          value.remaining_percent != null ||
          value.limit != null ||
          value.remaining != null);

      if (looksLikeWindow) {
        const key = path.join(".");
        if (!seen.has(key)) {
          seen.add(key);
          windows.push(normalizeLimitWindow(value, path, options));
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === "object") visit(child, [...path, key]);
      }
    };

    visit(root, []);
    return windows.sort((a, b) => {
      const secondsDelta = n(b.limitWindowSeconds) - n(a.limitWindowSeconds);
      if (secondsDelta !== 0) return secondsDelta;
      return a.label.localeCompare(b.label);
    });
  };

  const getStats = (list) => {
    const totals = list.reduce(
      (sum, row) => {
        const rowTotals = row.totals || {};
        sum.credits += n(rowTotals.credits);
        sum.turns += n(rowTotals.turns);
        sum.threads += n(rowTotals.threads);
        sum.tokens += tokenTotal(rowTotals);
        sum.inputTokens += tokenInput(rowTotals);
        sum.cachedInputTokens += n(rowTotals.cached_text_input_tokens);
        sum.uncachedInputTokens += n(rowTotals.uncached_text_input_tokens);
        sum.outputTokens += n(rowTotals.text_output_tokens);
        sum.unclassifiedTokens += Math.max(
          0,
          tokenTotal(rowTotals) -
            n(rowTotals.cached_text_input_tokens) -
            n(rowTotals.uncached_text_input_tokens) -
            n(rowTotals.text_output_tokens),
        );
        return sum;
      },
      {
        credits: 0,
        turns: 0,
        threads: 0,
        tokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        unclassifiedTokens: 0,
      },
    );
    totals.cacheRatio = totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0;
    totals.creditsPerMillionTokens =
      totals.tokens > 0 ? totals.credits / (totals.tokens / 1e6) : 0;
    return totals;
  };

  const compactReport = (report) => ({
    id: report.id,
    capturedAt: report.capturedAt,
    capturedAtLocal: report.capturedAtLocal,
    pageUrl: report.pageUrl,
    startDate: report.startDate,
    endDate: report.endDate,
    cycleStartDate: report.cycleStartDate,
    windows: report.windows,
    primaryWindow: report.primaryWindow,
    currentStats: report.currentStats,
    historyStats: report.historyStats,
    totalStats: report.totalStats,
    currentCycleList: report.currentCycleList,
    historyList: report.historyList,
    dailyList: report.dailyList,
  });

  window.CodexMeterDomain = {
    addDays,
    cacheRatio,
    chartMetricValue,
    chartSeries,
    chartSummary,
    compactReport,
    extractLimitWindows,
    formatCredits,
    formatNumber,
    formatUsd,
    getStats,
    localDate,
    n,
    tokenInput,
    tokenTotal,
    utcDate,
  };
})();
