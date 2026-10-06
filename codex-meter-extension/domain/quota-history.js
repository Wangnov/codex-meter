(function () {
  "use strict";
  const DAY = 86400000;
  const dateKey = (value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  };
  const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

  // Keep server date keys in UTC. Never split a daily bucket around a reset.
  const buildRows = ({ dailyList = [], percentageData, resetEvents = [], globalResets = [], primaryWindow, capturedAt }) => {
    const percentages = new Map();
    if (percentageData?.units === "percent" && percentageData?.group_by === "day") {
      for (const row of percentageData.data || []) {
        const values = Object.values(row.product_surface_usage_values || {});
        percentages.set(row.date, values.length && values.every(finite)
          ? values.reduce((sum, value) => sum + value, 0) : null);
      }
    }
    const credits = new Map(dailyList.map(row => [row.date, finite(row.totals?.credits) ? row.totals.credits : null]));
    const markers = new Map();
    const addMarker = (date, label) => {
      if (date) markers.set(date, [...(markers.get(date) || []), label]);
    };
    resetEvents.filter(event => event.kind === "used").forEach(event => addMarker(dateKey(event.occurred_at), "手动周重置"));
    globalResets.forEach(event => addMarker(dateKey(event.at), "全局重置（自记）"));
    if (primaryWindow?.usedPercent > 0 && finite(primaryWindow.resetAt) && primaryWindow.resetAt > 0 && primaryWindow.limitWindowSeconds === 604800) {
      addMarker(dateKey(new Date((primaryWindow.resetAt - 604800) * 1000).toISOString()), "当前窗口起点（推算）");
    }
    const ceiling = dateKey(capturedAt || new Date().toISOString());
    const dates = [...new Set([...credits.keys(), ...percentages.keys()])].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= ceiling).sort();
    if (!dates.length) return [];
    const rows = [];
    let start = null, accumulated = 0, crossed = false, period = 0;
    // Include zero/missing-usage days and reset days so a boundary cannot disappear.
    const first = Date.parse(dates[0]), last = Date.parse(dates.at(-1));
    for (let ms = first; ms <= last; ms += DAY) {
      const date = dateKey(new Date(ms).toISOString());
      const notes = [...new Set(markers.get(date) || [])];
      if (notes.length) {
        start = ms; accumulated = 0; crossed = false; period += 1;
        notes.push("当日可能跨周期");
      } else if (start != null && ms - start >= 7 * DAY) {
        start = ms; accumulated = 0; crossed = false; period += 1;
        notes.push("自然周重置？按上个起点 +7天");
      } else if (crossed) {
        start = ms; accumulated = 0; crossed = false; period += 1;
        notes.push("可能重置：此前累计已达100%");
      }
      const percent = percentages.get(date) ?? null;
      const credit = credits.get(date) ?? null;
      if (percent != null) accumulated += percent;
      if (accumulated >= 100) crossed = true;
      rows.push({date, credits: credit, percent,
        fullCredits: credit != null && credit > 0 && percent != null && percent > 0 ? credit * 100 / percent : null,
        period: period ? `约周期 ${period} · ${dateKey(new Date(start).toISOString())} 起` : "起点未知",
        notes: notes.join("；")});
    }
    return rows;
  };
  const parseResetTime = (text) => {
    const value = String(text).trim();
    let ms;
    if (/^\d{10}$/.test(value)) ms = Number(value) * 1000;
    else if (/^\d{13}$/.test(value)) ms = Number(value);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms > Date.now()) throw new Error("请输入过去的 Unix 秒/毫秒时间戳，或带时区的 ISO 时间。");
    return new Date(ms).toISOString();
  };
  window.CodexMeterQuotaHistory = { buildRows, parseResetTime };
})();
