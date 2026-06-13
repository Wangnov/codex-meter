(function () {
  "use strict";

  const { CONFIG, DEFAULT_SETTINGS, ROUTES } = window.CodexMeterConfig;
  const domain = window.CodexMeterDomain;
  const reportRepository = window.CodexMeterReportRepository;

  const $ = (selector) => document.querySelector(selector);
  const icon = (name, className = "cqc-icon", label = "") =>
    window.CQCIcons?.icon(name, className, label) || "";

  const MESSAGES = {
    "zh-CN": {
      subtitle: "页面内功能管理",
      sections: {
        display: "页面显示",
        chart: "默认图表",
        local: "本地快照",
      },
      settings: {
        pageButton: {
          title: "页面内按钮",
          hint: "在使用详情旁显示 Codex Meter 入口。",
        },
        chartControls: {
          title: "图表控制",
          hint: "在官方图表旁显示 Meter 切换和指标菜单。",
        },
      },
      chart: {
        source: "官方",
        meter: "Meter",
      },
      snapshot: {
        latest: "最近更新",
        count: "历史快照",
        countValue: "{count} 条",
      },
      status: {
        loading: "读取本地状态...",
        ready: "管理设置已同步。",
        saved: "设置已同步。",
        noSnapshot: "还没有本地快照。",
        updated: "最近快照：{time}",
        openFirst: "请先切到 ChatGPT Codex analytics 标签页。",
        reading: "正在读取当前页面数据...",
        noResponse: "页面没有响应",
        cleared: "本地快照已清空。",
      },
      actions: {
        open: "打开页面",
        panel: "打开面板",
        refresh: "刷新",
        exportJson: "导出 JSON",
        clear: "清空历史",
      },
      confirmClear: "清空所有本地快照？",
    },
    "en-US": {
      subtitle: "In-page feature controls",
      sections: {
        display: "Page Display",
        chart: "Default Chart",
        local: "Local Snapshots",
      },
      settings: {
        pageButton: {
          title: "In-page button",
          hint: "Show the Codex Meter entry beside usage details.",
        },
        chartControls: {
          title: "Chart controls",
          hint: "Show the Meter switch and metric menu beside the official chart.",
        },
      },
      chart: {
        source: "Official",
        meter: "Meter",
      },
      snapshot: {
        latest: "Last updated",
        count: "Snapshot history",
        countValue: "{count} saved",
      },
      status: {
        loading: "Reading local state...",
        ready: "Controls synced.",
        saved: "Settings synced.",
        noSnapshot: "No local snapshot yet.",
        updated: "Latest snapshot: {time}",
        openFirst: "Switch to the ChatGPT Codex analytics tab first.",
        reading: "Reading data from the current page...",
        noResponse: "The page did not respond",
        cleared: "Local snapshots cleared.",
      },
      actions: {
        open: "Open Page",
        panel: "Open Panel",
        refresh: "Refresh",
        exportJson: "Export JSON",
        clear: "Clear History",
      },
      confirmClear: "Clear all local snapshots?",
    },
  };

  const LOCALE_ALIASES = {
    en: "en-US",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-hans-cn": "zh-CN",
  };

  const normalizeLocale = (locale) => {
    const normalized = String(locale || "").trim().replaceAll("_", "-").toLowerCase();
    if (MESSAGES[LOCALE_ALIASES[normalized]]) return LOCALE_ALIASES[normalized];
    const language = normalized.split("-")[0];
    return MESSAGES[LOCALE_ALIASES[language]] ? LOCALE_ALIASES[language] : "en-US";
  };

  const locale = normalizeLocale(navigator.languages?.[0] || navigator.language);

  const messageValue = (key) =>
    key.split(".").reduce((value, part) => value?.[part], MESSAGES[locale]) ??
    key.split(".").reduce((value, part) => value?.[part], MESSAGES["en-US"]) ??
    key;

  const t = (key, vars = {}) =>
    String(messageValue(key)).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const isValidChartMode = (mode) => mode === "source" || mode === "meter";

  const normalizeSettings = (settings = {}) => ({
    ...DEFAULT_SETTINGS,
    ...settings,
    defaultChartMode: isValidChartMode(settings.defaultChartMode)
      ? settings.defaultChartMode
      : DEFAULT_SETTINGS.defaultChartMode,
  });

  const setStatus = (message, kind = "info") => {
    const el = $("#status");
    el.innerHTML = `${icon(kind === "error" ? "alert" : kind === "loading" ? "loader" : "check")}<span>${escapeHtml(message)}</span>`;
    el.dataset.kind = kind;
  };

  const loadSettings = async () => {
    const data = await chrome.storage.local.get(CONFIG.STORAGE_SETTINGS);
    return normalizeSettings(data[CONFIG.STORAGE_SETTINGS]);
  };

  const saveSettings = async (patch) => {
    const current = await loadSettings();
    const next = normalizeSettings({ ...current, ...patch });
    await chrome.storage.local.set({ [CONFIG.STORAGE_SETTINGS]: next });
    renderSettings(next);
    setStatus(t("status.saved"));
  };

  const loadState = async () => {
    setStatus(t("status.loading"), "loading");
    const [settings, data] = await Promise.all([loadSettings(), reportRepository.load()]);
    renderSettings(settings);
    renderSnapshots(data.latest, data.snapshots);
    setStatus(data.latest ? t("status.updated", { time: data.latest.capturedAtLocal || data.latest.capturedAt }) : t("status.noSnapshot"));
  };

  const renderSettings = (settings) => {
    $("#showPageButton").checked = Boolean(settings.showPageButton);
    $("#showChartControls").checked = Boolean(settings.showChartControls);
    document.querySelectorAll("[data-chart-mode]").forEach((button) => {
      const active = button.dataset.chartMode === settings.defaultChartMode;
      button.dataset.active = active ? "true" : "false";
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
  };

  const renderSnapshots = (latest, snapshots) => {
    $("#latestSnapshot").textContent = latest?.capturedAtLocal || latest?.capturedAt || "--";
    $("#snapshotCount").textContent = t("snapshot.countValue", {
      count: Array.isArray(snapshots) ? snapshots.length : 0,
    });
  };

  const decorateStaticContent = () => {
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-icon]").forEach((slot) => {
      slot.innerHTML = icon(slot.dataset.icon);
    });
    $("#brandIcon").innerHTML = icon("gauge");
    $("#refresh").title = t("actions.refresh");
    $("#refresh").setAttribute("aria-label", t("actions.refresh"));
    $("#exportJson").title = t("actions.exportJson");
    $("#exportJson").setAttribute("aria-label", t("actions.exportJson"));
    $("#clearHistory").title = t("actions.clear");
    $("#clearHistory").setAttribute("aria-label", t("actions.clear"));
  };

  const activeTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  };

  const isAnalyticsUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === ROUTES.analyticsOrigin && parsed.pathname === ROUTES.analyticsPath;
    } catch {
      return false;
    }
  };

  const runActiveAnalysis = async ({ openPanel = false } = {}) => {
    const tab = await activeTab();
    if (!tab?.id || !isAnalyticsUrl(tab.url)) {
      setStatus(t("status.openFirst"), "error");
      return;
    }

    setStatus(t("status.reading"), "loading");
    try {
      let response = await sendRefreshMessage(tab.id, openPanel);
      if (!response?.ok && /Receiving end does not exist|Could not establish connection/i.test(response?.error || "")) {
        await injectIntoTab(tab.id);
        response = await sendRefreshMessage(tab.id, openPanel);
      }
      if (!response?.ok) throw new Error(response?.error || t("status.noResponse"));
      await loadState();
    } catch (error) {
      setStatus(error.message || String(error), "error");
    }
  };

  const sendRefreshMessage = async (tabId, openPanel) => {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: "CQC_RUN_ANALYSIS",
        openPanel,
      });
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  };

  const injectIntoTab = async (tabId) => {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "icons.js",
        "shared/config.js",
        "domain/usage-domain.js",
        "infrastructure/chatgpt-client.js",
        "infrastructure/report-repository.js",
        "application/report-service.js",
        "content.js",
      ],
    });
  };

  const openAnalytics = () => {
    chrome.tabs.create({ url: ROUTES.analyticsUrl });
  };

  const exportJson = async () => {
    const data = await reportRepository.load();
    downloadText(
      `codex-meter-snapshots-${domain.localDate()}.json`,
      JSON.stringify({
        [CONFIG.STORAGE_LATEST]: data.latest,
        [CONFIG.STORAGE_SNAPSHOTS]: data.snapshots,
      }, null, 2),
      "application/json",
    );
  };

  const clearHistory = async () => {
    if (!window.confirm(t("confirmClear"))) return;
    await reportRepository.clear();
    renderSnapshots(null, []);
    setStatus(t("status.cleared"));
  };

  const downloadText = (filename, text, type) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $("#showPageButton").addEventListener("change", (event) => {
    saveSettings({ showPageButton: event.target.checked }).catch((error) => {
      setStatus(error.message || String(error), "error");
    });
  });

  $("#showChartControls").addEventListener("change", (event) => {
    saveSettings({ showChartControls: event.target.checked }).catch((error) => {
      setStatus(error.message || String(error), "error");
    });
  });

  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      saveSettings({ defaultChartMode: button.dataset.chartMode }).catch((error) => {
        setStatus(error.message || String(error), "error");
      });
    });
  });

  $("#openAnalytics").addEventListener("click", openAnalytics);
  $("#openPanel").addEventListener("click", () => runActiveAnalysis({ openPanel: true }));
  $("#refresh").addEventListener("click", () => runActiveAnalysis({ openPanel: false }));
  $("#exportJson").addEventListener("click", exportJson);
  $("#clearHistory").addEventListener("click", clearHistory);

  decorateStaticContent();
  loadState().catch((error) => {
    setStatus(error.message || String(error), "error");
  });
})();
