(function () {
  "use strict";

  const { CONFIG } = window.CodexMeterConfig;
  const { compactReport } = window.CodexMeterDomain;

  const get = (keys) => chrome.storage.local.get(keys);
  const set = (value) => chrome.storage.local.set(value);

  const load = async () => {
    const data = await get([CONFIG.STORAGE_LATEST, CONFIG.STORAGE_SNAPSHOTS]);
    const latest = data[CONFIG.STORAGE_LATEST] || null;
    if (latest?.accountScope) latest.globalResets = await loadGlobalResets(latest.accountScope);
    return {
      latest,
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

  const loadGlobalResets = async (scope) => {
    if (!scope) return [];
    const data = await get([CONFIG.STORAGE_GLOBAL_RESETS]);
    const rows = data[CONFIG.STORAGE_GLOBAL_RESETS]?.[scope];
    return Array.isArray(rows) ? rows : [];
  };
  const saveGlobalResets = async (scope, rows) => {
    if (!scope) throw new Error("无法识别当前账号，请先刷新用量。");
    const data = await get([CONFIG.STORAGE_GLOBAL_RESETS]);
    await set({ [CONFIG.STORAGE_GLOBAL_RESETS]: { ...data[CONFIG.STORAGE_GLOBAL_RESETS], [scope]: rows } });
  };

  const archive = async (report) => {
    const response = await chrome.runtime.sendMessage({ type: "CQC_ARCHIVE_REPORT", report });
    if (!response?.ok) throw new Error(response?.error || "Archive failed");
  };

  window.CodexMeterReportRepository = {
    archive,
    clear,
    loadGlobalResets,
    saveGlobalResets,
    get,
    load,
    save,
    set,
  };
})();
