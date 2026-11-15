self.window = self;
importScripts('domain/quota-snapshot.js', 'infrastructure/quota-archive.js');
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'CQC_ARCHIVE_REPORT') return false;
  const report = message.report;
  if (!report?.accountScope || !Array.isArray(report.dailyList)) {
    reply({ ok: false, error: 'Invalid archive report' });
    return false;
  }
  CodexMeterQuotaArchive.saveReports([report])
    .then(() => reply({ ok: true }), () => reply({ ok: false, error: '本地归档失败，请检查存储并导出备份。' }));
  return true;
});
