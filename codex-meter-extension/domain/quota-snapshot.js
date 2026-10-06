(function () {
  'use strict';
  const summarize = (report) => {
    if (!report?.capturedAt || !Number.isFinite(Date.parse(report.capturedAt))) return null;
    const rows = window.CodexMeterQuotaHistory.buildRows(report)
      .filter(row => Number.isFinite(row.fullCredits) && row.fullCredits > 0);
    const values = rows.map(row => row.fullCredits).sort((a, b) => a - b);
    const count = values.length;
    const median = count ? (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) / 2 : null;
    return {
      key: JSON.stringify([report.accountScope || 'unknown', report.capturedAt]),
      accountScope: report.accountScope || 'unknown', capturedAt: report.capturedAt,
      basis: median, min: count ? values[0] : null, max: count ? values.at(-1) : null,
      count, startDate: rows[0]?.date || null, endDate: rows.at(-1)?.date || null,
      samples: rows.map(({ date, credits, percent, fullCredits }) => ({ date, credits, percent, basis: fullCredits })),
    };
  };
  window.CodexMeterQuotaSnapshot = { summarize };
})();
