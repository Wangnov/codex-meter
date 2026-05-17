(function () {
  "use strict";

  const { CONFIG } = window.CodexMeterConfig;
  const { compactReport } = window.CodexMeterDomain;

  const get = (keys) => chrome.storage.local.get(keys);
  const set = (value) => chrome.storage.local.set(value);

  const load = async () => {
    const data = await get([CONFIG.STORAGE_LATEST, CONFIG.STORAGE_SNAPSHOTS]);
    return {
      latest: data[CONFIG.STORAGE_LATEST] || null,
      snapshots: Array.isArray(data[CONFIG.STORAGE_SNAPSHOTS])
        ? data[CONFIG.STORAGE_SNAPSHOTS]
        : [],
    };
  };

  const save = async (report) => {
    const existing = await load();
    const compact = compactReport(report);
    const snapshots = [compact, ...existing.snapshots].slice(0, CONFIG.MAX_SNAPSHOTS);
    await set({
      [CONFIG.STORAGE_LATEST]: compact,
      [CONFIG.STORAGE_SNAPSHOTS]: snapshots,
    });
    return compact;
  };

  const clear = () => chrome.storage.local.remove([CONFIG.STORAGE_LATEST, CONFIG.STORAGE_SNAPSHOTS]);

  window.CodexMeterReportRepository = {
    clear,
    get,
    load,
    save,
    set,
  };
})();
