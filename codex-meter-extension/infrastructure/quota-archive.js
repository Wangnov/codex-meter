(function () {
  'use strict';
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('codex-meter-quota-archive', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transact = async (mode, action) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', mode);
        const request = action(tx.objectStore('snapshots'));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Archive transaction aborted'));
      });
    } finally { db.close(); }
  };
  const saveReports = (reports) => transact('readwrite', store => {
    const seen = new Set();
    for (const report of reports) {
      const summary = window.CodexMeterQuotaSnapshot.summarize(report);
      if (summary && !seen.has(summary.key)) {
        seen.add(summary.key);
        const existing = store.get(summary.key);
        existing.onsuccess = () => {
          if (!existing.result) store.add(summary);
        };
      }
    }
  });
  const list = async () => (await transact('readonly', store => store.getAll()))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  window.CodexMeterQuotaArchive = { saveReports, list };
})();
