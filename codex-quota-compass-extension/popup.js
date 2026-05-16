(function () {
  "use strict";

  const { CONFIG, ROUTES } = window.CodexMeterConfig;
  const domain = window.CodexMeterDomain;
  const reportRepository = window.CodexMeterReportRepository;

  const $ = (selector) => document.querySelector(selector);
  const icon = (name, className = "cqc-icon", label = "") =>
    window.CQCIcons?.icon(name, className, label) || "";

  const POPUP_MESSAGES = {
    "zh-CN": {
      subtitle: "Codex 用量快照和本地历史",
      historyTitle: "历史快照",
      status: {
        loading: "读取本地快照...",
        noSnapshot: "还没有本地快照。打开 Codex analytics 页面后点击“刷新”。",
        updated: "本地快照已更新：{time}",
        openFirst: "请先切到 ChatGPT Codex analytics 标签页。",
        reading: "正在从当前 Codex 页面读取用量数据...",
        noResponse: "页面没有响应",
      },
      metrics: {
        credits: "本周期已用 Credits",
        tokens: "本周期总 Tokens",
        cache: "输入缓存命中率",
        usd: "本周期折算金额",
      },
      actions: {
        open: "打开页面",
        refresh: "刷新",
        clear: "清空",
      },
      emptySnapshots: "暂无历史快照",
    },
    "zh-TW": {
      subtitle: "Codex 用量快照與本機歷史",
      historyTitle: "歷史快照",
      status: {
        loading: "讀取本機快照...",
        noSnapshot: "尚無本機快照。開啟 Codex analytics 頁面後按一下「重新整理」。",
        updated: "本機快照已更新：{time}",
        openFirst: "請先切到 ChatGPT Codex analytics 分頁。",
        reading: "正在從目前的 Codex 頁面讀取用量資料...",
        noResponse: "頁面沒有回應",
      },
      metrics: {
        credits: "本週期已用 Credits",
        tokens: "本週期總 Tokens",
        cache: "輸入快取命中率",
        usd: "本週期折算金額",
      },
      actions: {
        open: "開啟頁面",
        refresh: "重新整理",
        clear: "清空",
      },
      emptySnapshots: "尚無歷史快照",
    },
    "zh-HK": {
      subtitle: "Codex 用量快照及本機歷史",
      historyTitle: "歷史快照",
      status: {
        loading: "讀取本機快照...",
        noSnapshot: "暫時未有本機快照。開啟 Codex analytics 頁面後按「重新整理」。",
        updated: "本機快照已更新：{time}",
        openFirst: "請先切到 ChatGPT Codex analytics 分頁。",
        reading: "正在從目前的 Codex 頁面讀取用量資料...",
        noResponse: "頁面沒有回應",
      },
      metrics: {
        credits: "本週期已用 Credits",
        tokens: "本週期總 Tokens",
        cache: "輸入快取命中率",
        usd: "本週期折算金額",
      },
      actions: {
        open: "開啟頁面",
        refresh: "重新整理",
        clear: "清空",
      },
      emptySnapshots: "暫無歷史快照",
    },
    "en-US": {
      subtitle: "Codex usage snapshots and local history",
      historyTitle: "Snapshot history",
      status: {
        loading: "Reading local snapshot...",
        noSnapshot: "No local snapshot yet. Open the Codex analytics page, then click Refresh.",
        updated: "Local snapshot updated: {time}",
        openFirst: "Switch to the ChatGPT Codex analytics tab first.",
        reading: "Reading usage data from the current Codex page...",
        noResponse: "The page did not respond",
      },
      metrics: {
        credits: "Credits used this cycle",
        tokens: "Total Tokens this cycle",
        cache: "Input cache hit rate",
        usd: "Estimated cycle value",
      },
      actions: {
        open: "Open page",
        refresh: "Refresh",
        clear: "Clear",
      },
      emptySnapshots: "No snapshot history",
    },
    "ja-JP": {
      subtitle: "Codex 使用量スナップショットとローカル履歴",
      historyTitle: "スナップショット履歴",
      status: {
        loading: "ローカルスナップショットを読み込み中...",
        noSnapshot: "ローカルスナップショットはまだありません。Codex analytics ページを開いて「更新」をクリックしてください。",
        updated: "ローカルスナップショット更新済み: {time}",
        openFirst: "先に ChatGPT Codex analytics タブへ切り替えてください。",
        reading: "現在の Codex ページから使用量データを読み込んでいます...",
        noResponse: "ページが応答しませんでした",
      },
      metrics: {
        credits: "このサイクルで使用した Credits",
        tokens: "このサイクルの合計 Tokens",
        cache: "入力キャッシュヒット率",
        usd: "推定サイクル金額",
      },
      actions: {
        open: "ページを開く",
        refresh: "更新",
        clear: "消去",
      },
      emptySnapshots: "スナップショット履歴はありません",
    },
    "fr-FR": {
      subtitle: "Instantanés d’utilisation Codex et historique local",
      historyTitle: "Historique des instantanés",
      status: {
        loading: "Lecture de l’instantané local...",
        noSnapshot: "Aucun instantané local pour le moment. Ouvrez la page Codex analytics, puis cliquez sur Actualiser.",
        updated: "Instantané local mis à jour : {time}",
        openFirst: "Passez d’abord à l’onglet ChatGPT Codex analytics.",
        reading: "Lecture des données d’utilisation depuis la page Codex actuelle...",
        noResponse: "La page n’a pas répondu",
      },
      metrics: {
        credits: "Credits utilisés ce cycle",
        tokens: "Total des Tokens ce cycle",
        cache: "Taux de cache des entrées",
        usd: "Valeur estimée du cycle",
      },
      actions: {
        open: "Ouvrir la page",
        refresh: "Actualiser",
        clear: "Effacer",
      },
      emptySnapshots: "Aucun historique d’instantanés",
    },
    "ru-RU": {
      subtitle: "Снимки использования Codex и локальная история",
      historyTitle: "История снимков",
      status: {
        loading: "Чтение локального снимка...",
        noSnapshot: "Локальных снимков пока нет. Откройте страницу Codex analytics и нажмите «Обновить».",
        updated: "Локальный снимок обновлён: {time}",
        openFirst: "Сначала переключитесь на вкладку ChatGPT Codex analytics.",
        reading: "Чтение данных использования с текущей страницы Codex...",
        noResponse: "Страница не ответила",
      },
      metrics: {
        credits: "Credits использовано в этом цикле",
        tokens: "Всего Tokens в этом цикле",
        cache: "Доля попаданий кэша ввода",
        usd: "Оценочная стоимость цикла",
      },
      actions: {
        open: "Открыть страницу",
        refresh: "Обновить",
        clear: "Очистить",
      },
      emptySnapshots: "Истории снимков пока нет",
    },
    "es-ES": {
      subtitle: "Instantáneas de uso de Codex e historial local",
      historyTitle: "Historial de instantáneas",
      status: {
        loading: "Leyendo instantánea local...",
        noSnapshot: "Aún no hay instantáneas locales. Abre la página Codex analytics y haz clic en Actualizar.",
        updated: "Instantánea local actualizada: {time}",
        openFirst: "Cambia primero a la pestaña ChatGPT Codex analytics.",
        reading: "Leyendo datos de uso desde la página actual de Codex...",
        noResponse: "La página no respondió",
      },
      metrics: {
        credits: "Credits usados en este ciclo",
        tokens: "Tokens totales en este ciclo",
        cache: "Tasa de aciertos de caché de entrada",
        usd: "Valor estimado del ciclo",
      },
      actions: {
        open: "Abrir página",
        refresh: "Actualizar",
        clear: "Borrar",
      },
      emptySnapshots: "No hay historial de instantáneas",
    },
    "de-DE": {
      subtitle: "Codex-Nutzungssnapshots und lokaler Verlauf",
      historyTitle: "Snapshot-Verlauf",
      status: {
        loading: "Lokaler Snapshot wird gelesen...",
        noSnapshot: "Noch kein lokaler Snapshot. Öffne die Codex analytics-Seite und klicke auf Aktualisieren.",
        updated: "Lokaler Snapshot aktualisiert: {time}",
        openFirst: "Wechsle zuerst zum ChatGPT Codex analytics-Tab.",
        reading: "Nutzungsdaten werden von der aktuellen Codex-Seite gelesen...",
        noResponse: "Die Seite hat nicht geantwortet",
      },
      metrics: {
        credits: "In diesem Zyklus genutzte Credits",
        tokens: "Gesamte Tokens in diesem Zyklus",
        cache: "Cache-Trefferquote für Eingaben",
        usd: "Geschätzter Zykluswert",
      },
      actions: {
        open: "Seite öffnen",
        refresh: "Aktualisieren",
        clear: "Leeren",
      },
      emptySnapshots: "Kein Snapshot-Verlauf",
    },
  };

  const LOCALE_ALIASES = {
    de: "de-DE",
    en: "en-US",
    es: "es-ES",
    "es-419": "es-ES",
    fr: "fr-FR",
    ja: "ja-JP",
    ru: "ru-RU",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-hans-cn": "zh-CN",
    "zh-hk": "zh-HK",
    "zh-hant": "zh-TW",
    "zh-hant-hk": "zh-HK",
    "zh-hant-tw": "zh-TW",
    "zh-tw": "zh-TW",
  };

  const normalizeLocale = (locale) => {
    const normalized = String(locale || "").trim().replaceAll("_", "-").toLowerCase();
    if (POPUP_MESSAGES[LOCALE_ALIASES[normalized]]) return LOCALE_ALIASES[normalized];
    const parts = normalized.split("-");
    for (let size = parts.length; size >= 1; size -= 1) {
      const candidate = parts.slice(0, size).join("-");
      if (POPUP_MESSAGES[LOCALE_ALIASES[candidate]]) return LOCALE_ALIASES[candidate];
    }
    return "en-US";
  };

  const locale = normalizeLocale(navigator.languages?.[0] || navigator.language);

  const messageValue = (key) =>
    key.split(".").reduce((value, part) => value?.[part], POPUP_MESSAGES[locale]) ??
    key.split(".").reduce((value, part) => value?.[part], POPUP_MESSAGES["en-US"]) ??
    key;

  const t = (key, vars = {}) =>
    String(messageValue(key)).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");

  const fmtNum = (value, digits = 2) => {
    return domain.formatNumber(value, locale, digits);
  };

  const n = domain.n;
  const fmtUsd = (credits) => domain.formatUsd(credits, CONFIG.USD_PER_CREDIT);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const setStatus = (message, isError = false) => {
    const el = $("#status");
    el.innerHTML = `${icon(isError ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
    el.classList.toggle("error", isError);
  };

  const loadState = async () => {
    const data = await reportRepository.load();
    render(data.latest, data.snapshots);
  };

  const render = (latest, snapshots) => {
    if (!latest) {
      setStatus(t("status.noSnapshot"));
      $("#credits").textContent = "--";
      $("#tokens").textContent = "--";
      $("#cacheRatio").textContent = "--";
      $("#usdEstimate").textContent = "--";
      $("#snapshots").innerHTML = `<div class="empty">${icon("database")}<span>${escapeHtml(t("emptySnapshots"))}</span></div>`;
      return;
    }

    const stats = latest.currentStats || {};
    setStatus(t("status.updated", { time: latest.capturedAtLocal || latest.capturedAt }));
    $("#credits").textContent = n(stats.credits).toFixed(2);
    $("#tokens").textContent = fmtNum(stats.tokens);
    $("#cacheRatio").textContent = `${(n(stats.cacheRatio) * 100).toFixed(1)}%`;
    $("#usdEstimate").textContent = fmtUsd(stats.credits);
    $("#snapshots").innerHTML = renderSnapshots(snapshots);
  };

  const renderSnapshots = (snapshots) => {
    if (!snapshots.length) return `<div class="empty">${icon("database")}<span>${escapeHtml(t("emptySnapshots"))}</span></div>`;
    return snapshots
      .slice(0, 5)
      .map((shot) => `
        <article class="snapshot">
          <strong>${icon("clock")}${escapeHtml(shot.capturedAtLocal || shot.capturedAt)}</strong>
          <span>${n(shot.currentStats?.credits).toFixed(2)} Credits · ${fmtNum(shot.currentStats?.tokens)} Tokens</span>
        </article>
      `)
      .join("");
  };

  const decorateStaticIcons = () => {
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    $("#brandIcon").innerHTML = icon("gauge");
    document.querySelectorAll("[data-icon]").forEach((slot) => {
      slot.innerHTML = icon(slot.dataset.icon);
    });
  };

  const activeTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  };

  const refreshActive = async () => {
    const tab = await activeTab();
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
      setStatus(t("status.openFirst"), true);
      return;
    }

    setStatus(t("status.reading"));
    try {
      let response = await sendRefreshMessage(tab.id);
      if (!response?.ok && /Receiving end does not exist|Could not establish connection/i.test(response?.error || "")) {
        await injectIntoTab(tab.id);
        response = await sendRefreshMessage(tab.id);
      }
      if (!response?.ok) throw new Error(response?.error || t("status.noResponse"));
      await loadState();
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  };

  const sendRefreshMessage = async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: "CQC_RUN_ANALYSIS",
        openPanel: true,
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
    await reportRepository.clear();
    await loadState();
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

  $("#openAnalytics").addEventListener("click", openAnalytics);
  $("#refresh").addEventListener("click", refreshActive);
  $("#exportJson").addEventListener("click", exportJson);
  $("#clearHistory").addEventListener("click", clearHistory);

  decorateStaticIcons();
  loadState();
})();
