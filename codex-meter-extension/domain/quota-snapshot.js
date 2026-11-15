(function () {
  'use strict';
  // Independent from quota-cycle inference: historical percentages may be renormalized.
  const summarize = report => {
    if (!report?.capturedAt || !Number.isFinite(Date.parse(report.capturedAt))) return null;
    const percentages = new Map();
    if (report.percentageData?.units === 'percent' && report.percentageData?.group_by === 'day') {
      for (const row of report.percentageData.data || []) {
        const values = Object.values(row.product_surface_usage_values || {});
        if (values.length && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
          percentages.set(row.date, values.reduce((a, b) => a + b, 0));
        }
      }
    }
    const samples = (report.dailyList || []).flatMap(row => {
      const credits = row.totals?.credits, percent = percentages.get(row.date);
      const basis = credits * 100 / percent;
      return /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date <= report.capturedAt.slice(0, 10) &&
        typeof credits === 'number' && credits > 0 && percent > 0 && Number.isFinite(basis)
        ? [{ date: row.date, credits, percent, basis }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const values = samples.map(row => row.basis).sort((a, b) => a - b);
    const count = values.length;
    return {
      key: JSON.stringify([report.accountScope || 'unknown', report.capturedAt]),
      accountScope: report.accountScope || 'unknown', capturedAt: report.capturedAt,
      sourceCapturedAt: report.sourceCapturedAt || report.capturedAt,
      basis: count ? (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) / 2 : null,
      min: count ? values[0] : null, max: count ? values.at(-1) : null, count,
      startDate: samples[0]?.date || null, endDate: samples.at(-1)?.date || null, samples,
    };
  };
  window.CodexMeterQuotaSnapshot = { summarize };
})();
