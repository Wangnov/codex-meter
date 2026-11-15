(function () {
  'use strict';
  let pending = null;
  const capture = ({ report, client, persist }) => {
    if (pending) return pending;
    pending = (async () => {
      if (!report?.capturedAt || !report.startDate || !report.endDate) throw new Error('请先通过主线功能读取当前报告。');
      if (!report.accountScope) throw new Error('报告账号未知，请先刷新报告后再归档。');
      const age = Date.now() - Date.parse(report.capturedAt);
      if (!Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000) throw new Error('报告超过 5 分钟，请先刷新报告后再归档。');
      const token = client.getBootstrapToken();
      if (!token) throw new Error('请登录并刷新页面。');
      // Only the explicit archive command calls these endpoints. No refresh hook.
      const [usage, percentageData] = await Promise.all([
        client.apiGet('/backend-api/wham/usage', token),
        client.apiGet(`/backend-api/wham/usage/daily-token-usage-breakdown?start_date=${encodeURIComponent(report.startDate)}&end_date=${encodeURIComponent(report.endDate)}&group_by=day`, token),
      ]);
      if (!usage?.account_id || !usage?.user_id) throw new Error('无法识别账号，未归档。');
      const scope = `${usage.account_id}:${usage.user_id}`;
      if (!report.accountScope || report.accountScope !== scope) throw new Error('报告账号未知或已切换，请先刷新报告后再归档。');
      if (percentageData?.units !== 'percent' || percentageData?.group_by !== 'day') throw new Error('百分比接口单位或粒度不匹配，未归档。');
      await persist({ ...report, sourceCapturedAt: report.capturedAt, capturedAt: new Date().toISOString(), percentageData });
    })().finally(() => { pending = null; });
    return pending;
  };
  window.CodexMeterQuotaArchiveService = { capture };
})();
