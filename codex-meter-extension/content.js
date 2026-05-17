(function () {
  "use strict";

  const CONTENT_SCRIPT_VERSION = "0.3.0";
  const ENABLE_CHART_TOOLTIP_ENHANCER = false;

  if (window.__codexQuotaCompassInstalled === CONTENT_SCRIPT_VERSION) {
    window.__codexQuotaCompassUpdateVisibility?.();
    return;
  }
  window.__codexQuotaCompassInstalled = CONTENT_SCRIPT_VERSION;

  const { CONFIG, IDS, isAnalyticsRoute } = window.CodexMeterConfig;
  const domain = window.CodexMeterDomain;
  const chatGptClient = window.CodexMeterChatGptClient;
  const reportRepository = window.CodexMeterReportRepository;
  const { cacheRatio, compactReport, n, tokenInput, tokenTotal } = domain;

  let latestReport = null;
  let isRunning = false;
  let passiveReportPromise = null;
  let cacheHydrationPromise = null;
  let chartTooltipFrame = 0;
  let chartPointer = null;
  let lastPassiveRefreshAt = 0;
  const PASSIVE_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

  const MESSAGES = {
    "zh-CN": {
      usageDetails: "使用详情",
      personalUsage: "个人使用",
      trigger: {
        title: "打开 Codex Meter",
        label: "Codex Meter",
        loading: "分析中...",
      },
      close: "关闭",
      refresh: "刷新",
      skeletonIdle: "点击“刷新”读取当前 Codex 用量数据。数据只保存在这台电脑上。",
      skeletonLoading: "正在读取 Codex 用量和每日明细...",
      updated: "数据已更新：{time}",
      tooltipPending: "Codex Meter · 更新中",
      noToken: "没有在页面 bootstrap 数据里找到 ChatGPT Web token。请确认已登录并刷新页面。",
      openAnalyticsFirst: "请先打开 ChatGPT Codex analytics 页面。",
      limits: {
        secondary: "5 小时使用限额",
        primary: "每周使用限额",
        fallback: "使用限额",
      },
      sections: {
        current: "本周期每日用量",
        currentMeta: "从 {date} 开始统计",
        history: "周期外历史用量",
        historyRange: "{start} 至 {end}",
      },
      metrics: {
        remaining: ["本周期剩余额度比例", "来自官方每周限额进度。"],
        credits: ["本周期已用 Credits", "按每日用量明细加总。"],
        tokens: ["本周期总 Tokens", "按每日用量明细汇总的全部 Tokens。"],
        projected: ["推算周期总 Credits", "用当前已用比例反推整周期额度。"],
        projectedUnavailable: ["明细不足", "每日 Credits 暂无可用数据。"],
        cache: ["输入缓存命中率", "缓存输入占全部输入 Tokens 的比例。"],
        usd: ["本周期折算金额", "按 1000 Credits = US$40 估算。"],
      },
      table: {
        empty: "这个时间段还没有 Codex 用量记录。",
        date: "日期",
        credits: "Credits",
        tokens: "总 Tokens",
        inputTokens: "输入 Tokens",
        cache: "缓存命中",
        usd: "折算金额",
        turns: "轮数",
        total: "合计",
      },
    },
    "zh-TW": {
      usageDetails: "使用詳情",
      personalUsage: "個人使用",
      trigger: {
        title: "開啟 Codex Meter",
        label: "Codex Meter",
        loading: "分析中...",
      },
      close: "關閉",
      refresh: "重新整理",
      skeletonIdle: "按一下「重新整理」讀取目前的 Codex 用量資料。資料只會儲存在這台電腦上。",
      skeletonLoading: "正在讀取 Codex 用量與每日明細...",
      updated: "資料已更新：{time}",
      tooltipPending: "Codex Meter · 更新中",
      noToken: "在頁面 bootstrap 資料中找不到 ChatGPT Web token。請確認已登入並重新整理頁面。",
      openAnalyticsFirst: "請先開啟 ChatGPT Codex analytics 頁面。",
      limits: {
        secondary: "5 小時使用限額",
        primary: "每週使用限額",
        fallback: "使用限額",
      },
      sections: {
        current: "本週期每日用量",
        currentMeta: "從 {date} 開始統計",
        history: "週期外歷史用量",
        historyRange: "{start} 至 {end}",
      },
      metrics: {
        remaining: ["本週期剩餘額度比例", "來自官方每週限額進度。"],
        credits: ["本週期已用 Credits", "按每日用量明細加總。"],
        tokens: ["本週期總 Tokens", "按每日用量明細彙總的全部 Tokens。"],
        projected: ["推算週期總 Credits", "用目前已用比例反推整個週期額度。"],
        projectedUnavailable: ["明細不足", "每日 Credits 暫無可用資料。"],
        cache: ["輸入快取命中率", "快取輸入佔全部輸入 Tokens 的比例。"],
        usd: ["本週期折算金額", "按 1000 Credits = US$40 估算。"],
      },
      table: {
        empty: "這個時間範圍尚無 Codex 用量記錄。",
        date: "日期",
        credits: "Credits",
        tokens: "總 Tokens",
        inputTokens: "輸入 Tokens",
        cache: "快取命中",
        usd: "折算金額",
        turns: "輪數",
        total: "合計",
      },
    },
    "zh-HK": {
      usageDetails: "使用詳情",
      personalUsage: "個人使用",
      trigger: {
        title: "開啟 Codex Meter",
        label: "Codex Meter",
        loading: "分析中...",
      },
      close: "關閉",
      refresh: "重新整理",
      skeletonIdle: "按「重新整理」讀取目前的 Codex 用量資料。資料只會儲存在這部電腦。",
      skeletonLoading: "正在讀取 Codex 用量及每日明細...",
      updated: "資料已更新：{time}",
      tooltipPending: "Codex Meter · 更新中",
      noToken: "在頁面 bootstrap 資料入面找不到 ChatGPT Web token。請確認已登入並重新整理頁面。",
      openAnalyticsFirst: "請先開啟 ChatGPT Codex analytics 頁面。",
      limits: {
        secondary: "5 小時使用限額",
        primary: "每週使用限額",
        fallback: "使用限額",
      },
      sections: {
        current: "本週期每日用量",
        currentMeta: "由 {date} 開始統計",
        history: "週期外歷史用量",
        historyRange: "{start} 至 {end}",
      },
      metrics: {
        remaining: ["本週期剩餘額度比例", "來自官方每週限額進度。"],
        credits: ["本週期已用 Credits", "按每日用量明細加總。"],
        tokens: ["本週期總 Tokens", "按每日用量明細彙總所有 Tokens。"],
        projected: ["推算週期總 Credits", "用目前已用比例反推整個週期額度。"],
        projectedUnavailable: ["明細不足", "每日 Credits 暫無可用資料。"],
        cache: ["輸入快取命中率", "快取輸入佔全部輸入 Tokens 的比例。"],
        usd: ["本週期折算金額", "按 1000 Credits = US$40 估算。"],
      },
      table: {
        empty: "這個時間範圍暫時未有 Codex 用量記錄。",
        date: "日期",
        credits: "Credits",
        tokens: "總 Tokens",
        inputTokens: "輸入 Tokens",
        cache: "快取命中",
        usd: "折算金額",
        turns: "輪數",
        total: "合計",
      },
    },
    "en-US": {
      usageDetails: "Usage details",
      personalUsage: "Personal usage",
      trigger: {
        title: "Open Codex Meter",
        label: "Codex Meter",
        loading: "Analyzing...",
      },
      close: "Close",
      refresh: "Refresh",
      skeletonIdle: "Click Refresh to read the current Codex usage data. Data stays on this computer.",
      skeletonLoading: "Reading Codex usage and daily details...",
      updated: "Data updated: {time}",
      tooltipPending: "Codex Meter · updating",
      noToken: "Could not find the ChatGPT web token in the page bootstrap data. Make sure you are signed in and refresh the page.",
      openAnalyticsFirst: "Open the ChatGPT Codex analytics page first.",
      limits: {
        secondary: "5-hour usage limit",
        primary: "Weekly usage limit",
        fallback: "Usage limit",
      },
      sections: {
        current: "Daily usage in this cycle",
        currentMeta: "Counting from {date}",
        history: "Usage outside this cycle",
        historyRange: "{start} to {end}",
      },
      metrics: {
        remaining: ["Remaining quota this cycle", "From the official weekly quota progress."],
        credits: ["Credits used this cycle", "Totaled from the daily usage details."],
        tokens: ["Total Tokens this cycle", "All Tokens summed from daily usage details."],
        projected: ["Projected cycle Credits", "Estimated from current usage and remaining quota."],
        projectedUnavailable: ["Pending", "Daily Credits are not available yet."],
        cache: ["Input cache hit rate", "Cached input as a share of all input Tokens."],
        usd: ["Estimated cycle value", "Estimated at US$40 per 1000 Credits."],
      },
      table: {
        empty: "No Codex usage was recorded in this date range.",
        date: "Date",
        credits: "Credits",
        tokens: "Total Tokens",
        inputTokens: "Input Tokens",
        cache: "Cache hit",
        usd: "Estimated value",
        turns: "Turns",
        total: "Total",
      },
    },
    "ja-JP": {
      usageDetails: "使用状況の詳細",
      personalUsage: "個人の使用状況",
      trigger: {
        title: "Codex Meter を開く",
        label: "Codex Meter",
        loading: "分析中...",
      },
      close: "閉じる",
      refresh: "更新",
      skeletonIdle: "「更新」をクリックして現在の Codex 使用量データを読み込みます。データはこのコンピューターにのみ保存されます。",
      skeletonLoading: "Codex の使用量と日別の詳細を読み込んでいます...",
      updated: "データ更新済み: {time}",
      tooltipPending: "Codex Meter · 更新中",
      noToken: "ページの bootstrap データ内に ChatGPT Web token が見つかりません。ログイン済みであることを確認して、ページを更新してください。",
      openAnalyticsFirst: "先に ChatGPT Codex analytics ページを開いてください。",
      limits: {
        secondary: "5 時間の使用上限",
        primary: "週間使用上限",
        fallback: "使用上限",
      },
      sections: {
        current: "このサイクルの日別使用量",
        currentMeta: "{date} から集計",
        history: "サイクル外の過去使用量",
        historyRange: "{start} から {end}",
      },
      metrics: {
        remaining: ["このサイクルの残り割当", "公式の週間上限の進捗に基づきます。"],
        credits: ["このサイクルで使用した Credits", "日別の使用量明細から合計しています。"],
        tokens: ["このサイクルの合計 Tokens", "日別の使用量明細からすべての Tokens を合計しています。"],
        projected: ["推定サイクル総 Credits", "現在の使用率と残り割当から推定しています。"],
        projectedUnavailable: ["保留中", "日別 Credits はまだ利用できません。"],
        cache: ["入力キャッシュヒット率", "全入力 Tokens に占めるキャッシュ済み入力の割合です。"],
        usd: ["推定サイクル金額", "1000 Credits = US$40 として推定しています。"],
      },
      table: {
        empty: "この期間の Codex 使用記録はありません。",
        date: "日付",
        credits: "Credits",
        tokens: "合計 Tokens",
        inputTokens: "入力 Tokens",
        cache: "キャッシュ率",
        usd: "推定金額",
        turns: "ターン数",
        total: "合計",
      },
    },
    "fr-FR": {
      usageDetails: "Détails d’utilisation",
      personalUsage: "Utilisation personnelle",
      trigger: {
        title: "Ouvrir Codex Meter",
        label: "Codex Meter",
        loading: "Analyse...",
      },
      close: "Fermer",
      refresh: "Actualiser",
      skeletonIdle: "Cliquez sur Actualiser pour lire les données d’utilisation Codex actuelles. Les données restent sur cet ordinateur.",
      skeletonLoading: "Lecture de l’utilisation Codex et des détails quotidiens...",
      updated: "Données mises à jour : {time}",
      tooltipPending: "Codex Meter · mise à jour",
      noToken: "Impossible de trouver le token Web ChatGPT dans les données bootstrap de la page. Vérifiez que vous êtes connecté, puis actualisez la page.",
      openAnalyticsFirst: "Ouvrez d’abord la page ChatGPT Codex analytics.",
      limits: {
        secondary: "Limite d’utilisation de 5 heures",
        primary: "Limite d’utilisation hebdomadaire",
        fallback: "Limite d’utilisation",
      },
      sections: {
        current: "Utilisation quotidienne de ce cycle",
        currentMeta: "Comptabilisé depuis le {date}",
        history: "Historique hors cycle",
        historyRange: "Du {start} au {end}",
      },
      metrics: {
        remaining: ["Quota restant pour ce cycle", "D’après la progression officielle du quota hebdomadaire."],
        credits: ["Credits utilisés ce cycle", "Total calculé à partir des détails quotidiens."],
        tokens: ["Total des Tokens ce cycle", "Tous les Tokens additionnés depuis les détails quotidiens."],
        projected: ["Credits estimés pour le cycle", "Estimés à partir de l’utilisation actuelle et du quota restant."],
        projectedUnavailable: ["En attente", "Les Credits quotidiens ne sont pas encore disponibles."],
        cache: ["Taux de cache des entrées", "Part des entrées mises en cache dans tous les Tokens d’entrée."],
        usd: ["Valeur estimée du cycle", "Estimation sur la base de 1000 Credits = 40 US$."],
      },
      table: {
        empty: "Aucune utilisation Codex n’a été enregistrée pour cette période.",
        date: "Date",
        credits: "Credits",
        tokens: "Total Tokens",
        inputTokens: "Tokens d’entrée",
        cache: "Cache",
        usd: "Valeur estimée",
        turns: "Tours",
        total: "Total",
      },
    },
    "ru-RU": {
      usageDetails: [
        "Сведения об использовании",
        "Подробности использования",
        "Детали использования",
      ],
      personalUsage: [
        "Личное использование",
        "Индивидуальное использование",
        "Персональное использование",
      ],
      trigger: {
        title: "Открыть Codex Meter",
        label: "Codex Meter",
        loading: "Анализ...",
      },
      close: "Закрыть",
      refresh: "Обновить",
      skeletonIdle: "Нажмите «Обновить», чтобы считать текущие данные использования Codex. Данные остаются на этом компьютере.",
      skeletonLoading: "Чтение данных использования Codex и ежедневной детализации...",
      updated: "Данные обновлены: {time}",
      tooltipPending: "Codex Meter · обновление",
      noToken: "Не удалось найти веб-токен ChatGPT в bootstrap-данных страницы. Убедитесь, что вы вошли в аккаунт, и обновите страницу.",
      openAnalyticsFirst: "Сначала откройте страницу аналитики ChatGPT Codex.",
      limits: {
        secondary: "Лимит использования за 5 часов",
        primary: "Недельный лимит использования",
        fallback: "Лимит использования",
      },
      sections: {
        current: "Ежедневное использование в этом цикле",
        currentMeta: "Учитывается с {date}",
        history: "Использование вне текущего цикла",
        historyRange: "{start} — {end}",
      },
      metrics: {
        remaining: ["Остаток квоты в этом цикле", "По официальному прогрессу недельной квоты."],
        credits: ["Credits использовано в этом цикле", "Сумма по ежедневной детализации."],
        tokens: ["Всего Tokens в этом цикле", "Все Tokens, суммированные по ежедневной детализации."],
        projected: ["Прогноз Credits за цикл", "Оценка по текущему использованию и оставшейся квоте."],
        projectedUnavailable: ["Ожидание", "Ежедневные Credits пока недоступны."],
        cache: ["Доля попаданий кэша ввода", "Кэшированный ввод как доля всех входных Tokens."],
        usd: ["Оценочная стоимость цикла", "Оценка из расчета US$40 за 1000 Credits."],
      },
      table: {
        empty: "В этом диапазоне дат нет записей использования Codex.",
        date: "Дата",
        credits: "Credits",
        tokens: "Всего Tokens",
        inputTokens: "Входные Tokens",
        cache: "Кэш",
        usd: "Оценочная стоимость",
        turns: "Раунды",
        total: "Итого",
      },
    },
    "es-ES": {
      usageDetails: "Detalles de uso",
      personalUsage: "Uso personal",
      trigger: {
        title: "Abrir Codex Meter",
        label: "Codex Meter",
        loading: "Analizando...",
      },
      close: "Cerrar",
      refresh: "Actualizar",
      skeletonIdle: "Haz clic en Actualizar para leer los datos actuales de uso de Codex. Los datos se guardan solo en este equipo.",
      skeletonLoading: "Leyendo el uso de Codex y los detalles diarios...",
      updated: "Datos actualizados: {time}",
      tooltipPending: "Codex Meter · actualizando",
      noToken: "No se encontró el token web de ChatGPT en los datos bootstrap de la página. Asegúrate de haber iniciado sesión y actualiza la página.",
      openAnalyticsFirst: "Abre primero la página de ChatGPT Codex analytics.",
      limits: {
        secondary: "Límite de uso de 5 horas",
        primary: "Límite de uso semanal",
        fallback: "Límite de uso",
      },
      sections: {
        current: "Uso diario en este ciclo",
        currentMeta: "Contabilizado desde {date}",
        history: "Uso histórico fuera del ciclo",
        historyRange: "Del {start} al {end}",
      },
      metrics: {
        remaining: ["Cuota restante en este ciclo", "Según el progreso oficial de la cuota semanal."],
        credits: ["Credits usados en este ciclo", "Total calculado a partir de los detalles diarios."],
        tokens: ["Tokens totales en este ciclo", "Todos los Tokens sumados desde los detalles diarios."],
        projected: ["Credits estimados del ciclo", "Estimado a partir del uso actual y la cuota restante."],
        projectedUnavailable: ["Pendiente", "Los Credits diarios aún no están disponibles."],
        cache: ["Tasa de aciertos de caché de entrada", "Entradas en caché como parte de todos los Tokens de entrada."],
        usd: ["Valor estimado del ciclo", "Estimado a US$40 por cada 1000 Credits."],
      },
      table: {
        empty: "No se registró uso de Codex en este intervalo de fechas.",
        date: "Fecha",
        credits: "Credits",
        tokens: "Tokens totales",
        inputTokens: "Tokens de entrada",
        cache: "Caché",
        usd: "Valor estimado",
        turns: "Turnos",
        total: "Total",
      },
    },
    "de-DE": {
      usageDetails: "Nutzungsdetails",
      personalUsage: "Persönliche Nutzung",
      trigger: {
        title: "Codex Meter öffnen",
        label: "Codex Meter",
        loading: "Analysiere...",
      },
      close: "Schließen",
      refresh: "Aktualisieren",
      skeletonIdle: "Klicke auf Aktualisieren, um die aktuellen Codex-Nutzungsdaten zu laden. Die Daten bleiben auf diesem Computer.",
      skeletonLoading: "Codex-Nutzung und tägliche Details werden gelesen...",
      updated: "Daten aktualisiert: {time}",
      tooltipPending: "Codex Meter · wird aktualisiert",
      noToken: "Das ChatGPT-Web-Token wurde in den Bootstrap-Daten der Seite nicht gefunden. Stelle sicher, dass du angemeldet bist, und lade die Seite neu.",
      openAnalyticsFirst: "Öffne zuerst die ChatGPT Codex analytics-Seite.",
      limits: {
        secondary: "5-Stunden-Nutzungslimit",
        primary: "Wöchentliches Nutzungslimit",
        fallback: "Nutzungslimit",
      },
      sections: {
        current: "Tägliche Nutzung in diesem Zyklus",
        currentMeta: "Gezählt seit {date}",
        history: "Nutzung außerhalb dieses Zyklus",
        historyRange: "{start} bis {end}",
      },
      metrics: {
        remaining: ["Verbleibendes Kontingent in diesem Zyklus", "Aus dem offiziellen Fortschritt des Wochenlimits."],
        credits: ["In diesem Zyklus genutzte Credits", "Aus den täglichen Nutzungsdetails summiert."],
        tokens: ["Gesamte Tokens in diesem Zyklus", "Alle Tokens aus den täglichen Details summiert."],
        projected: ["Geschätzte Credits für den Zyklus", "Aus aktueller Nutzung und verbleibendem Kontingent geschätzt."],
        projectedUnavailable: ["Ausstehend", "Tägliche Credits sind noch nicht verfügbar."],
        cache: ["Cache-Trefferquote für Eingaben", "Zwischengespeicherte Eingaben als Anteil aller Eingabe-Tokens."],
        usd: ["Geschätzter Zykluswert", "Geschätzt mit US$40 pro 1000 Credits."],
      },
      table: {
        empty: "In diesem Datumsbereich wurde keine Codex-Nutzung aufgezeichnet.",
        date: "Datum",
        credits: "Credits",
        tokens: "Tokens gesamt",
        inputTokens: "Eingabe-Tokens",
        cache: "Cache",
        usd: "Geschätzter Wert",
        turns: "Turns",
        total: "Gesamt",
      },
    },
  };

  const icon = (name, className = "cqc-icon", label = "") =>
    window.CQCIcons?.icon(name, className, label) || "";

  const OFFICIAL_LOCALE_IDS = [
    "am", "ar", "bg-BG", "bn-BD", "bs-BA", "ca-ES", "cs-CZ", "da-DK",
    "de-DE", "el-GR", "en-US", "es-419", "es-ES", "et-EE", "fa", "fi-FI",
    "fr-CA", "fr-FR", "gu-IN", "hi-IN", "hr-HR", "hu-HU", "hy-AM", "id-ID",
    "is-IS", "it-IT", "ja-JP", "ka-GE", "kk", "kn-IN", "ko-KR", "lt",
    "lv-LV", "mk-MK", "ml", "mn", "mr-IN", "ms-MY", "my-MM", "nb-NO",
    "nl-NL", "pa", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sk-SK",
    "sl-SI", "so-SO", "sq-AL", "sr-RS", "sv-SE", "sw-TZ", "ta-IN",
    "te-IN", "th-TH", "tl", "tr-TR", "uk-UA", "ur", "vi-VN", "zh-CN",
    "zh-HK", "zh-TW",
  ];

  const OFFICIAL_LOCALE_BY_LOWER = Object.fromEntries(
    OFFICIAL_LOCALE_IDS.map((locale) => [locale.toLowerCase(), locale]),
  );

  const OFFICIAL_LOCALE_ALIASES = {
    de: "de-DE",
    en: "en-US",
    es: "es-ES",
    "es-419": "es-419",
    fr: "fr-FR",
    "fr-ca": "fr-CA",
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

  const normalizedLocaleTag = (locale) =>
    String(locale || "")
      .trim()
      .replaceAll("_", "-")
      .toLowerCase();

  const canonicalLocale = (locale) => {
    const normalized = normalizedLocaleTag(locale);
    if (!normalized) return "en-US";
    if (OFFICIAL_LOCALE_BY_LOWER[normalized]) return OFFICIAL_LOCALE_BY_LOWER[normalized];
    if (OFFICIAL_LOCALE_ALIASES[normalized]) return OFFICIAL_LOCALE_ALIASES[normalized];

    const parts = normalized.split("-");
    for (let size = parts.length - 1; size >= 1; size -= 1) {
      const candidate = parts.slice(0, size).join("-");
      if (OFFICIAL_LOCALE_BY_LOWER[candidate]) return OFFICIAL_LOCALE_BY_LOWER[candidate];
      if (OFFICIAL_LOCALE_ALIASES[candidate]) return OFFICIAL_LOCALE_ALIASES[candidate];
    }
    return "en-US";
  };

  const rawLocale = () =>
    chatGptClient.bootstrapLocale() ||
    document.documentElement.lang ||
    navigator.languages?.[0] ||
    navigator.language;

  const getPageLocale = () => canonicalLocale(rawLocale());

  const getLocale = () => {
    const locale = getPageLocale();
    if (MESSAGES[locale]) return locale;
    const languageFallback = {
      en: "en-US",
      es: "es-ES",
      fr: "fr-FR",
    }[locale.split("-")[0]];
    if (languageFallback && MESSAGES[languageFallback]) return languageFallback;
    return "en-US";
  };

  const messageValue = (key, locale = getLocale()) =>
    key.split(".").reduce((value, part) => value?.[part], MESSAGES[locale]) ??
    key.split(".").reduce((value, part) => value?.[part], MESSAGES["en-US"]) ??
    key;

  const firstMessage = (value) => (Array.isArray(value) ? value[0] : value);

  const t = (key, vars = {}) => {
    let value = messageValue(key);
    value = firstMessage(value);
    return String(value).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  };

  const knownText = (key) =>
    [
      ...new Set(
        Object.keys(MESSAGES)
          .flatMap((locale) => {
            const value = messageValue(key, locale);
            return Array.isArray(value) ? value : [value];
          })
          .filter(Boolean),
      ),
    ];

  const reportService = window.CodexMeterReportService.createReportService({
    chatGptClient,
    config: CONFIG,
    domain,
    getPageLocale,
    pageHref: () => location.href,
    reportRepository,
    translate: t,
  });

  const fmtNum = (value, digits = 2) => {
    return domain.formatNumber(value, getPageLocale(), digits);
  };

  const fmtCredits = domain.formatCredits;
  const fmtUsd = (credits) => domain.formatUsd(credits, CONFIG.USD_PER_CREDIT);

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const setAttributeIfChanged = (element, name, value) => {
    const next = String(value);
    if (element.getAttribute(name) !== next) element.setAttribute(name, next);
  };

  const setDatasetIfChanged = (element, name, value) => {
    const next = String(value);
    if (element.dataset[name] !== next) element.dataset[name] = next;
  };

  const setHtmlIfChanged = (element, html) => {
    if (element.innerHTML !== html) element.innerHTML = html;
  };

  const elementText = (element) =>
    (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();

  const isVisibleElement = (element) => {
    if (!element || element.closest(`#${IDS.overlay}`)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };

  const visibleMainSections = () =>
    [...document.querySelectorAll("main section, main article, section")]
      .filter(isVisibleElement)
      .filter((section) => {
        const rect = section.getBoundingClientRect();
        return rect.x > 240 && rect.width > 500 && section.querySelector("h2,h3");
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const isRenderableElement = (element) => {
    if (!element || element.closest(`#${IDS.overlay}`)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      element.getClientRects().length > 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };

  const mainHeadings = () =>
    [...document.querySelectorAll("main h1, main h2, main h3, main [role='heading']")]
      .filter(isRenderableElement)
      .filter((heading) => {
        const rect = heading.getBoundingClientRect();
        return rect.x > 240 && rect.width > 0;
      });

  const sectionHeading = (section) =>
    [...section.querySelectorAll("h2,h3")]
      .filter(isRenderableElement)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;

  const visibleHeadings = () =>
    mainHeadings()
      .filter(isVisibleElement)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const findKnownHeading = (key) => {
    const labels = knownText(key);
    return mainHeadings().find((heading) => labels.includes(elementText(heading))) || null;
  };

  const sectionForHeading = (heading) => {
    if (!heading) return null;
    const headingRect = heading.getBoundingClientRect();
    let candidate = null;
    let current = heading?.parentElement || null;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      const startsNearHeading = rect.top <= headingRect.top + 8 && headingRect.top - rect.top <= 96;
      if (rect.x > 240 && rect.width > 500 && startsNearHeading) {
        candidate = current;
      }
      if (headingRect.top - rect.top > 140) break;
      current = current.parentElement;
    }
    return candidate || heading.parentElement || null;
  };

  const mountForHeading = (heading) => ({
    heading,
    section: sectionForHeading(heading),
    placement: "section",
  });

  const headingNearSection = (section) => {
    const sectionRect = section.getBoundingClientRect();
    return (
      visibleHeadings()
        .filter((heading) => {
          const rect = heading.getBoundingClientRect();
          return rect.top >= sectionRect.top - 220 && rect.top <= sectionRect.bottom;
        })
        .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] ||
      sectionHeading(section)
    );
  };

  const findUsageDetailsMount = () => {
    const knownHeading = findKnownHeading("usageDetails");
    if (knownHeading) return mountForHeading(knownHeading);

    const sections = [...document.querySelectorAll("main section, main article, section")]
      .filter(isRenderableElement)
      .filter((section) => {
        const rect = section.getBoundingClientRect();
        return rect.x > 240 && rect.width > 500 && section.querySelector("h2,h3");
      });
    const productLegendSection = sections.find((section) => {
      const text = elementText(section);
      return /\bDesktop App\b/.test(text) && /\bCLI\b/.test(text) && /\bCloud\b/.test(text);
    });
    if (productLegendSection) {
      return mountForHeading(headingNearSection(productLegendSection));
    }

    return null;
  };

  const positionDetailButton = (button, heading, section, placement) => {
    if (placement === "fixed") {
      button.style.removeProperty("--cqm-detail-top");
      return;
    }
    const headingRect = heading.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const top = Math.max(0, Math.round(headingRect.top - sectionRect.top - 2));
    const nextTop = `${top}px`;
    if (button.style.getPropertyValue("--cqm-detail-top") !== nextTop) {
      button.style.setProperty("--cqm-detail-top", nextTop);
    }
  };

  const ensureDetailButton = () => {
    if (!isAnalyticsRoute()) {
      removeDetailButton();
      return false;
    }

    const mount = findUsageDetailsMount();
    if (!mount?.heading || !mount.section) {
      removeDetailButton();
      return false;
    }

    let button = document.getElementById(IDS.button);
    if (!button) {
      button = document.createElement("button");
      button.id = IDS.button;
      button.type = "button";
      button.className = "cqm-detail-button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (latestReport) {
          ensureUi();
          renderReport(latestReport);
          openPanel();
        }
        runAnalysis({ openPanel: true }).catch(() => {});
      });
    }

    setAttributeIfChanged(button, "title", t("trigger.title"));
    setDatasetIfChanged(button, "placement", mount.placement);
    if (button.parentElement !== mount.section) mount.section.appendChild(button);
    if (!isRunning) setTriggerButton("gauge", t("trigger.label"));
    if (mount.placement === "section" && getComputedStyle(mount.section).position === "static") {
      mount.section.style.position = "relative";
    }
    positionDetailButton(button, mount.heading, mount.section, mount.placement);
    setDatasetIfChanged(button, "visible", "true");
    return true;
  };

  const removeDetailButton = () => {
    document.getElementById(IDS.button)?.remove();
  };

  const ensureChromeRuntimeListener = () => {
    if (ensureChromeRuntimeListener.didInstall) return;
    ensureChromeRuntimeListener.didInstall = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "CQC_RUN_ANALYSIS") return false;
      runAnalysis({ openPanel: message.openPanel !== false })
        .then((report) => sendResponse({ ok: true, report: compactReport(report) }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    });
  };

  const ensureUi = () => {
    let overlay = document.getElementById(IDS.overlay);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = IDS.overlay;
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closePanel();
      });
      document.documentElement.appendChild(overlay);
    }

    if (!ensureUi.didInstallEscapeHandler) {
      ensureUi.didInstallEscapeHandler = true;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.getElementById(IDS.overlay)?.dataset.open === "true") {
          closePanel();
        }
      });
    }

    let panel = document.getElementById(IDS.panel);
    const locale = getLocale();
    const bindPanelActions = () => {
      panel.querySelector("[data-cqc-close]")?.addEventListener("click", closePanel);
      panel.querySelector("[data-cqc-refresh]")?.addEventListener("click", () => runAnalysis({ openPanel: true }));
      panel.querySelector("[data-cqc-export-json]")?.addEventListener("click", exportLatestJson);
      panel.querySelector("[data-cqc-export-csv]")?.addEventListener("click", exportLatestCsv);
    };
    if (!panel) {
      panel = document.createElement("section");
      panel.id = IDS.panel;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", "codex-meter-dialog-title");
      panel.setAttribute("aria-live", "polite");
      panel.innerHTML = renderShell();
      panel.dataset.locale = locale;
      overlay.appendChild(panel);
      bindPanelActions();
    } else if (panel.parentElement !== overlay) {
      overlay.appendChild(panel);
    }
    if (panel.dataset.locale !== locale) {
      panel.innerHTML = renderShell();
      panel.dataset.locale = locale;
      bindPanelActions();
      if (latestReport) renderReport(latestReport);
    }
  };

  const renderShell = () => `
    <div class="cqc-header">
      <div class="cqc-brand">
        <h2 class="cqc-title" id="codex-meter-dialog-title">Codex Meter</h2>
      </div>
      <button class="cqc-icon-button cqc-close-button" type="button" title="${escapeHtml(t("close"))}" data-cqc-close>${icon("x")}</button>
    </div>
    <div class="cqc-body">${renderSkeletonBody(t("skeletonIdle"))}</div>
    <div class="cqc-footer">
      <button class="cqc-text-button" type="button" data-cqc-export-csv>${icon("fileSpreadsheet")}<span>CSV</span></button>
      <button class="cqc-text-button" type="button" data-cqc-export-json>${icon("fileJson")}<span>JSON</span></button>
      <button class="cqc-text-button cqc-primary" type="button" data-cqc-refresh>${icon("refresh")}<span>${escapeHtml(t("refresh"))}</span></button>
    </div>
  `;

  const renderSkeletonBody = (message) => `
    <div class="cqc-status" data-kind="loading">${icon("sparkles")}<span>${escapeHtml(message)}</span></div>
    <div class="cqc-grid" aria-hidden="true">
      ${Array.from({ length: 6 }, () => `
        <div class="cqc-card cqc-skeleton-card">
          <span class="cqc-skeleton-line" data-size="label"></span>
          <span class="cqc-skeleton-line" data-size="value"></span>
          <span class="cqc-skeleton-line" data-size="hint"></span>
        </div>
      `).join("")}
    </div>
    <div class="cqc-skeleton-section" aria-hidden="true">
      <span class="cqc-skeleton-line"></span>
    </div>
    <div class="cqc-table-wrap cqc-skeleton-table" aria-hidden="true">
      ${Array.from({ length: 7 }, () => `
        <div class="cqc-skeleton-row">
          ${Array.from({ length: 7 }, () => `<span class="cqc-skeleton-line"></span>`).join("")}
        </div>
      `).join("")}
    </div>
  `;

  const renderLoadingSkeleton = (message) => {
    const body = document.querySelector(`#${IDS.panel} .cqc-body`);
    if (!body) return;
    body.innerHTML = renderSkeletonBody(message);
  };

  const setStatus = (message, kind = "info") => {
    ensureUi();
    const panel = document.getElementById(IDS.panel);
    const status = panel?.querySelector(".cqc-status");
    const html = `${icon(kind === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span>`;
    if (status) {
      setHtmlIfChanged(status, html);
      setDatasetIfChanged(status, "kind", kind);
    }
  };

  const openPanel = () => {
    ensureUi();
    const overlay = document.getElementById(IDS.overlay);
    const panel = document.getElementById(IDS.panel);
    if (overlay) setAttributeIfChanged(overlay, "data-open", "true");
    if (panel) setAttributeIfChanged(panel, "data-open", "true");
  };

  const closePanel = () => {
    const overlay = document.getElementById(IDS.overlay);
    const panel = document.getElementById(IDS.panel);
    if (overlay) setAttributeIfChanged(overlay, "data-open", "false");
    if (panel) setAttributeIfChanged(panel, "data-open", "false");
  };

  const updateVisibility = () => {
    const visible = isAnalyticsRoute();
    if (visible) {
      ensureUi();
      ensureDetailButton();
      if (ENABLE_CHART_TOOLTIP_ENHANCER) {
        installChartTooltipEnhancer();
        warmChartReport();
      } else {
        clearChartTooltipDetails();
      }
    }
    if (!visible) {
      closePanel();
      removeDetailButton();
      clearChartTooltipDetails();
      warmChartReport.didSchedule = false;
    }
  };

  const runAnalysis = async ({ openPanel: shouldOpenPanel = true } = {}) => {
    if (!isAnalyticsRoute()) {
      throw new Error(t("openAnalyticsFirst"));
    }
    if (isRunning) return latestReport;
    isRunning = true;
    ensureUi();
    if (shouldOpenPanel) openPanel();
    if (!latestReport) renderLoadingSkeleton(t("skeletonLoading"));
    setStatus(t("skeletonLoading"));
    setTriggerButton("refresh", t("trigger.loading"));

    try {
      latestReport = await reportService.refreshReport();
      renderReport(latestReport);
      if (ENABLE_CHART_TOOLTIP_ENHANCER) scheduleChartTooltipEnhance();
      return latestReport;
    } catch (error) {
      setStatus(error.message || String(error), "error");
      throw error;
    } finally {
      isRunning = false;
      setTriggerButton("gauge", t("trigger.label"));
    }
  };

  const setTriggerButton = (iconName, label) => {
    const button = document.getElementById(IDS.button);
    if (!button) return;
    if (button.dataset.triggerIcon === iconName && button.dataset.triggerLabel === label) return;
    button.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
    button.dataset.triggerIcon = iconName;
    button.dataset.triggerLabel = label;
  };

  const renderReport = (report) => {
    const body = document.querySelector(`#${IDS.panel} .cqc-body`);
    if (!body) return;
    body.innerHTML = renderReportBody(report);
  };

  const renderReportBody = (report) => `
      <div class="cqc-status">${icon("check")}<span>${escapeHtml(t("updated", { time: report.capturedAtLocal }))}</span></div>
      ${renderSummaryCards(report)}
      ${renderDailySection(
        t("sections.current"),
        report.currentCycleList,
        report.currentStats,
        t("sections.currentMeta", { date: report.cycleStartDate }),
        "current",
      )}
      ${
        report.historyList.length
          ? renderDailySection(
              t("sections.history"),
              report.historyList,
              report.historyStats,
              historyRange(report.historyList),
              "history",
            )
          : ""
      }
    `;

  const renderSummaryCards = (report) => {
    const stats = report.currentStats;
    const remaining = report.primaryWindow?.remainingPercent;
    const used = report.primaryWindow?.usedPercent;
    const canProjectCredits = used != null && used > 0 && stats.credits > 0;
    const projectedCredits = canProjectCredits ? stats.credits / (used / 100) : null;
    const projectedValue = canProjectCredits
      ? fmtCredits(projectedCredits, 1)
      : t("metrics.projectedUnavailable.0");
    const projectedHint = canProjectCredits
      ? t("metrics.projected.1")
      : t("metrics.projectedUnavailable.1");
    return `
      <div class="cqc-grid">
        ${renderMetricCard("gauge", t("metrics.remaining.0"), remaining == null ? "N/A" : `${remaining.toFixed(1)}%`, "fresh", true, t("metrics.remaining.1"))}
        ${renderMetricCard("coins", t("metrics.credits.0"), fmtCredits(stats.credits, 2), "mint", false, t("metrics.credits.1"))}
        ${renderMetricCard("cpu", t("metrics.tokens.0"), fmtNum(stats.tokens), "blue", false, t("metrics.tokens.1"))}
        ${renderMetricCard("trendingUp", t("metrics.projected.0"), projectedValue, "amber", false, projectedHint)}
        ${renderMetricCard("layers", t("metrics.cache.0"), `${(stats.cacheRatio * 100).toFixed(1)}%`, "violet", false, t("metrics.cache.1"))}
        ${renderMetricCard("wallet", t("metrics.usd.0"), escapeHtml(fmtUsd(stats.credits)), "ink", false, t("metrics.usd.1"))}
      </div>
    `;
  };

  const renderMetricCard = (iconName, label, value, tone, highlight = false, hint = "") => `
    <div class="cqc-card" data-tone="${tone}" data-highlight="${highlight}">
      <div class="cqc-card-top">
        <div class="cqc-card-icon">${icon(iconName)}</div>
        <div class="cqc-label">${escapeHtml(label)}</div>
      </div>
      <div class="cqc-value">${value}</div>
      ${hint ? `<div class="cqc-hint">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;

  const renderDailySection = (title, rows, stats, meta, kind) => `
    <div class="cqc-section-title">
      <span>${icon(kind === "history" ? "database" : "calendar")}${escapeHtml(title)}</span>
      <span>${escapeHtml(meta)}</span>
    </div>
    ${renderTable(rows, stats)}
  `;

  const renderTable = (rows, stats) => {
    if (!rows.length) return `<div class="cqc-empty">${icon("table")}<span>${escapeHtml(t("table.empty"))}</span></div>`;
    return `
      <div class="cqc-table-wrap">
        <table class="cqc-table">
          <colgroup>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
            <col>
          </colgroup>
          <thead>
            <tr>
              <th>${escapeHtml(t("table.date"))}</th>
              <th>${escapeHtml(t("table.credits"))}</th>
              <th>${escapeHtml(t("table.tokens"))}</th>
              <th>${escapeHtml(t("table.inputTokens"))}</th>
              <th>${escapeHtml(t("table.cache"))}</th>
              <th>${escapeHtml(t("table.usd"))}</th>
              <th>${escapeHtml(t("table.turns"))}</th>
            </tr>
          </thead>
          <tbody>
            ${[...rows]
              .reverse()
              .map((row) => {
                const totals = row.totals || {};
                const credits = n(totals.credits);
                return `
                  <tr>
                    <td>${escapeHtml(row.date)}</td>
                    <td class="cqc-mono">${fmtCredits(credits)}</td>
                    <td class="cqc-mono">${fmtNum(tokenTotal(totals))}</td>
                    <td class="cqc-mono">${fmtNum(tokenInput(totals))}</td>
                    <td class="cqc-mono">${(cacheRatio(totals) * 100).toFixed(0)}%</td>
                    <td>${escapeHtml(fmtUsd(credits))}</td>
                    <td>${escapeHtml(totals.turns || 0)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t("table.total"))}</td>
              <td class="cqc-mono">${fmtCredits(stats.credits)}</td>
              <td class="cqc-mono">${fmtNum(stats.tokens)}</td>
              <td class="cqc-mono">${fmtNum(stats.inputTokens)}</td>
              <td class="cqc-mono">${(stats.cacheRatio * 100).toFixed(0)}%</td>
              <td>${escapeHtml(fmtUsd(stats.credits))}</td>
              <td>${escapeHtml(stats.turns)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  };

  const historyRange = (rows) => {
    const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return t("sections.historyRange", {
      start: sorted[0]?.date || "",
      end: sorted.at(-1)?.date || "",
    });
  };

  const exportLatestJson = () => {
    if (!latestReport) return;
    downloadText(
      `codex-meter-${domain.localDate()}.json`,
      JSON.stringify(compactReport(latestReport), null, 2),
      "application/json",
    );
  };

  const exportLatestCsv = () => {
    if (!latestReport) return;
    const rows = [
      [
        "date",
        "credits",
        "tokens",
        "input_tokens",
        "cached_input_tokens",
        "uncached_input_tokens",
        "turns",
        "threads",
        "usd_estimate",
      ],
      ...latestReport.dailyList.map((row) => {
        const totals = row.totals || {};
        const credits = n(totals.credits);
        return [
          row.date,
          credits,
          tokenTotal(totals),
          tokenInput(totals),
          n(totals.cached_text_input_tokens),
          n(totals.uncached_text_input_tokens),
          n(totals.turns),
          n(totals.threads),
          (credits * CONFIG.USD_PER_CREDIT).toFixed(2),
        ];
      }),
    ];
    downloadText(`codex-meter-${domain.localDate()}.csv`, toCsv(rows), "text/csv");
  };

  const toCsv = (rows) =>
    rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? "");
            return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
          })
          .join(","),
      )
      .join("\n");

  const downloadText = (filename, text, type) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ensurePassiveReport = ({ allowRefresh = true } = {}) => {
    if (latestReport) {
      if (allowRefresh) refreshPassiveReport();
      return Promise.resolve(latestReport);
    }
    return hydrateCachedReport().then((cached) => {
      if (cached) {
        if (allowRefresh) refreshPassiveReport();
        return cached;
      }
      if (allowRefresh) return refreshPassiveReport({ force: true });
      return null;
    });
  };

  const hydrateCachedReport = () => {
    if (latestReport) return Promise.resolve(latestReport);
    if (!cacheHydrationPromise) {
      cacheHydrationPromise = reportRepository
        .load()
        .then(({ latest }) => {
          if (latest && !latestReport) latestReport = latest;
          return latestReport;
        })
        .catch(() => null)
        .finally(() => {
          cacheHydrationPromise = null;
        });
    }
    return cacheHydrationPromise;
  };

  const refreshPassiveReport = ({ force = false } = {}) => {
    if (isRunning || !isAnalyticsRoute()) return Promise.resolve(latestReport);
    const now = Date.now();
    if (!force && now - lastPassiveRefreshAt < PASSIVE_REFRESH_MIN_INTERVAL_MS) {
      return Promise.resolve(latestReport);
    }
    if (!passiveReportPromise) {
      lastPassiveRefreshAt = now;
      passiveReportPromise = reportService
        .refreshReport()
        .then((report) => {
          latestReport = report;
          if (ENABLE_CHART_TOOLTIP_ENHANCER) scheduleChartTooltipEnhance();
          return report;
        })
        .catch(() => latestReport)
        .finally(() => {
          passiveReportPromise = null;
        });
    }
    return passiveReportPromise;
  };

  const warmChartReport = () => {
    if (warmChartReport.didSchedule) return;
    warmChartReport.didSchedule = true;
    hydrateCachedReport().then((cached) => {
      if (cached) scheduleChartTooltipEnhance();
      const run = () => refreshPassiveReport();
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(run, { timeout: 1000 });
      } else {
        window.setTimeout(run, 250);
      }
    });
  };

  const installChartTooltipEnhancer = () => {
    if (!ENABLE_CHART_TOOLTIP_ENHANCER) return;
    if (installChartTooltipEnhancer.didInstall) return;
    installChartTooltipEnhancer.didInstall = true;
    document.addEventListener(
      "pointermove",
      (event) => {
        chartPointer = { x: event.clientX, y: event.clientY };
        scheduleChartTooltipEnhance();
      },
      { passive: true },
    );
    window.addEventListener("scroll", clearChartTooltipDetails, { passive: true });
  };

  const scheduleChartTooltipEnhance = () => {
    if (!ENABLE_CHART_TOOLTIP_ENHANCER) return;
    if (!isAnalyticsRoute()) return;
    if (chartTooltipFrame) return;
    chartTooltipFrame = requestAnimationFrame(() => {
      chartTooltipFrame = 0;
      enhanceChartTooltip();
    });
  };

  const enhanceChartTooltip = () => {
    const tooltip = findOfficialChartTooltip();
    if (!tooltip) {
      clearChartTooltipDetails();
      return;
    }
    const host = findOfficialTooltipCard(tooltip) || tooltip;
    host.classList.add("cqc-chart-tooltip-host");
    clearChartTooltipDetails(host);
    if (!latestReport) {
      renderPendingTooltipDetail(tooltip, host);
      ensurePassiveReport({ allowRefresh: true }).then((report) => {
        if (report) scheduleChartTooltipEnhance();
      });
      return;
    }

    const tooltipText = officialTooltipText(tooltip);
    const rows = rowsForTooltipText(tooltipText, latestReport.dailyList);
    if (!rows.length) return;

    const key = rows.map((row) => row.date).join(",");

    const existing = host.querySelector(":scope > .cqc-chart-tooltip-detail");
    if (existing?.dataset.key === key) return;

    const detail = existing || document.createElement("div");
    detail.className = "cqc-chart-tooltip-detail";
    detail.dataset.key = key;
    detail.innerHTML = renderChartTooltipDetail(rows);
    applyOfficialTooltipTokens(detail, host);
    if (!existing) host.appendChild(detail);
  };

  const renderPendingTooltipDetail = (tooltip, host) => {
    clearChartTooltipDetails(host);
    let detail = host.querySelector(":scope > .cqc-chart-tooltip-detail");
    if (!detail) {
      detail = document.createElement("div");
      detail.className = "cqc-chart-tooltip-detail";
      host.appendChild(detail);
    }
    if (detail.dataset.key === "pending") return;
    detail.dataset.key = "pending";
    detail.innerHTML = `<div class="cqc-chart-tooltip-title">${escapeHtml(t("tooltipPending"))}</div>`;
    applyOfficialTooltipTokens(detail, host);
  };

  const clearChartTooltipDetails = (exceptHost = null) => {
    document.querySelectorAll(".cqc-chart-tooltip-detail").forEach((detail) => {
      if (!exceptHost || detail.parentElement !== exceptHost) detail.remove();
    });
    document.querySelectorAll(".cqc-chart-tooltip-host").forEach((host) => {
      if (host !== exceptHost && !host.querySelector(".cqc-chart-tooltip-detail")) {
        host.classList.remove("cqc-chart-tooltip-host");
      }
    });
  };

  const findOfficialTooltipCard = (tooltip) => {
    const candidates = [tooltip, ...tooltip.querySelectorAll("div,section,article,ul,li")]
      .filter(isVisibleElement)
      .filter((element) => !element.closest(`#${IDS.overlay}, .cqc-chart-tooltip-detail`))
      .filter(isChartTooltipCandidate)
      .filter((element) => !hasChartTooltipCandidateChild(element));
    return candidates.sort((a, b) => tooltipCardScore(b, tooltip) - tooltipCardScore(a, tooltip))[0] || null;
  };

  const tooltipCardScore = (element, root) => {
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    const style = getComputedStyle(element);
    const hasSurface =
      style.backgroundColor &&
      style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      style.backgroundColor !== "transparent";
    const borderWidth =
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderRightWidth) +
      parseFloat(style.borderBottomWidth) +
      parseFloat(style.borderLeftWidth);
    const padding =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingRight) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.paddingLeft);
    let score = 0;
    if (element !== root) score += 30;
    if (hasSurface) score += 20;
    if (style.boxShadow && style.boxShadow !== "none") score += 12;
    if (parseFloat(style.borderRadius) > 0) score += 8;
    if (borderWidth > 0) score += 6;
    if (padding > 0) score += 4;
    score += Math.max(0, 20 - area / 20000);
    return score;
  };

  const findOfficialChartTooltip = () => {
    const selectors = [
      ".recharts-tooltip-wrapper",
      "[role='tooltip']",
      "[class*='tooltip']",
      "[class*='Tooltip']",
    ].join(",");
    const pointCandidates = chartPointer
      ? document
          .elementsFromPoint(chartPointer.x, chartPointer.y)
          .flatMap((element) => [
            element,
            ...Array.from(element.querySelectorAll?.("div,section,article,ul,li") || []),
          ])
      : [];
    const directCandidates = [...document.querySelectorAll(selectors)].flatMap((element) => [
      element,
      ...element.querySelectorAll("div,section,article,ul,li"),
    ]);
    const candidates = [...new Set([...pointCandidates, ...directCandidates])];
    return candidates
      .filter(isVisibleElement)
      .filter((element) => !element.closest(`#${IDS.overlay}, .cqc-chart-tooltip-detail`))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 160 && rect.width <= 640 && rect.height >= 56 && rect.height <= 560;
      })
      .filter(isChartTooltipCandidate)
      .filter((element) => !hasChartTooltipCandidateChild(element))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.width * ar.height - br.width * br.height;
      })[0] || null;
  };

  const isChartTooltipCandidate = (element) => {
    const text = officialTooltipText(element);
    return hasTooltipDate(text) && /\b(Desktop App|CLI|Cloud|Exec|Other)\b/.test(text);
  };

  const hasChartTooltipCandidateChild = (element) =>
    [...element.children].some((child) => isVisibleElement(child) && isChartTooltipCandidate(child));

  const hasTooltipDate = (text) => {
    if (!text) return false;
    if (dateKeysFromTooltipText(text).length) return true;
    if (!latestReport?.dailyList?.length) {
      return (
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text) ||
        /\b\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\b/.test(text) ||
        /\b\d{1,2}月\d{1,2}日\b/.test(text)
      );
    }
    return latestReport?.dailyList?.some((row) =>
      dateVariants(row.date).some((variant) => textContainsDateVariant(text, variant)),
    );
  };

  const rowsForTooltipText = (text, rows) => {
    if (!text || !Array.isArray(rows)) return [];
    const keys = dateKeysFromTooltipText(text);
    if (keys.length) {
      const exact = rows.filter((row) => keys.includes(row.date));
      if (exact.length <= 1) return exact;
      const sortedExact = [...exact].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const firstExact = sortedExact[0]?.date;
      const lastExact = sortedExact.at(-1)?.date;
      if (!firstExact || !lastExact) return sortedExact;
      return rows
        .filter((row) => row.date >= firstExact && row.date <= lastExact)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    const matches = rows.filter((row) =>
      dateVariants(row.date).some((variant) => textContainsDateVariant(text, variant)),
    );
    if (matches.length <= 1) return matches;
    const sorted = [...matches].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = sorted[0]?.date;
    const last = sorted.at(-1)?.date;
    if (!first || !last) return sorted;
    return rows
      .filter((row) => row.date >= first && row.date <= last)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };

  const normalizedText = (value) =>
    String(value || "")
      .toLowerCase()
      .replaceAll(",", "")
      .replace(/\s+/g, " ")
      .trim();

  const dateKeysFromTooltipText = (text) => {
    const value = String(text || "");
    const keys = [];
    const addKey = (year, month, day) => {
      const y = Number(year);
      const m = Number(month);
      const d = Number(day);
      if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return;
      if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return;
      keys.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    };

    value.replace(/\b(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\b/g, (_match, year, month, day) => {
      addKey(year, month, day);
      return _match;
    });

    const monthNames = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    value.replace(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
      (_match, monthName, day, year) => {
        addKey(year, monthNames[String(monthName).toLowerCase()], day);
        return _match;
      },
    );

    const reportYears = [
      ...new Set((latestReport?.dailyList || []).map((row) => String(row.date || "").slice(0, 4))),
    ].filter(Boolean);
    if (reportYears.length === 1) {
      value.replace(/\b(\d{1,2})月(\d{1,2})日\b/g, (_match, month, day) => {
        addKey(reportYears[0], month, day);
        return _match;
      });
    }

    return [...new Set(keys)];
  };

  const officialTooltipText = (element) => {
    const collect = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (!(node instanceof Element) || node.matches(".cqc-chart-tooltip-detail")) return "";
      return [...node.childNodes].map(collect).join(" ");
    };
    return collect(element).replace(/\s+/g, " ").trim();
  };

  const applyOfficialTooltipTokens = (detail, host) => {
    const row = [...host.querySelectorAll("*")]
      .filter((element) => !element.closest(".cqc-chart-tooltip-detail"))
      .find((element) => /\b(Desktop App|CLI|Cloud|Exec|Other)\b/.test(elementText(element)));
    const style = getComputedStyle(row || host);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight);
    const nextFontSize = Number.isFinite(fontSize) ? Math.max(12, Math.min(14, fontSize)) : 13;
    const nextLineHeight = Number.isFinite(lineHeight)
      ? Math.max(nextFontSize + 4, Math.min(20, lineHeight))
      : nextFontSize + 4;
    detail.style.setProperty("--cqc-tooltip-font-size", `${nextFontSize}px`);
    detail.style.setProperty("--cqc-tooltip-line-height", `${nextLineHeight}px`);
  };

  const textContainsDateVariant = (text, variant) => {
    const normalized = normalizedText(text);
    const candidate = normalizedText(variant);
    if (!candidate) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(normalized);
  };

  const dateVariants = (dateKey) => {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return [dateKey].filter(Boolean);
    const [, year, paddedMonth, paddedDay] = match;
    const month = String(Number(paddedMonth));
    const day = String(Number(paddedDay));
    const date = new Date(`${dateKey}T12:00:00`);
    const locales = [
      getPageLocale(),
      "en-US",
      "zh-CN",
      "zh-TW",
      "zh-HK",
      "ja-JP",
      "fr-FR",
      "ru-RU",
      "es-ES",
      "de-DE",
    ];
    const intlVariants = locales.flatMap((locale) =>
      [
        { year: "numeric", month: "short", day: "numeric" },
        { year: "numeric", month: "long", day: "numeric" },
        { month: "short", day: "numeric" },
        { month: "long", day: "numeric" },
      ].map((options) => {
        try {
          return new Intl.DateTimeFormat(locale, options).format(date);
        } catch {
          return "";
        }
      }),
    );
    return [
      dateKey,
      `${year}-${month}-${day}`,
      `${year}/${month}/${day}`,
      `${month}/${day}/${year}`,
      `${month}/${day}`,
      `${year}年${month}月${day}日`,
      `${month}月${day}日`,
      ...intlVariants,
    ].filter(Boolean);
  };

  const renderChartTooltipDetail = (rows) => {
    const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const stats = domain.getStats(sorted);
    const dateLabel =
      sorted.length === 1
        ? sorted[0].date
        : `${sorted[0]?.date || ""} - ${sorted.at(-1)?.date || ""}`;
    return `
      <div class="cqc-chart-tooltip-title">Codex Meter · ${escapeHtml(dateLabel)}</div>
      <div class="cqc-chart-tooltip-grid">
        <span>${escapeHtml(t("table.credits"))}</span><strong>${fmtCredits(stats.credits)}</strong>
        <span>${escapeHtml(t("table.tokens"))}</span><strong>${fmtNum(stats.tokens)}</strong>
        <span>${escapeHtml(t("table.inputTokens"))}</span><strong>${fmtNum(stats.inputTokens)}</strong>
        <span>${escapeHtml(t("table.cache"))}</span><strong>${(stats.cacheRatio * 100).toFixed(0)}%</strong>
        <span>${escapeHtml(t("table.usd"))}</span><strong>${escapeHtml(fmtUsd(stats.credits))}</strong>
        <span>${escapeHtml(t("table.turns"))}</span><strong>${escapeHtml(stats.turns)}</strong>
      </div>
    `;
  };

  const installRouteObserver = () => {
    if (installRouteObserver.didInstall) return;
    installRouteObserver.didInstall = true;
    let lastRoute = `${location.pathname}${location.search}${location.hash}`;
    let scheduled = false;
    const notify = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        lastRoute = `${location.pathname}${location.search}${location.hash}`;
        updateVisibility();
      }, 120);
    };
    const poll = () => {
      const route = `${location.pathname}${location.search}${location.hash}`;
      const routeChanged = route !== lastRoute;
      const hasButton = Boolean(document.getElementById(IDS.button));
      const needsButton = isAnalyticsRoute() && !hasButton;
      const staleButton = !isAnalyticsRoute() && hasButton;
      if (!routeChanged && !needsButton && !staleButton) return;
      lastRoute = route;
      notify();
    };
    const patch = (methodName) => {
      const original = history[methodName];
      history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    };
    patch("pushState");
    patch("replaceState");
    window.addEventListener("popstate", notify);
    window.__codexMeterMutationObserver?.disconnect?.();
    window.__codexMeterMutationObserver = null;
    window.clearInterval(window.__codexMeterRouteInterval);
    window.__codexMeterRouteInterval = window.setInterval(poll, 1200);
    window.addEventListener("visibilitychange", poll);
  };

  const init = () => {
    ensureChromeRuntimeListener();
    installRouteObserver();
    window.__codexQuotaCompassUpdateVisibility = updateVisibility;
    updateVisibility();
  };

  init();
})();
