// Archive lives under the extension origin, not chatgpt.com's IndexedDB.
self.window = self;
importScripts('domain/quota-history.js', 'domain/quota-snapshot.js', 'infrastructure/quota-archive.js');
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'CQC_ARCHIVE_REPORT') return false;
  (async () => {
    const data = await chrome.storage.local.get(['codexQuotaCompassLatest', 'codexQuotaCompassSnapshots']);
    await CodexMeterQuotaArchive.saveReports([
      ...(data.codexQuotaCompassSnapshots || []), data.codexQuotaCompassLatest, message.report,
    ].filter(Boolean));
  })().then(() => reply({ ok: true }), () => reply({ ok: false, error: '额度基准历史归档失败，请导出当前数据备份。' }));
  return true;
});
