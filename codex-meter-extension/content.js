(function () {
  "use strict";

  const CONTENT_SCRIPT_VERSION = "0.6.1-model-details";
  const ENABLE_CHART_TOOLTIP_ENHANCER = false;
  const CHART_IDS = {
    controls: "codex-meter-chart-controls",
    switcher: "codex-meter-chart-switcher",
    metric: "codex-meter-chart-metric",
    grouping: "codex-meter-chart-grouping",
    view: "codex-meter-chart-view",
  };
  const CHART_MODE_STORAGE_KEY = "codexMeterUsageChartMode";
  const CHART_METRIC_STORAGE_KEY = "codexMeterUsageChartMetric";
  const CHART_GROUPING_STORAGE_KEY = "codexMeterUsageChartGroupings";
  const CHART_MODES = {
    source: "source",
    meter: "meter",
  };
  const CHART_RANGES = {
    sevenDays: "7d",
    month: "30d",
  };
  const CHART_GROUPINGS = {
    day: "day",
    week: "week",
  };
  const CHART_METRICS = {
    credits: "credits",
    tokens: "tokens",
    usd: "usd",
    turns: "turns",
  };
  const SERIES_GROUPINGS = {
    models: "models",
    clients: "clients",
    tokens: "tokens",
    total: "total",
  };

  if (window.__codexQuotaCompassInstalled === CONTENT_SCRIPT_VERSION) {
    window.__codexQuotaCompassUpdateVisibility?.();
    return;
  }
  window.__codexQuotaCompassInstalled = CONTENT_SCRIPT_VERSION;

  const { CONFIG, DEFAULT_SETTINGS, IDS, isAnalyticsRoute } = window.CodexMeterConfig;
  const domain = window.CodexMeterDomain;
  const chatGptClient = window.CodexMeterChatGptClient;
  const usagePage = window.CodexMeterUsagePage;
  const reportRepository = window.CodexMeterReportRepository;
  const { cacheRatio, compactReport, n, tokenInput, tokenTotal } = domain;

  let latestReport = null;
  let isRunning = false;
  let passiveReportPromise = null;
  let passiveReportError = null;
  let failedPassiveScopeKey = null;
  let cacheHydrationPromise = null;
  let chartTooltipFrame = 0;
  let chartPointer = null;
  let usageChartControlTimer = 0;
  let usageChartResizeFrame = 0;
  let usageChartMode = CHART_MODES.source;
  let meterChartMetric = CHART_METRICS.credits;
  let meterChartGroupings = {
    [CHART_METRICS.credits]: SERIES_GROUPINGS.clients,
    [CHART_METRICS.tokens]: SERIES_GROUPINGS.tokens,
    [CHART_METRICS.usd]: SERIES_GROUPINGS.clients,
    [CHART_METRICS.turns]: SERIES_GROUPINGS.models,
  };
  let meterSettings = { ...DEFAULT_SETTINGS };
  let renderedMeterChartRows = [];
  let renderedMeterChartLegend = [];
  let renderedMeterChartScopeKey = "";
  let meterChartPinnedIndex = null;
  let meterChartHoverIndex = null;
  let meterChartFocusIndex = 0;
  let meterChartGeometryFrame = 0;
  let meterChartModeAnimation = null;
  const meterChartHiddenSeries = new Map();
  const meterChartTextAnimations = new WeakMap();
  let lastPassiveRefreshAt = 0;
  const PASSIVE_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

  const isValidChartMode = (mode) => mode === CHART_MODES.source || mode === CHART_MODES.meter;

  const normalizeSettings = (settings = {}) => ({
    ...DEFAULT_SETTINGS,
    ...settings,
    defaultChartMode: isValidChartMode(settings.defaultChartMode)
      ? settings.defaultChartMode
      : DEFAULT_SETTINGS.defaultChartMode,
  });

  try {
    const storedMode = window.localStorage?.getItem(CHART_MODE_STORAGE_KEY);
    if (storedMode === CHART_MODES.meter || storedMode === CHART_MODES.source) {
      usageChartMode = storedMode;
    }
  } catch {
    usageChartMode = CHART_MODES.source;
  }

  try {
    const storedMetric = window.localStorage?.getItem(CHART_METRIC_STORAGE_KEY);
    if (Object.values(CHART_METRICS).includes(storedMetric)) {
      meterChartMetric = storedMetric;
    }
  } catch {
    meterChartMetric = CHART_METRICS.credits;
  }

  try {
    const storedGroupings = JSON.parse(window.localStorage?.getItem(CHART_GROUPING_STORAGE_KEY) || "{}");
    if (storedGroupings && typeof storedGroupings === "object" && !Array.isArray(storedGroupings)) {
      meterChartGroupings = { ...meterChartGroupings, ...storedGroupings };
    }
  } catch {}

  const applyMeterSettings = (settings, { syncChartMode = true } = {}) => {
    meterSettings = normalizeSettings(settings);
    if (syncChartMode && isValidChartMode(meterSettings.defaultChartMode)) {
      setUsageChartMode(meterSettings.defaultChartMode, { persistSettings: false });
      updateVisibility();
      return;
    }
    updateVisibility();
  };

  const loadMeterSettings = async () => {
    try {
      const data = await chrome.storage.local.get(CONFIG.STORAGE_SETTINGS);
      applyMeterSettings(data[CONFIG.STORAGE_SETTINGS], { syncChartMode: true });
    } catch {
      applyMeterSettings(DEFAULT_SETTINGS, { syncChartMode: true });
    }
  };

  const saveMeterSettings = async (patch) => {
    const nextSettings = normalizeSettings({ ...meterSettings, ...patch });
    meterSettings = nextSettings;
    await chrome.storage.local.set({ [CONFIG.STORAGE_SETTINGS]: nextSettings });
  };

  const installSettingsSync = () => {
    if (installSettingsSync.didInstall) return;
    installSettingsSync.didInstall = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[CONFIG.STORAGE_SETTINGS]) return;
      applyMeterSettings(changes[CONFIG.STORAGE_SETTINGS].newValue, { syncChartMode: true });
    });
  };

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
      chart: {
        source: "官方",
        pendingDay: "此日暂无用量明细。",
        meter: "Meter",
        metric: "指标",
        grouping: "分组",
        loading: "正在读取 Meter 图表数据...",
        empty: "暂无可绘制的用量数据。",
        allDates: "全部日期",
        overview: "整个时间段",
        dataMismatch: "部分分项高于官方总量，图中保留原始明细。",
        modelCreditsUnavailable: "当前区间无模型额度明细",
        groupings: {
          models: "按模型",
          clients: "按使用端",
          tokens: "按 Token 类型",
          total: "只看总量",
        },
        other: "其他",
        clients: {
          CODEX_WORK_WEB: "Work 网页",
          CODEX_WORK_DESKTOP: "Work 桌面端",
          CODEX_CLI: "CLI",
          CODEX_DESKTOP_APP: "Codex 桌面端",
          CODEX_SERVICE_EXEC: "服务执行",
          CODEX_UNKNOWN_DEFAULT: "其他使用端",
        },
        aria: {
          slider: "用量图表日期选择",
          overview: "整个时间段汇总",
          day: "{date}，总计 {total}",
          hideSeries: "隐藏 {label}",
          showSeries: "显示 {label}",
        },
        series: {
          uncachedInput: "未缓存输入",
          cachedInput: "缓存输入",
          output: "输出 Tokens",
        },
      },
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

models: "本周期各模型 Token 用量",
modelsMeta: "费率覆盖 {coverage}% · 费率表 {date}",
},
      metrics: {
        remaining: ["本周期剩余额度比例", "来自官方每周限额进度。"],
        credits: ["本周期已用 Credits", "按每日用量明细加总。"],
        tokens: ["本周期总 Tokens", "按每日用量明细汇总的全部 Tokens。"],
        projected: ["推算周总 Credits", "{confidence}：每日 Credits ÷ 官方已用比例。"],
        projectedUnavailable: ["同步中", "等待每日 Credits 和官方比例同步。"],
        projectionConfidence: {
          high: "高可信",
          medium: "中可信",
          low: "低可信",
        },
        projectionLag: "每日明细可能滞后，稍后更稳。",
        cache: ["输入缓存命中率", "缓存输入占全部输入 Tokens 的比例。"],
        usd: ["推算周价值", "按推算周 Credits × US$40/1000 估算。"],

weightedUsage: ["模型加权用量", "按标准速度费率估算，不含速度倍率；不代表套餐额度或实际账单。"],
weightedUnavailable: ["暂不可用", "等待可用的模型 Token 明细与已知费率。"],
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

dataDelayNotice: "额度百分比接近实时；模型用量与 Credits 明细可能延迟，因此推算结果存在误差。",
quota: {
        weekly: ["每周剩余额度比例", "来自官方普通 Codex 每周限额进度。"],
        short: ["5 小时剩余额度比例", "来自官方普通 Codex 5 小时限额进度。"],
        spark: ["Spark Weekly 剩余额度比例", "来自官方 GPT-5.3-Codex-Spark Weekly 限额进度。"],
        sparkShort: ["Spark 5 小时剩余额度比例", "来自官方 GPT-5.3-Codex-Spark 5 小时限额进度。"],
        unavailable: "未返回",
        reset: "重置：{time}",
      },
modelTable: {
        model: "模型",
        tokens: "总 Tokens",
        uncachedInput: "未缓存输入",
        cachedInput: "缓存输入",
        output: "输出",
        cache: "缓存命中",
        equivalent: "等值 Credits",
        separate: "独立额度",
        unavailable: "未定价",
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
      chart: {
        source: "官方",
        meter: "Meter",
        metric: "指標",
        loading: "正在讀取 Meter 圖表資料...",
        empty: "暫無可繪製的用量資料。",
        series: {
          uncachedInput: "未快取輸入",
          cachedInput: "快取輸入",
          output: "輸出 Tokens",
        },
      },
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
        projected: ["推算每週總 Credits", "{confidence}：每日 Credits ÷ 官方已用比例。"],
        projectedUnavailable: ["同步中", "等待每日 Credits 與官方比例同步。"],
        projectionConfidence: {
          high: "高可信",
          medium: "中可信",
          low: "低可信",
        },
        projectionLag: "每日明細可能滯後，稍後更穩。",
        cache: ["輸入快取命中率", "快取輸入佔全部輸入 Tokens 的比例。"],
        usd: ["推算每週價值", "按推算每週 Credits × US$40/1000 估算。"],
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
      chart: {
        source: "官方",
        meter: "Meter",
        metric: "指標",
        loading: "正在讀取 Meter 圖表資料...",
        empty: "暫時未有可繪製的用量資料。",
        series: {
          uncachedInput: "未快取輸入",
          cachedInput: "快取輸入",
          output: "輸出 Tokens",
        },
      },
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
        projected: ["推算每週總 Credits", "{confidence}：每日 Credits ÷ 官方已用比例。"],
        projectedUnavailable: ["同步中", "等待每日 Credits 同官方比例同步。"],
        projectionConfidence: {
          high: "高可信",
          medium: "中可信",
          low: "低可信",
        },
        projectionLag: "每日明細可能滯後，稍後更穩。",
        cache: ["輸入快取命中率", "快取輸入佔全部輸入 Tokens 的比例。"],
        usd: ["推算每週價值", "按推算每週 Credits × US$40/1000 估算。"],
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
      chart: {
        source: "Official",
        meter: "Meter",
        metric: "Metric",
        grouping: "Group",
        loading: "Reading Meter chart data...",
        empty: "No usage data to chart yet.",
        pendingDay: "No usage details are available for this day.",
        allDates: "All dates",
        overview: "Entire date range",
        dataMismatch: "Some breakdown values exceed the reported total; raw details are preserved.",
        modelCreditsUnavailable: "No per-model credit details in this date range",
        groupings: {
          models: "By model",
          clients: "By client",
          tokens: "By Token type",
          total: "Total only",
        },
        other: "Other",
        clients: {
          CODEX_WORK_WEB: "Work web",
          CODEX_WORK_DESKTOP: "Work desktop",
          CODEX_CLI: "CLI",
          CODEX_DESKTOP_APP: "Codex desktop",
          CODEX_SERVICE_EXEC: "Service execution",
          CODEX_UNKNOWN_DEFAULT: "Other client",
        },
        aria: {
          slider: "Usage chart date selection",
          overview: "Entire date range summary",
          day: "{date}, total {total}",
          hideSeries: "Hide {label}",
          showSeries: "Show {label}",
        },
        series: {
          uncachedInput: "Uncached input",
          cachedInput: "Cached input",
          output: "Output Tokens",
        },
      },
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

models: "Token usage by model this cycle",
modelsMeta: "Rate coverage {coverage}% · rate card {date}",
},
      metrics: {
        remaining: ["Remaining quota this cycle", "From the official weekly quota progress."],
        credits: ["Credits used this cycle", "Totaled from the daily usage details."],
        tokens: ["Total Tokens this cycle", "All Tokens summed from daily usage details."],
        projected: ["Projected weekly Credits", "{confidence}: daily Credits ÷ official used percent."],
        projectedUnavailable: ["Syncing", "Waiting for daily Credits and official percent to sync."],
        projectionConfidence: {
          high: "High confidence",
          medium: "Medium confidence",
          low: "Low confidence",
        },
        projectionLag: "Daily details may lag; refresh later.",
        cache: ["Input cache hit rate", "Cached input as a share of all input Tokens."],
        usd: ["Projected weekly value", "Based on projected weekly Credits at US$40/1000."],

weightedUsage: ["Model-weighted usage", "Standard-speed credit equivalent only, without speed multipliers; not included quota or billed Credits."],
weightedUnavailable: ["Unavailable", "Waiting for per-model Tokens and known rates."],
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

dataDelayNotice: "Quota percentages are near real time; model usage and Credits details may lag, so projections can differ from the final values.",
quota: {
        weekly: ["Weekly quota remaining", "From the official ordinary Codex weekly quota progress."],
        short: ["5-hour quota remaining", "From the official ordinary Codex 5-hour quota progress."],
        spark: ["Spark Weekly quota remaining", "From the official GPT-5.3-Codex-Spark Weekly quota progress."],
        sparkShort: ["Spark 5-hour quota remaining", "From the official GPT-5.3-Codex-Spark 5-hour quota progress."],
        unavailable: "Unavailable",
        reset: "Resets: {time}",
      },
modelTable: {
        model: "Model",
        tokens: "Total Tokens",
        uncachedInput: "Uncached input",
        cachedInput: "Cached input",
        output: "Output",
        cache: "Cache hit",
        equivalent: "Credit equivalent",
        separate: "Separate quota",
        unavailable: "Unpriced",
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
      chart: {
        source: "公式",
        meter: "Meter",
        metric: "指標",
        loading: "Meter グラフデータを読み込んでいます...",
        empty: "グラフ化できる使用量データはまだありません。",
      },
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
        projected: ["推定週間 Credits", "{confidence}: 日別 Credits ÷ 公式使用率。"],
        projectedUnavailable: ["同期中", "日別 Credits と公式使用率の同期を待っています。"],
        projectionConfidence: {
          high: "信頼度 高",
          medium: "信頼度 中",
          low: "信頼度 低",
        },
        projectionLag: "日別明細が遅れることがあります。後で更新してください。",
        cache: ["入力キャッシュヒット率", "全入力 Tokens に占めるキャッシュ済み入力の割合です。"],
        usd: ["推定週間金額", "推定週間 Credits × US$40/1000 で見積もります。"],
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
      chart: {
        source: "Officiel",
        meter: "Meter",
        metric: "Indicateur",
        loading: "Lecture des données du graphique Meter...",
        empty: "Aucune donnée d’utilisation à afficher pour l’instant.",
      },
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
        projected: ["Credits hebdomadaires estimés", "{confidence} : Credits quotidiens ÷ pourcentage officiel utilisé."],
        projectedUnavailable: ["Synchronisation", "En attente des Credits quotidiens et du pourcentage officiel."],
        projectionConfidence: {
          high: "Confiance élevée",
          medium: "Confiance moyenne",
          low: "Confiance faible",
        },
        projectionLag: "Les détails quotidiens peuvent être en retard ; actualisez plus tard.",
        cache: ["Taux de cache des entrées", "Part des entrées mises en cache dans tous les Tokens d’entrée."],
        usd: ["Valeur hebdomadaire estimée", "Basée sur les Credits hebdomadaires estimés à 40 US$/1000."],
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
      chart: {
        source: "Официальный",
        meter: "Meter",
        metric: "Метрика",
        loading: "Чтение данных графика Meter...",
        empty: "Пока нет данных использования для графика.",
      },
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
        projected: ["Прогноз Credits за неделю", "{confidence}: дневные Credits ÷ официальный процент использования."],
        projectedUnavailable: ["Синхронизация", "Ожидаем синхронизации дневных Credits и официального процента."],
        projectionConfidence: {
          high: "Высокая уверенность",
          medium: "Средняя уверенность",
          low: "Низкая уверенность",
        },
        projectionLag: "Дневная детализация может запаздывать; обновите позже.",
        cache: ["Доля попаданий кэша ввода", "Кэшированный ввод как доля всех входных Tokens."],
        usd: ["Прогноз стоимости за неделю", "По прогнозным недельным Credits из расчета US$40 за 1000."],
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
      chart: {
        source: "Oficial",
        meter: "Meter",
        metric: "Métrica",
        loading: "Leyendo los datos del gráfico Meter...",
        empty: "Aún no hay datos de uso para graficar.",
      },
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
        projected: ["Credits semanales estimados", "{confidence}: Credits diarios ÷ porcentaje oficial usado."],
        projectedUnavailable: ["Sincronizando", "Esperando los Credits diarios y el porcentaje oficial."],
        projectionConfidence: {
          high: "Confianza alta",
          medium: "Confianza media",
          low: "Confianza baja",
        },
        projectionLag: "Los detalles diarios pueden retrasarse; actualiza más tarde.",
        cache: ["Tasa de aciertos de caché de entrada", "Entradas en caché como parte de todos los Tokens de entrada."],
        usd: ["Valor semanal estimado", "Basado en los Credits semanales estimados a US$40/1000."],
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
      chart: {
        source: "Offiziell",
        meter: "Meter",
        metric: "Kennzahl",
        loading: "Meter-Diagrammdaten werden gelesen...",
        empty: "Noch keine Nutzungsdaten für das Diagramm.",
      },
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
        projected: ["Geschätzte Wochen-Credits", "{confidence}: tägliche Credits ÷ offizieller Nutzungsanteil."],
        projectedUnavailable: ["Synchronisierung", "Warte auf tägliche Credits und offiziellen Nutzungsanteil."],
        projectionConfidence: {
          high: "Hohe Sicherheit",
          medium: "Mittlere Sicherheit",
          low: "Niedrige Sicherheit",
        },
        projectionLag: "Tägliche Details können verzögert sein; später aktualisieren.",
        cache: ["Cache-Trefferquote für Eingaben", "Zwischengespeicherte Eingaben als Anteil aller Eingabe-Tokens."],
        usd: ["Geschätzter Wochenwert", "Basierend auf geschätzten Wochen-Credits zu US$40/1000."],
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

  const chartChevronIcon = () => `
    <svg class="cqc-icon cqm-chart-chevron" viewBox="0 0 20 21" fill="none" aria-hidden="true">
      <path d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z" fill="currentColor" stroke="currentColor" stroke-width=".6" />
    </svg>
  `;

  const chartCheckIcon = () => `
    <svg class="cqc-icon cqm-chart-check" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.5624 4.0338C11.7255 3.79403 12.0522 3.73111 12.2919 3.89415C12.5314 4.05717 12.5933 4.38398 12.4306 4.62364L7.539 11.818C7.30083 12.1681 6.80219 12.215 6.50286 11.9156L3.62786 9.03478C3.4231 8.82953 3.42363 8.4964 3.62884 8.29161C3.8341 8.08683 4.16722 8.08733 4.372 8.29259L6.92474 10.8512L11.5624 4.0338Z" />
    </svg>
  `;

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
    getDateRange: () => usagePage.readDateRange(getPageLocale()),
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

  const isLikelyMainContentRect = (rect, minWidth = 320) =>
    rect.width >= minWidth && rect.right >= minWidth;

  const visibleMainSections = () =>
    [...document.querySelectorAll("main section, main article, section")]
      .filter(isVisibleElement)
      .filter((section) => {
        const rect = section.getBoundingClientRect();
        return isLikelyMainContentRect(rect) && section.querySelector("h2,h3");
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
        return rect.width > 0 && rect.right > 120;
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
    return (
      mainHeadings().find((heading) => {
        const text = elementText(heading);
        return labels.some((label) => text === label || text.startsWith(label));
      }) || null
    );
  };

  const sectionForHeading = (heading) => {
    if (!heading) return null;
    const headingRect = heading.getBoundingClientRect();
    let candidate = null;
    let current = heading?.parentElement || null;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      const startsNearHeading = rect.top <= headingRect.top + 8 && headingRect.top - rect.top <= 96;
      if (isLikelyMainContentRect(rect) && startsNearHeading) {
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

  const findProductUsageSection = () => usagePage.findMount()?.section || null;

  const findProductChartHeading = (section) => {
    const mount = usagePage.findMount();
    return mount?.section === section ? mount.heading : null;
  };

  const findProductChartFrame = (section) => {
    const mount = usagePage.findMount();
    return mount?.section === section ? { frame: mount.frame, legend: mount.legend } : null;
  };

  const clearProductChartMountMarks = () => {
    document
      .querySelectorAll("[data-cqm-source-chart-frame], [data-cqm-source-chart-legend]")
      .forEach((element) => {
        element.removeAttribute("data-cqm-source-chart-frame");
        element.removeAttribute("data-cqm-source-chart-legend");
      });
  };

  const markProductChartMount = (chartMount) => {
    clearProductChartMountMarks();
    chartMount?.frame?.setAttribute("data-cqm-source-chart-frame", "true");
    chartMount?.legend?.setAttribute("data-cqm-source-chart-legend", "true");
  };

  const ensureMeterPeriodLabel = (mount = usagePage.findMount()) => {
    const periodHeader = mount?.periodHeader;
    if (!periodHeader) return null;
    const labelHost = periodHeader.firstElementChild;
    if (!labelHost) return null;
    const sourceLabel = [...labelHost.children].find(
      (child) => child.matches?.("span") && !child.matches(".cqm-meter-period-label"),
    );
    if (!sourceLabel) return null;
    setAttributeIfChanged(sourceLabel, "data-cqm-source-period", "true");
    let label = labelHost.querySelector(":scope > .cqm-meter-period-label");
    if (!label) {
      label = document.createElement("span");
      label.className = "cqm-meter-period-label";
      label.setAttribute("aria-live", "polite");
      labelHost.insertBefore(label, sourceLabel.nextSibling);
    }
    return label;
  };

  const setMeterPeriodLabel = (index = meterChartPinnedIndex) => {
    const label = ensureMeterPeriodLabel();
    if (!label) return;
    const scope = meterChartScope();
    const selectedDate = index == null ? null : renderedMeterChartRows[index]?.date;
    const text = selectedDate
      ? formatAxisDate(selectedDate)
      : `${formatPeriodDate(renderedMeterChartRows[0]?.date || scope.startDate)} – ${formatPeriodDate(
          renderedMeterChartRows.at(-1)?.date || scope.endDate,
        )}`;
    fadeMeterText(label, text);
  };

  const findUsageDetailsMount = () => {
    const mount = usagePage.findMount();
    return mount ? { ...mount, placement: "inline" } : null;
  };

  const ensureDetailButton = () => {
    if (!isAnalyticsRoute() || !meterSettings.showPageButton) {
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
    if (button.parentElement !== mount.header) mount.header.appendChild(button);
    if (!isRunning) setTriggerButton("gauge", t("trigger.label"));
    setDatasetIfChanged(button, "visible", "true");
    return true;
  };

  const removeDetailButton = () => {
    document.getElementById(IDS.button)?.remove();
  };

  const ensureUsageChartSwitch = () => {
    if (!isAnalyticsRoute() || !meterSettings.showChartControls) {
      removeUsageChartSwitch();
      return false;
    }

    const mount = usagePage.findMount();
    if (!mount?.frame || !mount?.heading) {
      if (meterChartModeAnimation) return false;
      removeUsageChartSwitch();
      return false;
    }
    const { section, heading, chartBody, controlsRow } = mount;
    setDatasetIfChanged(section, "cqmLayout", "usage");
    setDatasetIfChanged(chartBody, "cqmLayout", "usage");
    if (!chartBody.classList.contains("cqm-usage-chart-body")) chartBody.classList.add("cqm-usage-chart-body");
    const chartMount = { frame: mount.frame, legend: mount.legend };
    markProductChartMount(chartMount);
    ensureMeterPeriodLabel(mount);
    setMeterPeriodLabel();
    const sourceDimension = [...controlsRow.children].find((child) => child.matches("button"));
    if (sourceDimension) setDatasetIfChanged(sourceDimension, "cqmSourceDimension", "true");
    let toolbar = controlsRow.querySelector(".cqm-usage-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "cqm-usage-toolbar";
      controlsRow.insertBefore(toolbar, mount.rangeGroup.nextSibling);
    }

    let controls = document.getElementById(CHART_IDS.controls);
    if (controls && controls.dataset.cqmContentVersion !== CONTENT_SCRIPT_VERSION) {
      controls.remove();
      controls = null;
    }
    if (!controls) {
      controls = document.createElement("div");
      controls.id = CHART_IDS.controls;
      controls.dataset.cqmContentVersion = CONTENT_SCRIPT_VERSION;
    }
    if (controls.parentElement !== toolbar) toolbar.appendChild(controls);

    let switcher = document.getElementById(CHART_IDS.switcher);
    if (!switcher) {
      switcher = document.createElement("div");
      switcher.id = CHART_IDS.switcher;
      switcher.className = "cqm-chart-switcher";
      switcher.setAttribute("role", "tablist");
      switcher.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cqm-chart-mode]");
        if (!button || !switcher.contains(button)) return;
        event.preventDefault();
        const nextMode = button.dataset.cqmChartMode;
        if (nextMode === usageChartMode || button.dataset.active === "true") return;
        setUsageChartMode(nextMode);
      });
    }

    const switcherRenderKey = `${getLocale()}|${t("chart.source")}|${t("chart.meter")}`;
    const switcherHtml = `
      <button type="button" role="tab" data-cqm-chart-mode="${CHART_MODES.source}">
        ${escapeHtml(t("chart.source"))}
      </button>
      <button type="button" role="tab" data-cqm-chart-mode="${CHART_MODES.meter}">
        ${escapeHtml(t("chart.meter"))}
      </button>
    `;
    if (switcher.dataset.renderKey !== switcherRenderKey) {
      switcher.dataset.renderKey = switcherRenderKey;
      setHtmlIfChanged(switcher, switcherHtml);
    }
    if (switcher.parentElement !== controls) controls.appendChild(switcher);

    let metric = document.getElementById(CHART_IDS.metric);
    if (!metric) {
      metric = document.createElement("div");
      metric.id = CHART_IDS.metric;
      metric.addEventListener("click", (event) => {
        const option = event.target.closest("[data-cqm-chart-metric]");
        if (option && metric.contains(option)) {
          event.preventDefault();
          event.stopPropagation();
          setMeterChartMetric(option.dataset.cqmChartMetric);
          return;
        }
        const button = event.target.closest(".cqm-chart-metric-button");
        if (button && metric.contains(button)) {
          event.preventDefault();
          event.stopPropagation();
          toggleMeterMenu(CHART_IDS.metric);
        }
      });
    }
    const metricRenderKey = `${getLocale()}|${meterChartMetric}`;
    if (metric.dataset.renderKey !== metricRenderKey) {
      metric.dataset.renderKey = metricRenderKey;
      setHtmlIfChanged(metric, renderMeterMetricControl());
    }
    if (metric.parentElement !== controls) controls.appendChild(metric);

    let grouping = document.getElementById(CHART_IDS.grouping);
    if (!grouping) {
      grouping = document.createElement("div");
      grouping.id = CHART_IDS.grouping;
      grouping.className = "cqm-chart-grouping";
      grouping.addEventListener("click", (event) => {
        const option = event.target.closest("[data-cqm-chart-grouping]");
        if (option && grouping.contains(option)) {
          event.preventDefault();
          event.stopPropagation();
          if (option.getAttribute("aria-disabled") !== "true") {
            setMeterChartGrouping(option.dataset.cqmChartGrouping);
          }
          return;
        }
        const button = event.target.closest(".cqm-chart-metric-button");
        if (button && grouping.contains(button)) {
          event.preventDefault();
          event.stopPropagation();
          toggleMeterMenu(CHART_IDS.grouping);
        }
      });
    }
    const groupingRenderKey = meterGroupingRenderKey();
    if (grouping.dataset.renderKey !== groupingRenderKey) {
      grouping.dataset.renderKey = groupingRenderKey;
      setHtmlIfChanged(grouping, renderMeterGroupingControl());
    }
    if (grouping.parentElement !== controls) controls.appendChild(grouping);
    installMeterMetricDismiss();

    let view = document.getElementById(CHART_IDS.view);
    if (view && view.dataset.cqmContentVersion !== CONTENT_SCRIPT_VERSION) {
      view.remove();
      view = null;
    }
    if (!view) {
      view = document.createElement("div");
      view.id = CHART_IDS.view;
      view.className = "cqm-meter-chart-view";
      view.dataset.cqmContentVersion = CONTENT_SCRIPT_VERSION;
      view.addEventListener("pointermove", handleMeterChartPointerMove);
      view.addEventListener("pointerleave", handleMeterChartPointerLeave);
      view.addEventListener("click", handleMeterChartClick);
      view.addEventListener("keydown", handleMeterChartKeyDown);
      view.addEventListener("focusin", handleMeterChartFocusIn);
      view.addEventListener("focusout", handleMeterChartFocusOut);
    }
    if (view.parentElement !== chartBody) chartBody.appendChild(view);

    setDatasetIfChanged(section, "cqmMeterChartMode", usageChartMode);
    updateUsageChartSwitcher(switcher);
    updateMeterMetricControl(metric);
    updateMeterGroupingControl(grouping);
    positionUsageChartLayer(view);
    renderMeterChartView();
    if (usageChartMode === CHART_MODES.meter && !reportCoversChartRange(latestReport)) {
      renderMeterChartLoading();
      ensurePassiveReport({ allowRefresh: true }).then((report) => {
        if (report && usageChartMode === CHART_MODES.meter) renderMeterChartView();
      });
    }
    return true;
  };

  const removeUsageChartSwitch = () => {
    finishUsageChartModeAnimation();
    if (meterChartGeometryFrame) {
      window.cancelAnimationFrame(meterChartGeometryFrame);
      meterChartGeometryFrame = 0;
    }
    const tooltip = document.querySelector(`#${CHART_IDS.view} .cqm-meter-chart-tooltip`);
    if (tooltip?.cqmHideTimer) window.clearTimeout(tooltip.cqmHideTimer);
    document.getElementById(CHART_IDS.controls)?.remove();
    document.getElementById(CHART_IDS.switcher)?.remove();
    document.getElementById(CHART_IDS.metric)?.remove();
    document.getElementById(CHART_IDS.grouping)?.remove();
    document.getElementById(CHART_IDS.view)?.remove();
    clearProductChartMountMarks();
    document.querySelectorAll(".cqm-usage-toolbar").forEach((toolbar) => toolbar.remove());
    document.querySelectorAll("[data-cqm-meter-chart-mode]").forEach((section) => {
      delete section.dataset.cqmMeterChartMode;
    });
    document.querySelectorAll("[data-cqm-layout='usage']").forEach((element) => {
      delete element.dataset.cqmLayout;
      element.classList.remove("cqm-usage-chart-body");
    });
    document.querySelectorAll("[data-cqm-source-dimension]").forEach((element) => {
      delete element.dataset.cqmSourceDimension;
    });
    document.querySelectorAll(".cqm-meter-period-label").forEach((element) => element.remove());
    document.querySelectorAll("[data-cqm-source-period]").forEach((element) => {
      delete element.dataset.cqmSourcePeriod;
    });
    meterChartPinnedIndex = null;
    meterChartHoverIndex = null;
    meterChartFocusIndex = 0;
  };

  const setUsageChartMode = (mode, { persistSettings = true } = {}) => {
    if (mode !== CHART_MODES.source && mode !== CHART_MODES.meter) return;
    if (mode === usageChartMode) return;
    const previousMode = usageChartMode;
    const transitionSnapshot = captureUsageChartModeTransition();
    usageChartMode = mode;
    passiveReportError = null;
    failedPassiveScopeKey = null;
    try {
      window.localStorage?.setItem(CHART_MODE_STORAGE_KEY, mode);
    } catch {}
    if (persistSettings) {
      saveMeterSettings({ defaultChartMode: mode }).catch(() => {});
    }
    if (mode === CHART_MODES.source) {
      document.querySelectorAll("[data-cqm-meter-chart-mode]").forEach((section) => {
        setDatasetIfChanged(section, "cqmMeterChartMode", mode);
      });
      hideMeterChartTooltip(true);
    }
    ensureUsageChartSwitch();
    animateUsageChartModeTransition(previousMode, mode, transitionSnapshot);
  };

  const setMeterChartMetric = (metric) => {
    if (!Object.values(CHART_METRICS).includes(metric)) return;
    meterChartMetric = metric;
    try {
      window.localStorage?.setItem(CHART_METRIC_STORAGE_KEY, metric);
    } catch {}
    syncMeterChartGrouping(groupingAvailabilityRows());
    meterChartHiddenSeries.clear();
    meterChartPinnedIndex = null;
    meterChartFocusIndex = 0;
    hideMeterChartTooltip(true);
    refreshMeterChartControls();
    renderMeterChartView();
  };

  const legalMeterGroupings = (metric = meterChartMetric) =>
    metric === CHART_METRICS.tokens
      ? [SERIES_GROUPINGS.tokens, SERIES_GROUPINGS.clients]
      : [SERIES_GROUPINGS.models, SERIES_GROUPINGS.clients, SERIES_GROUPINGS.total];

  const defaultMeterGrouping = (metric = meterChartMetric) => {
    if (metric === CHART_METRICS.tokens) return SERIES_GROUPINGS.tokens;
    if (metric === CHART_METRICS.turns) return SERIES_GROUPINGS.models;
    return SERIES_GROUPINGS.clients;
  };

  const groupingAvailabilityRows = () => {
    if (!latestReport) return renderedMeterChartRows;
    return meterChartRows(latestReport, meterChartScope(latestReport));
  };

  const isMeterGroupingAvailable = (grouping, metric = meterChartMetric, rows = groupingAvailabilityRows()) => {
    if (!legalMeterGroupings(metric).includes(grouping)) return false;
    if (grouping !== SERIES_GROUPINGS.models || ![CHART_METRICS.credits, CHART_METRICS.usd].includes(metric)) {
      return true;
    }
    if (!latestReport) return true;
    return rows.some((row) =>
      (row.rawRow?.models || []).some((model) => n(model?.credits) > 0),
    );
  };

  const syncMeterChartGrouping = (rows = groupingAvailabilityRows()) => {
    const stored = meterChartGroupings[meterChartMetric];
    const fallback = defaultMeterGrouping(meterChartMetric);
    const next = isMeterGroupingAvailable(stored, meterChartMetric, rows)
      ? stored
      : isMeterGroupingAvailable(fallback, meterChartMetric, rows)
        ? fallback
        : legalMeterGroupings(meterChartMetric).find((grouping) =>
            isMeterGroupingAvailable(grouping, meterChartMetric, rows),
          ) || legalMeterGroupings(meterChartMetric)[0];
    if (stored === next) return next;
    meterChartGroupings[meterChartMetric] = next;
    try {
      window.localStorage?.setItem(CHART_GROUPING_STORAGE_KEY, JSON.stringify(meterChartGroupings));
    } catch {}
    return next;
  };

  const currentMeterChartGrouping = (rows = groupingAvailabilityRows()) => syncMeterChartGrouping(rows);

  const setMeterChartGrouping = (grouping) => {
    const rows = groupingAvailabilityRows();
    if (!isMeterGroupingAvailable(grouping, meterChartMetric, rows)) return;
    meterChartGroupings[meterChartMetric] = grouping;
    meterChartHiddenSeries.clear();
    try {
      window.localStorage?.setItem(CHART_GROUPING_STORAGE_KEY, JSON.stringify(meterChartGroupings));
    } catch {}
    meterChartPinnedIndex = null;
    meterChartFocusIndex = 0;
    hideMeterChartTooltip(true);
    refreshMeterChartControls();
    renderMeterChartView();
  };

  const toggleMeterMenu = (controlId) => {
    const control = document.getElementById(controlId);
    if (!control) return;
    const nextOpen = control.dataset.open === "true" ? "false" : "true";
    [CHART_IDS.metric, CHART_IDS.grouping].forEach((id) => {
      if (id === controlId) return;
      const other = document.getElementById(id);
      if (!other) return;
      setDatasetIfChanged(other, "open", "false");
      other.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", "false");
    });
    hideMeterChartTooltip(true);
    setDatasetIfChanged(control, "open", nextOpen);
    control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", nextOpen);
  };

  const installMeterMetricDismiss = () => {
    if (installMeterMetricDismiss.didInstall) return;
    installMeterMetricDismiss.didInstall = true;
    document.addEventListener(
      "pointerdown",
      (event) => {
        [CHART_IDS.metric, CHART_IDS.grouping].forEach((id) => {
          const control = document.getElementById(id);
          if (!control || control.contains(event.target)) return;
          setDatasetIfChanged(control, "open", "false");
          control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", "false");
        });
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      [CHART_IDS.metric, CHART_IDS.grouping].forEach((id) => {
        const control = document.getElementById(id);
        if (!control) return;
        setDatasetIfChanged(control, "open", "false");
        control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", "false");
      });
    });
  };

  const updateUsageChartSwitcher = (switcher) => {
    switcher.querySelectorAll("[data-cqm-chart-mode]").forEach((button) => {
      const active = button.dataset.cqmChartMode === usageChartMode;
      setAttributeIfChanged(button, "aria-selected", active ? "true" : "false");
      setDatasetIfChanged(button, "active", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
  };

  const meterMetricColors = {
    [CHART_METRICS.credits]: "var(--color-chart-blue)",
    [CHART_METRICS.tokens]: "var(--color-chart-blue)",
    [CHART_METRICS.usd]: "var(--color-chart-green)",
    [CHART_METRICS.turns]: "var(--color-chart-purple)",
  };

  const meterTokenSeries = () => [
    { key: "uncachedInput", label: t("chart.series.uncachedInput"), color: "var(--color-chart-orange)" },
    { key: "cachedInput", label: t("chart.series.cachedInput"), color: "var(--color-chart-blue)" },
    { key: "output", label: t("chart.series.output"), color: "var(--color-chart-purple)" },
  ];

  const meterMetricOptions = () => [
    { key: CHART_METRICS.credits, label: t("table.credits"), color: meterMetricColors[CHART_METRICS.credits] },
    { key: CHART_METRICS.tokens, label: t("table.tokens"), color: meterMetricColors[CHART_METRICS.tokens] },
    { key: CHART_METRICS.usd, label: t("table.usd"), color: meterMetricColors[CHART_METRICS.usd] },
    { key: CHART_METRICS.turns, label: t("table.turns"), color: meterMetricColors[CHART_METRICS.turns] },
  ];

  const currentMeterMetricOption = () =>
    meterMetricOptions().find((option) => option.key === meterChartMetric) || meterMetricOptions()[0];

  const renderMeterMetricControl = () => {
    const current = currentMeterMetricOption();
    return `
      <button
        type="button"
        class="cqm-chart-metric-button"
        aria-haspopup="menu"
        aria-expanded="false"
      >
        <span>${escapeHtml(current.label)}</span>
        ${chartChevronIcon()}
      </button>
      <div class="cqm-chart-metric-menu" role="menu">
        ${meterMetricOptions()
          .map(
            (option) => `
              <button
                type="button"
                class="cqm-chart-metric-option"
                role="menuitemradio"
                aria-checked="${option.key === meterChartMetric ? "true" : "false"}"
                data-cqm-chart-metric="${option.key}"
              >
                <span><i class="cqm-chart-metric-swatch" style="--cqm-series-color:${escapeHtml(option.color)}"></i>${escapeHtml(option.label)}</span>
                ${chartCheckIcon()}
              </button>
            `,
          )
          .join("")}
      </div>
    `;
  };

  const updateMeterMetricControl = (control = document.getElementById(CHART_IDS.metric)) => {
    if (!control) return;
    const visible = usageChartMode === CHART_MODES.meter;
    setDatasetIfChanged(control, "visible", visible ? "true" : "false");
    if (!visible) setDatasetIfChanged(control, "open", "false");
    control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", control.dataset.open === "true" ? "true" : "false");
    control.querySelectorAll("[data-cqm-chart-metric]").forEach((option) => {
      option.setAttribute("aria-checked", option.dataset.cqmChartMetric === meterChartMetric ? "true" : "false");
    });
  };

  const meterGroupingLabel = (grouping) => t(`chart.groupings.${grouping}`);

  const meterGroupingOptions = (rows = groupingAvailabilityRows()) =>
    legalMeterGroupings().map((grouping) => ({
      key: grouping,
      label: meterGroupingLabel(grouping),
      available: isMeterGroupingAvailable(grouping, meterChartMetric, rows),
      reason:
        grouping === SERIES_GROUPINGS.models && [CHART_METRICS.credits, CHART_METRICS.usd].includes(meterChartMetric)
          ? t("chart.modelCreditsUnavailable")
          : "",
    }));

  const meterGroupingRenderKey = () => {
    const rows = groupingAvailabilityRows();
    return `${getLocale()}|${meterChartMetric}|${currentMeterChartGrouping(rows)}|${meterGroupingOptions(rows)
      .map((option) => `${option.key}:${option.available}`)
      .join("|")}`;
  };

  const renderMeterGroupingControl = () => {
    const rows = groupingAvailabilityRows();
    const current = currentMeterChartGrouping(rows);
    return `
      <button
        type="button"
        class="cqm-chart-metric-button cqm-chart-grouping-button"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="${escapeHtml(`${t("chart.grouping")}: ${meterGroupingLabel(current)}`)}"
      >
        <span>${escapeHtml(meterGroupingLabel(current))}</span>
        ${chartChevronIcon()}
      </button>
      <div class="cqm-chart-metric-menu cqm-chart-grouping-menu" role="menu">
        ${meterGroupingOptions(rows)
          .map(
            (option) => `
              <button
                type="button"
                class="cqm-chart-metric-option cqm-chart-grouping-option"
                role="menuitemradio"
                aria-checked="${option.key === current ? "true" : "false"}"
                aria-disabled="${option.available ? "false" : "true"}"
                data-cqm-chart-grouping="${option.key}"
                ${option.available ? "" : `title="${escapeHtml(option.reason)}"`}
              >
                <span>${escapeHtml(option.label)}${
                  option.available ? "" : `<small class="cqm-chart-option-note">${escapeHtml(option.reason)}</small>`
                }</span>
                ${chartCheckIcon()}
              </button>
            `,
          )
          .join("")}
      </div>
    `;
  };

  const updateMeterGroupingControl = (control = document.getElementById(CHART_IDS.grouping)) => {
    if (!control) return;
    const visible = usageChartMode === CHART_MODES.meter;
    setDatasetIfChanged(control, "visible", visible ? "true" : "false");
    if (!visible) setDatasetIfChanged(control, "open", "false");
    control.querySelector(".cqm-chart-metric-button")?.setAttribute(
      "aria-expanded",
      control.dataset.open === "true" ? "true" : "false",
    );
  };

  const refreshMeterChartControls = () => {
    const metric = document.getElementById(CHART_IDS.metric);
    if (metric) {
      metric.dataset.renderKey = `${getLocale()}|${meterChartMetric}`;
      setHtmlIfChanged(metric, renderMeterMetricControl());
      setDatasetIfChanged(metric, "open", "false");
      updateMeterMetricControl(metric);
    }
    const grouping = document.getElementById(CHART_IDS.grouping);
    if (grouping) {
      grouping.dataset.renderKey = meterGroupingRenderKey();
      setHtmlIfChanged(grouping, renderMeterGroupingControl());
      setDatasetIfChanged(grouping, "open", "false");
      updateMeterGroupingControl(grouping);
    }
  };

  const positionUsageChartLayer = () => {};

  const prefersReducedMeterMotion = () =>
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

  const finishUsageChartModeAnimation = () => {
    if (!meterChartModeAnimation) return;
    meterChartModeAnimation.cleanup();
    meterChartModeAnimation = null;
  };

  const METER_MODE_INLINE_PROPERTIES = [
    "display",
    "position",
    "left",
    "top",
    "width",
    "height",
    "box-sizing",
    "z-index",
    "pointer-events",
    "opacity",
    "flex-shrink",
  ];

  const captureInlineStyles = (element, properties = METER_MODE_INLINE_PROPERTIES) =>
    Object.fromEntries(
      properties.map((property) => [
        property,
        {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        },
      ]),
    );

  const restoreInlineStyles = (element, styles) => {
    if (!element || !styles) return;
    Object.entries(styles).forEach(([property, { value, priority }]) => {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    });
  };

  const transitionSnapshotStyles = (element, activeAnimation) => {
    const original = activeAnimation?.originalStylesByElement?.get(element);
    if (!original) return captureInlineStyles(element);
    if (activeAnimation.fullRestoreElements?.has(element)) return original;
    const current = captureInlineStyles(element);
    if (original["flex-shrink"]) current["flex-shrink"] = original["flex-shrink"];
    return current;
  };

  const captureUsageChartModeTransition = () => {
    const activeAnimation = meterChartModeAnimation;
    const mount = usagePage.findMount();
    const view = document.getElementById(CHART_IDS.view);
    if (!mount?.chartBody || !view) {
      finishUsageChartModeAnimation();
      return null;
    }
    const bodyRect = mount.chartBody.getBoundingClientRect();
    const sourceLayers = [mount.frame, mount.legend].filter(Boolean);
    const source = sourceLayers.map((element) => {
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      return {
        element,
        display: computed.display === "none" ? "block" : computed.display,
        opacity: computed.display === "none" ? 0 : n(computed.opacity || 1),
        inlineStyles: transitionSnapshotStyles(element, activeAnimation),
        left: rect.left - bodyRect.left,
        top: rect.top - bodyRect.top,
        width: rect.width,
        height: rect.height,
      };
    });
    const viewRect = view.getBoundingClientRect();
    const viewComputed = getComputedStyle(view);
    const snapshot = {
      chartBody: mount.chartBody,
      bodyHeight: bodyRect.height,
      bodyInlineStyles:
        activeAnimation?.bodyInlineStyles || captureInlineStyles(mount.chartBody, ["height", "overflow", "transition"]),
      source,
      view: {
        element: view,
        display: viewComputed.display === "none" ? "block" : viewComputed.display,
        opacity: viewComputed.display === "none" ? 0 : n(viewComputed.opacity),
        inlineStyles: transitionSnapshotStyles(view, activeAnimation),
        left: viewRect.left - bodyRect.left,
        top: viewRect.top - bodyRect.top,
        width: viewRect.width,
        height: viewRect.height,
      },
    };
    finishUsageChartModeAnimation();
    return snapshot;
  };

  const animateUsageChartModeTransition = (previousMode, nextMode, snapshot) => {
    if (!snapshot || previousMode === nextMode || prefersReducedMeterMotion()) return;
    const mount = usagePage.findMount();
    const view = document.getElementById(CHART_IDS.view);
    if (!mount?.chartBody || mount.chartBody !== snapshot.chartBody || !view) return;
    const body = mount.chartBody;
    const duration = 300;
    const outgoing = previousMode === CHART_MODES.source ? snapshot.source : [snapshot.view];
    const incoming = nextMode === CHART_MODES.source ? [mount.frame, mount.legend].filter(Boolean) : [view];
    const snapshotByElement = new Map([...snapshot.source, snapshot.view].map((layer) => [layer.element, layer]));
    const initialTargetHeight = body.getBoundingClientRect().height;
    const animations = [];
    outgoing.forEach((layer) => {
      const { element } = layer;
      if (!element?.isConnected) return;
      Object.assign(element.style, {
        display: layer.display,
        position: "absolute",
        left: `${layer.left}px`,
        top: `${layer.top}px`,
        width: `${layer.width}px`,
        height: `${layer.height}px`,
        boxSizing: "border-box",
        zIndex: "2",
        pointerEvents: "none",
      });
      animations.push(
        element.animate([{ opacity: layer.opacity }, { opacity: 0 }], {
          duration,
          easing: "cubic-bezier(.2, 0, 0, 1)",
          fill: "forwards",
        }),
      );
    });
    incoming.forEach((element) => {
      if (!element?.isConnected) return;
      if (!snapshotByElement.has(element)) {
        snapshotByElement.set(element, {
          element,
          opacity: 0,
          inlineStyles: captureInlineStyles(element),
        });
      }
      const startOpacity = snapshotByElement.get(element)?.opacity ?? 0;
      element.style.flexShrink = "0";
      animations.push(
        element.animate([{ opacity: startOpacity }, { opacity: 1 }], {
          duration,
          easing: "cubic-bezier(.2, 0, 0, 1)",
          fill: "forwards",
        }),
      );
    });
    body.style.height = `${snapshot.bodyHeight}px`;
    body.style.overflow = "hidden";
    body.style.transition = `height ${duration}ms cubic-bezier(.2, 0, 0, 1)`;
    body.getBoundingClientRect();
    let heightFrame = 0;
    let maxTimer = 0;
    let cleaned = false;
    let lastTargetHeight = initialTargetHeight;
    let targetChangedAt = performance.now();
    const refreshIncomingElements = () => {
      if (nextMode !== CHART_MODES.source) return incoming.filter((element) => element?.isConnected);
      const liveMount = usagePage.findMount();
      [liveMount?.frame, liveMount?.legend].filter(Boolean).forEach((element) => {
        if (!incoming.includes(element)) incoming.push(element);
        if (!snapshotByElement.has(element)) {
          const layer = { element, opacity: 0, inlineStyles: captureInlineStyles(element) };
          snapshotByElement.set(element, layer);
          meterChartModeAnimation?.originalStylesByElement?.set(element, layer.inlineStyles);
          element.style.flexShrink = "0";
          if (!prefersReducedMeterMotion() && element.animate) {
            animations.push(
              element.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration,
                easing: "cubic-bezier(.2, 0, 0, 1)",
                fill: "forwards",
              }),
            );
          }
        }
      });
      return incoming.filter((element) => element?.isConnected);
    };
    const measureIncomingHeight = () => {
      const bodyRect = body.getBoundingClientRect();
      const connected = refreshIncomingElements().filter((element) => getComputedStyle(element).display !== "none");
      if (!connected.length) return lastTargetHeight;
      const paddingBottom = Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;
      return (
        Math.max(
          ...connected.map((element) => {
            const style = getComputedStyle(element);
            const marginBottom = Number.parseFloat(style.marginBottom) || 0;
            const rect = element.getBoundingClientRect();
            const contentHeight = Math.max(rect.height, element.scrollHeight || 0);
            return rect.top - bodyRect.top + contentHeight + marginBottom;
          }),
        ) + paddingBottom
      );
    };
    lastTargetHeight = measureIncomingHeight();
    targetChangedAt = performance.now();
    body.style.height = `${lastTargetHeight}px`;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.cancelAnimationFrame(heightFrame);
      window.clearTimeout(maxTimer);
      animations.forEach((animation) => animation.cancel());
      const fullRestoreElements = new Set(outgoing.map((layer) => layer.element));
      fullRestoreElements.forEach((element) => {
        restoreInlineStyles(element, snapshotByElement.get(element)?.inlineStyles);
      });
      incoming.forEach((element) => {
        if (fullRestoreElements.has(element)) return;
        const flexShrink = snapshotByElement.get(element)?.inlineStyles?.["flex-shrink"];
        if (flexShrink) restoreInlineStyles(element, { "flex-shrink": flexShrink });
      });
      restoreInlineStyles(body, snapshot.bodyInlineStyles);
    };
    meterChartModeAnimation = {
      cleanup,
      originalStylesByElement: new Map(
        [...snapshotByElement.entries()].map(([element, layer]) => [element, layer.inlineStyles]),
      ),
      fullRestoreElements: new Set(outgoing.map((layer) => layer.element)),
      bodyInlineStyles: snapshot.bodyInlineStyles,
    };
    const startedAt = performance.now();
    const trackIncomingHeight = (now) => {
      if (meterChartModeAnimation?.cleanup !== cleanup) return;
      const nextTargetHeight = measureIncomingHeight();
      if (Math.abs(nextTargetHeight - lastTargetHeight) > 0.5) {
        lastTargetHeight = nextTargetHeight;
        targetChangedAt = now;
        body.style.height = `${nextTargetHeight}px`;
      }
      const liveLegend = nextMode === CHART_MODES.source ? usagePage.findMount()?.legend : null;
      const sourceLegendReady = nextMode !== CHART_MODES.source || Boolean(liveLegend?.isConnected && liveLegend.getBoundingClientRect().height > 1);
      if (now - startedAt >= duration && sourceLegendReady && now - targetChangedAt >= duration) {
        cleanup();
        meterChartModeAnimation = null;
        return;
      }
      heightFrame = window.requestAnimationFrame(trackIncomingHeight);
    };
    heightFrame = window.requestAnimationFrame(trackIncomingHeight);
    maxTimer = window.setTimeout(() => {
      if (meterChartModeAnimation?.cleanup !== cleanup) return;
      const finalTargetHeight = measureIncomingHeight();
      body.style.height = `${finalTargetHeight}px`;
      window.setTimeout(() => {
        if (meterChartModeAnimation?.cleanup !== cleanup) return;
        cleanup();
        meterChartModeAnimation = null;
      }, duration);
    }, 1200);
  };

  const renderMeterChartLoading = () => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
    delete view.dataset.chartKey;
    setHtmlIfChanged(
      view,
      `<div class="cqm-meter-chart-state">${icon("sparkles")}<span>${escapeHtml(t("chart.loading"))}</span></div>`,
    );
  };

  const renderMeterChartView = () => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
    if (passiveReportError && failedPassiveScopeKey === meterChartScope().key && !reportCoversChartRange(latestReport)) {
      setHtmlIfChanged(view, `<div class="cqm-meter-chart-state" role="alert">${escapeHtml(passiveReportError)}</div>`);
      return;
    }
    if (!latestReport) {
      renderedMeterChartRows = [];
      renderMeterChartLoading();
      return;
    }
    const scope = meterChartScope(latestReport);
    const rows = meterChartRows(latestReport, scope);
    if (!rows.length) {
      renderedMeterChartRows = [];
      view.dataset.chartKey = `empty:${scope.key}`;
      setHtmlIfChanged(
        view,
        `<div class="cqm-meter-chart-state">${icon("barChart")}<span>${escapeHtml(t("chart.empty"))}</span></div>`,
      );
      return;
    }
    if (renderedMeterChartScopeKey && renderedMeterChartScopeKey !== scope.key) {
      meterChartHiddenSeries.clear();
      meterChartPinnedIndex = null;
      meterChartHoverIndex = null;
      meterChartFocusIndex = 0;
    }
    renderedMeterChartScopeKey = scope.key;
    const previousGrouping = meterChartGroupings[meterChartMetric];
    const grouping = syncMeterChartGrouping(rows);
    if (previousGrouping !== grouping) refreshMeterChartControls();
    if (meterChartPinnedIndex != null && meterChartPinnedIndex >= rows.length) {
      meterChartPinnedIndex = null;
      meterChartFocusIndex = 0;
    }
    const rawRows = rows.filter((row) => !row.missing && row.rawRow).map((row) => row.rawRow);
    const fullSummary = domain.chartSummary(rawRows, meterChartMetric, grouping);
    const selectedRows = meterChartPinnedIndex == null ? rawRows : rawRows.filter((row) => row.date === rows[meterChartPinnedIndex]?.date);
    const selectedSummary = domain.chartSummary(selectedRows, meterChartMetric, grouping);
    const legend = meterChartLegend(fullSummary, fullSummary, false);
    const hidden = normalizedMeterHiddenSeries(legend.map((series) => series.key), grouping);
    const chartWidth = meterChartRenderWidth(view);
    const rowDigest = rows
      .map((row) =>
        `${row.date}:${row.missing ? "missing" : "data"}:${domain
          .chartSeries(row.rawRow || {}, meterChartMetric, grouping)
          .map((series) => `${series.key}:${series.value}`)
          .join(",")}`,
      )
      .join("|");
    const key = `${getLocale()}|${meterChartMetric}|${grouping}|${scope.key}|${chartWidth}|${[...hidden]
      .sort()
      .join(",")}|${rowDigest}`;
    renderedMeterChartRows = rows;
    renderedMeterChartLegend = legend;
    if (view.dataset.chartKey !== key) {
      view.dataset.chartKey = key;
      patchMeterChart(view, rows, chartWidth, {
        scope,
        grouping,
        fullSummary,
        selectedSummary,
        legend,
        hidden,
      });
    }
    restoreMeterChartSelection(view);
    updateMeterChartSummaryPreview(meterChartPinnedIndex ?? meterChartHoverIndex);
    const groupingControl = document.getElementById(CHART_IDS.grouping);
    const groupingRenderKey = meterGroupingRenderKey();
    if (groupingControl && groupingControl.dataset.renderKey !== groupingRenderKey) {
      groupingControl.dataset.renderKey = groupingRenderKey;
      setHtmlIfChanged(groupingControl, renderMeterGroupingControl());
      updateMeterGroupingControl(groupingControl);
    }
  };

  const meterChartRenderWidth = (view) => {
    const rectWidth = view?.getBoundingClientRect?.().width || 0;
    const parentWidth = view?.parentElement?.getBoundingClientRect?.().width || 0;
    return Math.max(1, Math.round(rectWidth || parentWidth || 952));
  };

  const meterChartRows = (report, scope = meterChartScope(report)) => {
    const dailyRows = sortedDailyRows(report).filter(
      (row) => row.date >= scope.startDate && row.date <= scope.endDate,
    );
    const byDate = new Map(dailyRows.map((row) => [row.date, row]));
    const rows = [];
    for (let date = scope.startDate; date <= scope.endDate; date = dateKeyAdd(date, 1)) {
      const row = byDate.get(date);
      rows.push({ ...meterChartRowFromTotals(date, row?.totals || {}, { rawRow: row || null }), missing: !row });
    }
    return rows;
  };

  const sortedDailyRows = (report) =>
    [...(report?.dailyList || [])]
      .filter((row) => row?.date && row.date <= domain.localDate())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const meterChartScope = () => {
    const today = domain.localDate();
    const days = usagePage.readRangeDays();
    const extent = usagePage.readDateRange(getPageLocale()) || {
      startDate: dateKeyAdd(today, -(days - 1)),
      endDate: today,
    };
    return {
      range: days === 30 ? CHART_RANGES.month : CHART_RANGES.sevenDays,
      grouping: CHART_GROUPINGS.day,
      ...extent,
      key: `${days}:day:${extent.startDate}:${extent.endDate}`,
    };
  };

  const reportCoversChartRange = (report) => {
    if (!report) return false;
    const range = meterChartScope();
    // Report request bounds describe coverage, including days without usage rows.
    return report.startDate <= range.startDate && report.endDate > range.endDate;
  };

  const aggregateMeterRowsByWeek = (rows, scope) => {
    const buckets = new Map();
    rows.forEach((row) => {
      const startDate = maxDateKey(weekStartDateKey(row.date), scope.startDate);
      const endDate = minDateKey(dateKeyAdd(startDate, 6), scope.endDate);
      const bucketKey = startDate;
      const bucket =
        buckets.get(bucketKey) ||
        {
          date: startDate,
          endDate,
          totals: emptyUsageTotals(),
        };
      bucket.endDate = maxDateKey(bucket.endDate, endDate);
      addUsageTotals(bucket.totals, row.totals || {});
      buckets.set(bucketKey, bucket);
    });
    return [...buckets.values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((bucket) => meterChartRowFromTotals(bucket.date, bucket.totals, { endDate: bucket.endDate }));
  };

  const meterChartRowFromTotals = (date, totals, { endDate = date, rawRow = null } = {}) => {
    const credits = n(totals.credits);
    const tokens = tokenTotal(totals);
    return {
      row: rawRow || { date, totals },
      rawRow,
      date,
      endDate,
      credits,
      usd: credits * CONFIG.USD_PER_CREDIT,
      tokens,
      inputTokens: tokenInput(totals),
      cachedInputTokens: n(totals.cached_text_input_tokens),
      uncachedInputTokens: n(totals.uncached_text_input_tokens),
      outputTokens: n(totals.text_output_tokens),
      cacheRatio: cacheRatio(totals),
      turns: n(totals.turns),
    };
  };

  const emptyUsageTotals = () => ({
    credits: 0,
    turns: 0,
    threads: 0,
    text_total_tokens: 0,
    cached_text_input_tokens: 0,
    uncached_text_input_tokens: 0,
    text_output_tokens: 0,
  });

  const addUsageTotals = (target, totals = {}) => {
    target.credits += n(totals.credits);
    target.turns += n(totals.turns);
    target.threads += n(totals.threads);
    target.text_total_tokens += tokenTotal(totals);
    target.cached_text_input_tokens += n(totals.cached_text_input_tokens);
    target.uncached_text_input_tokens += n(totals.uncached_text_input_tokens);
    target.text_output_tokens += n(totals.text_output_tokens);
  };

  const dateFromKey = (dateKey) => new Date(`${dateKey}T12:00:00`);
  const dateKeyAdd = (dateKey, days) => domain.localDate(domain.addDays(dateFromKey(dateKey), days));
  const daysBetween = (startDate, endDate) =>
    Math.round((dateFromKey(endDate).getTime() - dateFromKey(startDate).getTime()) / 86400000);
  const minDateKey = (...keys) => keys.filter(Boolean).sort()[0];
  const maxDateKey = (...keys) => keys.filter(Boolean).sort().at(-1);
  const weekStartDateKey = (dateKey) => {
    const date = dateFromKey(dateKey);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    return domain.localDate(domain.addDays(date, -daysSinceMonday));
  };

  const isCodexMeterOwned = (element) =>
    Boolean(
      element?.closest?.(
        `#${IDS.overlay}, #${IDS.button}, #${CHART_IDS.controls}, #${CHART_IDS.view}, .cqm-usage-toolbar, .cqm-meter-period-label`,
      ),
    );

  const meterSeriesPalette = [
    "var(--color-text-info)",
    "light-dark(#f3883b, #f59a56)",
    "light-dark(#5dc977, #74d58b)",
    "light-dark(#eb77b1, #f08fc0)",
    "light-dark(#9b79ec, #aa91ef)",
    "light-dark(#3ab9b1, #5acbc2)",
    "var(--color-chart-yellow)",
    "var(--color-chart-red)",
    "var(--color-chart-purple)",
  ];

  const meterClientLabels = () => ({
    CODEX_WORK_WEB: t("chart.clients.CODEX_WORK_WEB"),
    CODEX_WORK_DESKTOP: t("chart.clients.CODEX_WORK_DESKTOP"),
    CODEX_CLI: t("chart.clients.CODEX_CLI"),
    CODEX_DESKTOP_APP: t("chart.clients.CODEX_DESKTOP_APP"),
    CODEX_SERVICE_EXEC: t("chart.clients.CODEX_SERVICE_EXEC"),
    CODEX_UNKNOWN_DEFAULT: t("chart.clients.CODEX_UNKNOWN_DEFAULT"),
  });

  const meterSeriesLabel = (series) => {
    if (!series) return t("chart.other");
    if (series.key === "unclassified") return t("chart.other");
    if (series.key === "total") return currentMeterMetricOption().label;
    const tokenLabel = {
      uncachedInput: t("chart.series.uncachedInput"),
      cachedInput: t("chart.series.cachedInput"),
      output: t("chart.series.output"),
    }[series.key];
    if (tokenLabel) return tokenLabel;
    const clientLabel = meterClientLabels()[series.key];
    return clientLabel || series.label || series.key || t("chart.other");
  };

  const meterChartLegend = (fullSummary, selectedSummary, selectedMissing = false) => {
    const selectedByKey = new Map((selectedSummary?.series || []).map((series) => [series.key, series]));
    const selectedTotal = n(selectedSummary?.total);
    return (fullSummary?.series || []).map((series, index) => {
      const selected = selectedByKey.get(series.key);
      const value = selectedMissing ? null : meterChartPinnedIndex == null ? n(series.value) : n(selected?.value);
      return {
        ...series,
        label: meterSeriesLabel(series),
        color:
          series.key === "unclassified"
            ? "var(--color-text-tertiary)"
            : meterSeriesPalette[index % meterSeriesPalette.length],
        value,
        share: selectedMissing ? null : selectedTotal > 0 ? value / selectedTotal : 0,
      };
    });
  };

  const meterHiddenSeriesKey = (grouping = currentMeterChartGrouping()) => `${meterChartMetric}:${grouping}`;

  const normalizedMeterHiddenSeries = (seriesKeys, grouping = currentMeterChartGrouping()) => {
    const storageKey = meterHiddenSeriesKey(grouping);
    const hidden = meterChartHiddenSeries.get(storageKey) || new Set();
    [...hidden].forEach((key) => {
      if (!seriesKeys.includes(key)) hidden.delete(key);
    });
    if (seriesKeys.length && seriesKeys.every((key) => hidden.has(key))) hidden.delete(seriesKeys[0]);
    meterChartHiddenSeries.set(storageKey, hidden);
    return hidden;
  };

  const meterRowSeries = (row, grouping, legend) => {
    const byKey = new Map(
      domain.chartSeries(row.rawRow || {}, meterChartMetric, grouping).map((series) => [series.key, series]),
    );
    return legend.map((meta) => ({ ...meta, value: n(byKey.get(meta.key)?.value) }));
  };

  const formatMeterPercent = (share) => {
    if (share == null) return "—";
    try {
      const formatter = new Intl.NumberFormat(getPageLocale(), {
        style: "percent",
        maximumFractionDigits: 1,
      });
      return share > 0 && share < 0.001 ? `<${formatter.format(0.001)}` : formatter.format(n(share));
    } catch {
      return `${(n(share) * 100).toFixed(1)}%`;
    }
  };

  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

  const createMeterSvgElement = (tagName, className = "") => {
    const element = document.createElementNS(SVG_NAMESPACE, tagName);
    if (className) element.setAttribute("class", className);
    return element;
  };

  const meterChartShell = (view) => {
    let shell = view.querySelector(":scope > .cqm-meter-chart-shell");
    if (shell) return shell;
    setHtmlIfChanged(
      view,
      `<div class="cqm-meter-chart-shell">
        <div class="cqm-meter-chart-actions" hidden><button type="button" class="cqm-meter-chart-overview" data-cqm-chart-overview></button></div>
        <div class="cqm-chart-metadata-note" hidden></div>
        <svg class="cqm-meter-chart-svg" role="group" aria-label="Codex Meter">
          <defs data-cqm-chart-clips></defs>
          <g data-cqm-chart-grid></g>
          <rect class="cqm-meter-chart-slider" role="slider" tabindex="0" aria-orientation="horizontal" aria-valuemin="0" />
          <g data-cqm-chart-bars></g>
          <g data-cqm-chart-hits></g>
          <g data-cqm-chart-axis></g>
          <rect class="cqm-meter-chart-hover-band" hidden />
        </svg>
        <div class="cqm-chart-selection-note" role="status" hidden></div>
        <div class="cqm-chart-legend-frame"><div class="cqm-chart-legend cqm-meter-chart-legend"></div></div>
        <div class="cqm-chart-tooltip cqm-meter-chart-tooltip" role="tooltip" hidden></div>
      </div>`,
    );
    shell = view.querySelector(":scope > .cqm-meter-chart-shell");
    return shell;
  };

  const meterKeyedChild = (parent, attribute, key) =>
    [...(parent?.children || [])].find((element) => element.getAttribute(attribute) === String(key)) || null;

  const queueMeterGeometry = (updates, element, attributes, initial = {}) => {
    Object.entries(attributes).forEach(([attribute, targetValue]) => {
      const target = Number(targetValue);
      const rawCurrent = element.getAttribute(attribute);
      let current = rawCurrent == null ? Number.NaN : Number(rawCurrent);
      if (!Number.isFinite(current)) {
        current = Number.isFinite(Number(initial[attribute])) ? Number(initial[attribute]) : target;
        element.setAttribute(attribute, String(current));
      }
      if (Math.abs(current - target) <= 0.01) {
        element.setAttribute(attribute, String(target));
        return;
      }
      updates.push({ element, attribute, from: current, to: target });
    });
  };

  const runMeterGeometryAnimation = (updates, removals) => {
    if (meterChartGeometryFrame) window.cancelAnimationFrame(meterChartGeometryFrame);
    const finish = () => {
      updates.forEach(({ element, attribute, to }) => element.isConnected && element.setAttribute(attribute, String(to)));
      removals.forEach((element) => {
        if (element?.dataset?.cqmRemoving === "true") element.remove();
      });
    };
    if (!updates.length || prefersReducedMeterMotion()) {
      finish();
      meterChartGeometryFrame = 0;
      return;
    }
    const duration = 300;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      updates.forEach(({ element, attribute, from, to }) => {
        if (element.isConnected) element.setAttribute(attribute, String(from + (to - from) * eased));
      });
      if (progress < 1) {
        meterChartGeometryFrame = window.requestAnimationFrame(step);
        return;
      }
      finish();
      meterChartGeometryFrame = 0;
    };
    meterChartGeometryFrame = window.requestAnimationFrame(step);
  };

  const meterChartGeometry = (rows, chartWidth, state) => {
    const width = Math.max(1, Math.round(chartWidth));
    const height = 144;
    const plotTop = 20;
    const baseline = 122;
    const plotHeight = baseline - plotTop;
    const horizontalInset = 20;
    const plotWidth = Math.max(1, width - horizontalInset * 2);
    const slot = plotWidth / Math.max(1, rows.length);
    const barWidth = Math.max(1, Math.min(38, Math.ceil(slot * 0.8)));
    const firstBarX = Math.round(horizontalInset + (slot - barWidth) / 2);
    const rowSeries = rows.map((row) => meterRowSeries(row, state.grouping, state.legend));
    const actualTotals = rowSeries.map((series) =>
      sumValues(series.map((item) => Math.max(0, n(item.value)))),
    );
    const actualMaximum = Math.max(0, ...actualTotals);
    const maxValue = actualMaximum > 0 ? actualMaximum * 1.05 : 1;
    const rowGeometry = rows.map((row, index) => {
      const x = firstBarX + index * slot;
      let yCursor = baseline;
      const segments = rowSeries[index].map((series) => {
        const visible = !state.hidden.has(series.key);
        const value = Math.max(0, n(series.value));
        const segmentHeight = visible ? (value / maxValue) * plotHeight : 0;
        yCursor -= segmentHeight;
        return {
          ...series,
          x,
          y: yCursor,
          width: barWidth,
          height: segmentHeight,
          opacity: visible && value > 0 ? 1 : 0,
        };
      });
      const stackHeight = baseline - yCursor;
      return {
        key: row.date,
        index,
        x,
        clipY: baseline - stackHeight,
        clipHeight: stackHeight,
        radius: Math.min(4, stackHeight / 2, barWidth / 2),
        width: barWidth,
        segments,
        hit: {
          x: horizontalInset + index * slot,
          y: plotTop,
          width: slot,
          height: plotHeight,
        },
      };
    });
    const tickIndexes = [...new Set([0, Math.ceil((rows.length - 1) / 2), rows.length - 1])];
    return {
      width,
      height,
      plotTop,
      baseline,
      plotHeight,
      rows: rowGeometry,
      grid: [20, 54, 88, 122],
      ticks: tickIndexes.map((index) => ({
        key: rows[index].date,
        index,
        x: horizontalInset + slot * (index + 0.5),
        y: 130,
        dy: 12,
        label: formatAxisDate(rows[index].date),
      })),
    };
  };

  const fadeMeterText = (node, nextText) => {
    if (!node) return;
    const pending = meterChartTextAnimations.get(node);
    if (pending?.target === nextText) return;
    pending?.animation?.cancel?.();
    meterChartTextAnimations.delete(node);
    if (node.textContent === nextText) return;
    if (prefersReducedMeterMotion() || !node.animate || !node.textContent) {
      node.textContent = nextText;
      return;
    }
    const fadeOut = node.animate([{ opacity: 1 }, { opacity: 0.25 }], {
      duration: 80,
      easing: "ease-out",
    });
    const fadeOutRecord = { target: nextText, animation: fadeOut };
    meterChartTextAnimations.set(node, fadeOutRecord);
    fadeOut.onfinish = () => {
      if (meterChartTextAnimations.get(node) !== fadeOutRecord) return;
      node.textContent = nextText;
      const fadeIn = node.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: 140,
        easing: "ease-out",
      });
      const fadeInRecord = { target: nextText, animation: fadeIn };
      meterChartTextAnimations.set(node, fadeInRecord);
      fadeIn.onfinish = () => {
        if (meterChartTextAnimations.get(node) === fadeInRecord) meterChartTextAnimations.delete(node);
      };
    };
  };

  const setMeterOverlayVisibility = (element, visible) => {
    if (!element) return;
    window.clearTimeout(element.cqmVisibilityTimer);
    if (prefersReducedMeterMotion()) {
      element.hidden = !visible;
      element.style.removeProperty("opacity");
      return;
    }
    element.style.transition = "opacity 160ms var(--ease-basic, ease)";
    if (visible) {
      const wasHidden = element.hidden;
      element.hidden = false;
      if (wasHidden) element.style.opacity = "0";
      window.requestAnimationFrame(() => {
        if (!element.hidden) element.style.opacity = "1";
      });
      return;
    }
    if (element.hidden) return;
    element.style.opacity = "0";
    element.cqmVisibilityTimer = window.setTimeout(() => {
      if (element.style.opacity === "0") element.hidden = true;
    }, 170);
  };

  const patchMeterChartLegend = (legendElement, state) => {
    const activeKeys = new Set(state.legend.map((series) => series.key));
    const visibleCount = state.legend.filter((series) => !state.hidden.has(series.key)).length;
    const legendRect = legendElement.getBoundingClientRect();
    if (getComputedStyle(legendElement).position === "static") legendElement.style.position = "relative";
    [...legendElement.children].forEach((button) => {
      if (activeKeys.has(button.dataset.cqmSeriesKey)) return;
      const buttonRect = button.getBoundingClientRect();
      button.dataset.cqmRemoving = "true";
      button.style.pointerEvents = "none";
      if (prefersReducedMeterMotion() || !button.animate) {
        button.remove();
        return;
      }
      Object.assign(button.style, {
        position: "absolute",
        left: `${buttonRect.left - legendRect.left}px`,
        top: `${buttonRect.top - legendRect.top}px`,
        width: `${buttonRect.width}px`,
      });
      button.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-out" }).onfinish = () => {
        if (button.dataset.cqmRemoving === "true") button.remove();
      };
    });
    state.legend.forEach((series) => {
      let button = [...legendElement.children].find((child) => child.dataset.cqmSeriesKey === series.key);
      const isNew = !button;
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "cqm-chart-legend-item";
        button.dataset.cqmSeriesKey = series.key;
        button.innerHTML = `
          <i class="cqm-chart-legend-swatch"></i>
          <span class="cqm-chart-legend-copy">
            <span class="cqm-chart-legend-label"></span>
            <strong class="cqm-chart-legend-percent"></strong>
          </span>`;
      }
      if (button.dataset.cqmRemoving === "true") {
        button.getAnimations?.().forEach((animation) => animation.cancel());
        ["position", "left", "top", "width"].forEach((property) => button.style.removeProperty(property));
      }
      delete button.dataset.cqmRemoving;
      button.style.removeProperty("pointer-events");
      const pressed = !state.hidden.has(series.key);
      const cannotHide = pressed && visibleCount <= 1;
      setAttributeIfChanged(button, "aria-pressed", pressed ? "true" : "false");
      setAttributeIfChanged(button, "aria-disabled", cannotHide ? "true" : "false");
      setAttributeIfChanged(
        button,
        "aria-label",
        t(pressed ? "chart.aria.hideSeries" : "chart.aria.showSeries", { label: series.label }),
      );
      button.querySelector(".cqm-chart-legend-swatch")?.style.setProperty("--cqm-series-color", series.color);
      const label = button.querySelector(".cqm-chart-legend-label");
      if (label && label.textContent !== series.label) label.textContent = series.label;
      fadeMeterText(button.querySelector(".cqm-chart-legend-percent"), formatMeterPercent(series.share));
      legendElement.appendChild(button);
      if (isNew && !prefersReducedMeterMotion() && button.animate) {
        button.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 220,
          easing: "cubic-bezier(.2, 0, 0, 1)",
        });
      }
    });
  };

  const patchMeterChart = (view, rows, chartWidth, state) => {
    const shell = meterChartShell(view);
    if (!shell) return;
    const svg = shell.querySelector(".cqm-meter-chart-svg");
    const clips = svg.querySelector("[data-cqm-chart-clips]");
    const grid = svg.querySelector("[data-cqm-chart-grid]");
    const bars = svg.querySelector("[data-cqm-chart-bars]");
    const hits = svg.querySelector("[data-cqm-chart-hits]");
    const axis = svg.querySelector("[data-cqm-chart-axis]");
    const slider = svg.querySelector(".cqm-meter-chart-slider");
    const geometry = meterChartGeometry(rows, chartWidth, state);
    svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
    const updates = [];
    const removals = [];

    geometry.grid.forEach((y, index) => {
      let line = meterKeyedChild(grid, "data-grid-index", index);
      if (!line) {
        line = createMeterSvgElement("line", "cqm-meter-grid-line");
        line.setAttribute("data-grid-index", String(index));
        grid.appendChild(line);
      }
      queueMeterGeometry(updates, line, { x1: 0, x2: geometry.width, y1: y, y2: y });
    });

    const activeRowKeys = new Set(geometry.rows.map((row) => row.key));
    geometry.rows.forEach((row) => {
      const clipId = `cqm-meter-stack-${row.key.replace(/[^a-z0-9]/gi, "-")}`;
      let clip = meterKeyedChild(clips, "data-row-key", row.key);
      if (!clip) {
        clip = createMeterSvgElement("clipPath");
        clip.setAttribute("data-row-key", row.key);
        clip.id = clipId;
        clip.appendChild(createMeterSvgElement("rect", "cqm-meter-stack-rounded-top"));
        clip.appendChild(createMeterSvgElement("rect", "cqm-meter-stack-square-bottom"));
        clips.appendChild(clip);
      }
      delete clip.dataset.cqmRemoving;
      const clipRect = clip.firstElementChild;
      let clipBottom = clip.lastElementChild;
      if (clipBottom === clipRect) {
        clipBottom = createMeterSvgElement("rect", "cqm-meter-stack-square-bottom");
        clip.appendChild(clipBottom);
      }
      queueMeterGeometry(
        updates,
        clipRect,
        { x: row.x, y: row.clipY, width: row.width, height: row.clipHeight, rx: row.radius, ry: row.radius },
        { x: row.x, y: geometry.baseline, width: row.width, height: 0, rx: 0, ry: 0 },
      );
      queueMeterGeometry(
        updates,
        clipBottom,
        {
          x: row.x,
          y: row.clipY + row.radius,
          width: row.width,
          height: Math.max(0, row.clipHeight - row.radius),
        },
        { x: row.x, y: geometry.baseline, width: row.width, height: 0 },
      );

      let rowGroup = meterKeyedChild(bars, "data-row-key", row.key);
      if (!rowGroup) {
        rowGroup = createMeterSvgElement("g", "cqm-meter-chart-row");
        rowGroup.setAttribute("data-row-key", row.key);
        bars.appendChild(rowGroup);
      }
      delete rowGroup.dataset.cqmRemoving;
      rowGroup.setAttribute("clip-path", `url(#${clipId})`);
      const activeSeries = new Set(row.segments.map((segment) => segment.key));
      row.segments.forEach((segment) => {
        let rect = meterKeyedChild(rowGroup, "data-series", segment.key);
        if (!rect) {
          rect = createMeterSvgElement("rect", "cqm-meter-chart-bar-segment");
          rect.setAttribute("data-series", segment.key);
          rowGroup.appendChild(rect);
        }
        delete rect.dataset.cqmRemoving;
        delete rect.dataset.exiting;
        rect.dataset.visible = segment.opacity > 0 ? "true" : "false";
        rect.dataset.index = String(row.index);
        rect.style.setProperty("--cqm-series-color", segment.color);
        queueMeterGeometry(
          updates,
          rect,
          {
            x: segment.x,
            y: segment.y,
            width: segment.width,
            height: segment.height,
            opacity: segment.opacity,
          },
          { x: segment.x, y: geometry.baseline, width: segment.width, height: 0, opacity: 0 },
        );
        rowGroup.appendChild(rect);
      });
      [...rowGroup.children].forEach((rect) => {
        if (activeSeries.has(rect.dataset.series)) return;
        rect.dataset.cqmRemoving = "true";
        rect.dataset.exiting = "true";
        queueMeterGeometry(updates, rect, { y: geometry.baseline, height: 0, opacity: 0 });
        removals.push(rect);
      });

      let hit = meterKeyedChild(hits, "data-row-key", row.key);
      if (!hit) {
        hit = createMeterSvgElement("rect", "cqm-meter-chart-hit");
        hit.setAttribute("data-row-key", row.key);
        hits.appendChild(hit);
      }
      delete hit.dataset.cqmRemoving;
      hit.style.removeProperty("pointer-events");
      hit.dataset.index = String(row.index);
      hit.dataset.bandX = String(row.hit.x);
      hit.dataset.bandWidth = String(row.hit.width);
      hit.dataset.bandY = String(row.hit.y);
      hit.dataset.bandHeight = String(row.hit.height);
      queueMeterGeometry(updates, hit, row.hit);
    });

    [...bars.children].forEach((rowGroup) => {
      if (activeRowKeys.has(rowGroup.dataset.rowKey)) return;
      rowGroup.dataset.cqmRemoving = "true";
      [...rowGroup.children].forEach((rect) => {
        rect.dataset.exiting = "true";
        queueMeterGeometry(updates, rect, { y: geometry.baseline, height: 0, opacity: 0 });
      });
      removals.push(rowGroup);
    });
    [...clips.children].forEach((clip) => {
      if (activeRowKeys.has(clip.dataset.rowKey)) return;
      clip.dataset.cqmRemoving = "true";
      [...clip.children].forEach((rect) =>
        queueMeterGeometry(updates, rect, { y: geometry.baseline, height: 0, rx: 0, ry: 0 }),
      );
      removals.push(clip);
    });
    [...hits.children].forEach((hit) => {
      if (activeRowKeys.has(hit.dataset.rowKey)) return;
      hit.dataset.cqmRemoving = "true";
      hit.style.pointerEvents = "none";
      removals.push(hit);
    });

    const activeTickKeys = new Set(geometry.ticks.map((tick) => tick.key));
    geometry.ticks.forEach((tick) => {
      let text = meterKeyedChild(axis, "data-tick-key", tick.key);
      if (!text) {
        text = createMeterSvgElement("text", "cqm-meter-axis-label");
        text.setAttribute("data-tick-key", tick.key);
        text.setAttribute("opacity", "0");
        axis.appendChild(text);
      }
      delete text.dataset.cqmRemoving;
      text.textContent = tick.label;
      text.setAttribute("text-anchor", "middle");
      queueMeterGeometry(updates, text, { x: tick.x, y: tick.y, dy: tick.dy, opacity: 1 });
      axis.appendChild(text);
    });
    [...axis.children].forEach((text) => {
      if (activeTickKeys.has(text.dataset.tickKey)) return;
      text.dataset.cqmRemoving = "true";
      queueMeterGeometry(updates, text, { opacity: 0 });
      removals.push(text);
    });

    setAttributeIfChanged(slider, "aria-label", t("chart.aria.slider"));
    setAttributeIfChanged(slider, "aria-valuemax", String(rows.length));
    queueMeterGeometry(updates, slider, {
      x: 0,
      y: geometry.plotTop,
      width: geometry.width,
      height: geometry.plotHeight,
    });

    const actions = shell.querySelector(".cqm-meter-chart-actions");
    const overview = actions.querySelector("[data-cqm-chart-overview]");
    if (overview.textContent !== t("chart.allDates")) overview.textContent = t("chart.allDates");
    setMeterOverlayVisibility(actions, meterChartPinnedIndex != null);
    const metadata = shell.querySelector(".cqm-chart-metadata-note");
    if (metadata.textContent !== t("chart.dataMismatch")) metadata.textContent = t("chart.dataMismatch");
    setMeterOverlayVisibility(metadata, Boolean(state.selectedSummary?.hasMismatch));
    const selectionNote = shell.querySelector(".cqm-chart-selection-note");
    if (selectionNote.textContent !== t("chart.pendingDay")) selectionNote.textContent = t("chart.pendingDay");
    patchMeterChartLegend(shell.querySelector(".cqm-meter-chart-legend"), state);
    runMeterGeometryAnimation(updates, removals);
  };

  const formatMeterMetricValue = (value) => {
    if (value == null) return "—";
    if (meterChartMetric === CHART_METRICS.tokens) return fmtNum(value);
    if (meterChartMetric === CHART_METRICS.usd) return fmtUsd(value);
    if (meterChartMetric === CHART_METRICS.turns) return String(Math.round(value));
    return fmtCredits(value, value >= 100 ? 0 : 1);
  };

  const formatAxisDate = (dateKey) => {
    const date = new Date(`${dateKey}T12:00:00`);
    try {
      return new Intl.DateTimeFormat(getPageLocale(), { month: "short", day: "numeric" }).format(date);
    } catch {
      return dateKey;
    }
  };

  const formatPeriodDate = (dateKey) => {
    try {
      return new Intl.DateTimeFormat(getPageLocale(), { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
    } catch {
      return dateKey;
    }
  };

  const formatTooltipDate = (dateKey) => {
    const date = new Date(`${dateKey}T12:00:00`);
    try {
      return new Intl.DateTimeFormat(getPageLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
    } catch {
      return dateKey;
    }
  };

  const formatMeterTooltipDate = (row) => {
    if (!row?.endDate || row.endDate === row.date) return formatTooltipDate(row?.date);
    return `${formatTooltipDate(row.date)} - ${formatTooltipDate(row.endDate)}`;
  };

  const handleMeterChartPointerMove = (event) => {
    if (meterChartPinnedIndex != null) return;
    const bar = event.target.closest?.(".cqm-meter-chart-bar-segment, .cqm-meter-chart-hit");
    const view = document.getElementById(CHART_IDS.view);
    if (!bar || !view?.contains(bar)) {
      handleMeterChartPointerLeave();
      return;
    }
    const row = renderedMeterChartRows[Number(bar.dataset.index)];
    if (!row) {
      hideMeterChartTooltip();
      return;
    }
    const index = Number(bar.dataset.index);
    meterChartHoverIndex = index;
    meterChartFocusIndex = index + 1;
    updateMeterChartSummaryPreview(index);
    showMeterChartHoverBand(view, bar);
    showMeterChartTooltip(view, row, index, event.clientX, event.clientY);
  };

  const handleMeterChartPointerLeave = () => {
    if (meterChartPinnedIndex != null) return;
    meterChartHoverIndex = null;
    meterChartFocusIndex = 0;
    updateMeterChartSummaryPreview(null);
    hideMeterChartTooltip(false);
  };

  const updateMeterChartSummaryPreview = (index) => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
    const row = index == null ? null : renderedMeterChartRows[index];
    const grouping = currentMeterChartGrouping(renderedMeterChartRows);
    const summary = row?.rawRow
      ? domain.chartSummary([row.rawRow], meterChartMetric, grouping)
      : { series: [], total: 0, reportedTotal: 0 };
    const byKey = new Map((summary.series || []).map((series) => [series.key, series]));
    const total = n(summary.total);
    view.querySelectorAll("[data-cqm-series-key]").forEach((button) => {
      const key = button.dataset.cqmSeriesKey;
      const rangeSeries = renderedMeterChartLegend.find((series) => series.key === key);
      const previewSeries = byKey.get(key);
      const missing = Boolean(row?.missing);
      const value = missing ? null : index == null ? rangeSeries?.value : n(previewSeries?.value);
      const share = missing ? null : index == null ? rangeSeries?.share : total > 0 ? value / total : 0;
      const valueNode = button.querySelector(".cqm-chart-legend-value");
      const percentNode = button.querySelector(".cqm-chart-legend-percent");
      const valueText = formatMeterMetricValue(value);
      const percentText = formatMeterPercent(share);
      fadeMeterText(valueNode, valueText);
      fadeMeterText(percentNode, percentText);
    });
    setMeterPeriodLabel(row ? index : null);
    const slider = view.querySelector(".cqm-meter-chart-slider");
    if (slider) {
      const sliderValue = row ? index + 1 : 0;
      setAttributeIfChanged(slider, "aria-valuenow", String(sliderValue));
      setAttributeIfChanged(slider,
        "aria-valuetext",
        row
          ? row.missing
            ? `${formatTooltipDate(row.date)}, ${t("chart.pendingDay")}`
            : t("chart.aria.day", {
                date: formatTooltipDate(row.date),
                total: formatMeterMetricValue(n(summary.reportedTotal)),
              })
          : t("chart.aria.overview"),
      );
    }
    const note = view.querySelector(".cqm-chart-selection-note");
    setMeterOverlayVisibility(note, Boolean(row?.missing));
    const actions = view.querySelector(".cqm-meter-chart-actions");
    setMeterOverlayVisibility(actions, meterChartPinnedIndex != null);
    const metadata = view.querySelector(".cqm-chart-metadata-note");
    setMeterOverlayVisibility(metadata, Boolean(summary.hasMismatch));
    updateMeterChartBarEmphasis(index);
  };

  const updateMeterChartBarEmphasis = (index) => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
    view.querySelectorAll(".cqm-meter-chart-row").forEach((row) => {
      const rowIndex = Number(row.querySelector("[data-index]")?.dataset.index);
      row.style.transition = prefersReducedMeterMotion()
        ? "none"
        : "opacity var(--transition-duration-relaxed, 300ms) var(--ease-basic, cubic-bezier(.2, 0, 0, 1))";
      row.style.opacity = index == null || rowIndex === index ? "1" : "0.4";
    });
  };

  const showMeterChartHoverBand = (view, bar) => {
    const band = view.querySelector(".cqm-meter-chart-hover-band");
    if (!band) return;
    const hit = bar.matches(".cqm-meter-chart-hit")
      ? bar
      : view.querySelector(`.cqm-meter-chart-hit[data-index="${bar.dataset.index}"]`);
    if (!hit) return;
    band.setAttribute("x", hit.dataset.bandX || hit.getAttribute("x") || "0");
    band.setAttribute("y", hit.dataset.bandY || "0");
    band.setAttribute("width", hit.dataset.bandWidth || hit.getAttribute("width") || "0");
    band.setAttribute("height", hit.dataset.bandHeight || hit.getAttribute("height") || "0");
    band.setAttribute("hidden", "");
  };

  const showMeterChartTooltip = (view, row, index, clientX, clientY) => {
    const tooltip = view.querySelector(".cqm-meter-chart-tooltip");
    if (!tooltip) return;
    const grouping = currentMeterChartGrouping(renderedMeterChartRows);
    const tooltipKey = `${meterChartMetric}:${grouping}:${row.date}:${row.endDate || ""}`;
    if (tooltip.dataset.key === tooltipKey && tooltip.dataset.pendingKey && tooltip.dataset.pendingKey !== tooltipKey) {
      tooltip.cqmContentAnimation?.cancel?.();
      delete tooltip.dataset.contentToken;
      delete tooltip.dataset.pendingKey;
    }
    if (tooltip.dataset.key !== tooltipKey && tooltip.dataset.pendingKey !== tooltipKey) {
      const nextHtml = renderMeterChartTooltip(row, grouping);
      const commit = () => {
        tooltip.dataset.key = tooltipKey;
        delete tooltip.dataset.contentToken;
        delete tooltip.dataset.pendingKey;
        setHtmlIfChanged(tooltip, nextHtml);
      };
      const visible = !tooltip.hidden;
      if (visible && !prefersReducedMeterMotion() && tooltip.animate) {
        const contentToken = `${tooltipKey}:${performance.now()}`;
        tooltip.dataset.contentToken = contentToken;
        tooltip.dataset.pendingKey = tooltipKey;
        tooltip.cqmContentAnimation?.cancel?.();
        const fadeOut = tooltip.animate([{ opacity: 1 }, { opacity: 0.55 }], {
          duration: 70,
          easing: "ease-out",
        });
        tooltip.cqmContentAnimation = fadeOut;
        fadeOut.onfinish = () => {
          if (tooltip.dataset.contentToken !== contentToken) return;
          commit();
          tooltip.cqmContentAnimation = tooltip.animate([{ opacity: 0.55 }, { opacity: 1 }], {
            duration: 110,
            easing: "ease-out",
          });
        };
      } else {
        commit();
      }
    }
    tooltip.dataset.index = String(index);
    window.clearTimeout(tooltip.cqmHideTimer);
    tooltip.style.transition = prefersReducedMeterMotion()
      ? "none"
      : "opacity 160ms var(--ease-basic, ease), transform 220ms var(--ease-basic, cubic-bezier(.2, 0, 0, 1))";
    const wasHidden = tooltip.hidden;
    tooltip.hidden = false;
    if (wasHidden && !prefersReducedMeterMotion()) tooltip.style.opacity = "0";
    const rect = view.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const x = Math.min(Math.max(16, clientX - rect.left + 16), Math.max(16, rect.width - tooltipRect.width - 16));
    const y = Math.min(Math.max(16, clientY - rect.top - tooltipRect.height - 12), Math.max(16, rect.height - tooltipRect.height - 16));
    tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    window.requestAnimationFrame(() => {
      if (!tooltip.hidden) tooltip.style.opacity = "1";
    });
  };

  const renderMeterChartTooltip = (row, grouping = currentMeterChartGrouping(renderedMeterChartRows)) => {
    if (row.missing) {
      return `<div class="cqm-chart-tooltip-date cqm-meter-tooltip-title">${escapeHtml(formatMeterTooltipDate(row))}</div><div>${escapeHtml(t("chart.pendingDay"))}</div>`;
    }
    const summary = domain.chartSummary([row.rawRow], meterChartMetric, grouping);
    const metaByKey = new Map(renderedMeterChartLegend.map((series) => [series.key, series]));
    const seriesRows = summary.series.map((series, index) => ({
      ...series,
      label: meterSeriesLabel(series),
      color: metaByKey.get(series.key)?.color || meterSeriesPalette[index % meterSeriesPalette.length],
    }));
    const reportedTotal = n(summary.reportedTotal);
    return `
      <div class="cqm-chart-tooltip-date cqm-meter-tooltip-title">${escapeHtml(formatMeterTooltipDate(row))}</div>
      <div class="cqm-meter-tooltip-grid">
        ${seriesRows
          .map(
            (series) => `
              <div class="cqm-chart-tooltip-row" data-hidden="${
                normalizedMeterHiddenSeries(renderedMeterChartLegend.map((item) => item.key), grouping).has(series.key)
                  ? "true"
                  : "false"
              }">
                <i class="cqm-chart-legend-swatch" style="--cqm-series-color:${escapeHtml(series.color)}"></i>
                <span class="cqm-chart-tooltip-label">${escapeHtml(series.label)}</span>
                <strong class="cqm-chart-tooltip-value">${escapeHtml(formatMeterMetricValue(series.value))}</strong>
                <span class="cqm-chart-tooltip-percent">${escapeHtml(formatMeterPercent(series.share))}</span>
              </div>
            `,
          )
          .join("")}
        <div class="cqm-chart-tooltip-row cqm-chart-tooltip-total cqm-meter-tooltip-total">
          <span class="cqm-chart-tooltip-label">${escapeHtml(t("table.total"))}</span>
          <strong class="cqm-chart-tooltip-value">${escapeHtml(formatMeterMetricValue(reportedTotal))}</strong>
          <span class="cqm-chart-tooltip-percent">${reportedTotal > 0 ? "100%" : "0%"}</span>
        </div>
      </div>
    `;
  };

  const hideMeterChartTooltip = (force = false) => {
    if (!force && meterChartPinnedIndex != null) return;
    const tooltip = document.querySelector(`#${CHART_IDS.view} .cqm-meter-chart-tooltip`);
    if (tooltip) {
      window.clearTimeout(tooltip.cqmHideTimer);
      delete tooltip.dataset.contentToken;
      delete tooltip.dataset.pendingKey;
      tooltip.cqmContentAnimation?.cancel?.();
      if (prefersReducedMeterMotion() || force) {
        tooltip.hidden = true;
        tooltip.style.removeProperty("opacity");
      } else {
        tooltip.style.opacity = "0";
        tooltip.cqmHideTimer = window.setTimeout(() => {
          if (tooltip.style.opacity === "0") tooltip.hidden = true;
        }, 170);
      }
    }
    const band = document.querySelector(`#${CHART_IDS.view} .cqm-meter-chart-hover-band`);
    if (band) band.setAttribute("hidden", "");
  };

  const showMeterTooltipForIndex = (index) => {
    const view = document.getElementById(CHART_IDS.view);
    const row = renderedMeterChartRows[index];
    const hit = view?.querySelector(`.cqm-meter-chart-hit[data-index="${index}"]`);
    if (!view || !row || !hit) return;
    showMeterChartHoverBand(view, hit);
    const hitRect = hit.getBoundingClientRect();
    showMeterChartTooltip(view, row, index, hitRect.left + hitRect.width / 2, hitRect.top + 4);
  };

  const restoreMeterChartSelection = (view = document.getElementById(CHART_IDS.view)) => {
    if (!view) return;
    const selectedIndex = meterChartPinnedIndex;
    setDatasetIfChanged(view, "cqmChartPinned", selectedIndex == null ? "false" : "true");
    view.querySelectorAll("[data-index]").forEach((element) => {
      setDatasetIfChanged(element, "selected", Number(element.dataset.index) === selectedIndex ? "true" : "false");
    });
    const slider = view.querySelector(".cqm-meter-chart-slider");
    if (slider) {
      const value = selectedIndex == null ? 0 : selectedIndex + 1;
      slider.setAttribute("aria-valuenow", String(value));
    }
    if (selectedIndex != null) {
      const hit = view.querySelector(`.cqm-meter-chart-hit[data-index="${selectedIndex}"]`);
      if (hit) showMeterChartHoverBand(view, hit);
    }
    updateMeterChartBarEmphasis(selectedIndex ?? meterChartHoverIndex);
  };

  const selectMeterChartValue = (value, { focus = true, showTooltip = true } = {}) => {
    const nextValue = Math.max(0, Math.min(renderedMeterChartRows.length, Number(value) || 0));
    meterChartFocusIndex = nextValue;
    meterChartPinnedIndex = nextValue === 0 ? null : nextValue - 1;
    meterChartHoverIndex = null;
    hideMeterChartTooltip(false);
    const view = document.getElementById(CHART_IDS.view);
    updateMeterChartSummaryPreview(meterChartPinnedIndex);
    restoreMeterChartSelection(view);
    const slider = view?.querySelector(".cqm-meter-chart-slider");
    if (focus) slider?.focus({ preventScroll: true });
    if (showTooltip && meterChartPinnedIndex != null) showMeterTooltipForIndex(meterChartPinnedIndex);
  };

  const toggleMeterChartSeries = (seriesKey) => {
    const grouping = currentMeterChartGrouping(renderedMeterChartRows);
    const allKeys = renderedMeterChartLegend.map((series) => series.key);
    const hidden = normalizedMeterHiddenSeries(allKeys, grouping);
    if (hidden.has(seriesKey)) {
      hidden.delete(seriesKey);
    } else if (allKeys.filter((key) => !hidden.has(key)).length > 1) {
      hidden.add(seriesKey);
    } else {
      return;
    }
    hideMeterChartTooltip(true);
    const view = document.getElementById(CHART_IDS.view);
    if (view) delete view.dataset.chartKey;
    renderMeterChartView();
    const nextButton = [...(document.querySelectorAll(`#${CHART_IDS.view} [data-cqm-series-key]`) || [])].find(
      (button) => button.dataset.cqmSeriesKey === seriesKey,
    );
    nextButton?.focus({ preventScroll: true });
  };

  const handleMeterChartClick = (event) => {
    const overview = event.target.closest?.("[data-cqm-chart-overview]");
    if (overview) {
      event.preventDefault();
      selectMeterChartValue(0);
      return;
    }
    const legendItem = event.target.closest?.("[data-cqm-series-key]");
    if (legendItem) {
      event.preventDefault();
      toggleMeterChartSeries(legendItem.dataset.cqmSeriesKey);
      return;
    }
    const bar = event.target.closest?.(".cqm-meter-chart-bar-segment, .cqm-meter-chart-hit");
    if (!bar) return;
    event.preventDefault();
    const nextIndex = Number(bar.dataset.index);
    selectMeterChartValue(meterChartPinnedIndex === nextIndex ? 0 : nextIndex + 1);
  };

  const handleMeterChartKeyDown = (event) => {
    const slider = event.target.closest?.(".cqm-meter-chart-slider");
    if (!slider) {
      if (event.key === "Escape" && meterChartPinnedIndex != null) {
        event.preventDefault();
        event.stopPropagation();
        selectMeterChartValue(0, { focus: false, showTooltip: false });
      }
      return;
    }
    const current = meterChartPinnedIndex == null ? meterChartFocusIndex : meterChartPinnedIndex + 1;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(renderedMeterChartRows.length, current + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, current - 1);
    else if (event.key === "Home" || event.key === "Escape") next = 0;
    else if (event.key === "End") next = renderedMeterChartRows.length;
    else return;
    event.preventDefault();
    event.stopPropagation();
    selectMeterChartValue(next);
  };

  const handleMeterChartFocusIn = (event) => {
    if (event.target.closest?.("[data-cqm-series-key]")) {
      hideMeterChartTooltip(true);
      return;
    }
    if (event.target.closest?.(".cqm-meter-chart-slider") && meterChartPinnedIndex != null) {
      showMeterTooltipForIndex(meterChartPinnedIndex);
    }
  };

  const handleMeterChartFocusOut = (event) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    hideMeterChartTooltip(meterChartPinnedIndex == null);
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
    <div class="cqc-status" data-kind="loading">${icon("loader")}<span>${escapeHtml(message)}</span></div>
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
    const statusIcon = kind === "error" ? "alert" : kind === "loading" ? "loader" : "check";
    const html = `${icon(statusIcon)}<span>${escapeHtml(message)}</span>`;
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
      if (meterSettings.showPageButton) {
        ensureDetailButton();
      } else {
        removeDetailButton();
      }
      if (meterSettings.showChartControls) {
        ensureUsageChartSwitch();
      } else {
        removeUsageChartSwitch();
      }
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
      removeUsageChartSwitch();
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
    setStatus(t("skeletonLoading"), "loading");
    setTriggerButton("refresh", t("trigger.loading"));

    try {
      latestReport = await reportService.refreshReport();
      passiveReportError = null;
      failedPassiveScopeKey = null;
      renderReport(latestReport);
      renderMeterChartView();
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
      <div class="cqc-data-delay-notice">${icon("alert")}<span>${escapeHtml(t("dataDelayNotice"))}</span></div>
      ${renderSummaryCards(report)}
      ${renderModelTokenSection(report)}
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

  const weeklyLimitWindow = (report) =>
    (report.windows || []).find(
      (window) =>
        n(window.limitWindowSeconds) >= 6 * 24 * 60 * 60 &&
        !/spark/i.test(`${window?.key || ""} ${window?.label || ""}`),
    ) ||
    (n(report.primaryWindow?.limitWindowSeconds) >= 6 * 24 * 60 * 60
      ? report.primaryWindow
      : null) ||
    null;

  const isShortLimitWindow = (window) => {
    // primary/secondary identify API slots, not durations. In particular,
    // secondary_window may be weekly and must never also populate the 5h card.
    const seconds = Number(window?.limitWindowSeconds);
    return Number.isFinite(seconds) && seconds > 0 && seconds < 24 * 60 * 60;
  };

  const shortLimitWindow = (report) =>
    (report.windows || []).find(isShortLimitWindow) || null;

  const sparkLimitWindow = (report, kind) =>
    (report.customWindows || []).find(
      (window) => window.source === "spark" && window.kind === kind,
    ) || null;

  const renderQuotaCard = (iconName, key, limitWindow, tone) => {
    const remaining = limitWindow?.remainingPercent;
    const value = remaining == null ? t("quota.unavailable") : `${remaining.toFixed(1)}%`;
    const hint = [
      t(`quota.${key}.1`),
      limitWindow?.resetAtLocal ? t("quota.reset", { time: limitWindow.resetAtLocal }) : "",
    ]
      .filter(Boolean)
      .join(" ");
    return renderMetricCard(iconName, t(`quota.${key}.0`), value, tone, false, hint);
  };

  const rowCredits = (row) => n(row?.totals?.credits);

  const sumValues = (values) => values.reduce((sum, value) => sum + n(value), 0);

  const medianValue = (values) => {
    const sorted = values.map(n).filter((value) => value > 0).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const confidenceForProjection = ({ cycleAgeHours, estimate, recent7Credits, recentMedianCredits, stats, usedPercent }) => {
    const dailyLooksIncomplete = recentMedianCredits > 0 && n(stats.credits) < recentMedianCredits * 0.2;
    const estimateLooksTooLow = recent7Credits > 0 && estimate < recent7Credits * 0.25;
    if (
      usedPercent < 10 ||
      (cycleAgeHours != null && cycleAgeHours < 8) ||
      dailyLooksIncomplete ||
      estimateLooksTooLow
    ) {
      return "low";
    }
    if (usedPercent < 20 || (cycleAgeHours != null && cycleAgeHours < 24)) return "medium";
    return "high";
  };

  const weeklyProjection = (report) => {
    const stats = report.currentStats || {};
    const window = weeklyLimitWindow(report);
    const usedPercent = window?.usedPercent;
    const currentCredits = n(stats.credits);
    const canEstimate = usedPercent != null && usedPercent > 0 && currentCredits > 0;

    if (!canEstimate) {
      return {
        canEstimate,
        estimate: null,
        value: escapeHtml(t("metrics.projectedUnavailable.0")),
        hint: t("metrics.projectedUnavailable.1"),
        usdValue: escapeHtml(t("metrics.projectedUnavailable.0")),
        usdHint: t("metrics.projectedUnavailable.1"),
      };
    }

    const estimate = currentCredits / (usedPercent / 100);
    const completedHistoryRows = [...(report.historyList || [])]
      .filter((row) => row?.date)
      .sort((a, b) => new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`));
    const recentRows = completedHistoryRows.slice(0, 7);
    const recentCredits = recentRows.map(rowCredits);
    const recent7Credits = sumValues(recentCredits);
    const recentMedianCredits = medianValue(recentCredits);
    const capturedMs = Date.parse(report.capturedAt) || Date.now();
    const cycleStartMs =
      window?.resetAt && window?.limitWindowSeconds
        ? (window.resetAt - window.limitWindowSeconds) * 1000
        : null;
    const cycleAgeHours =
      cycleStartMs != null ? Math.max(0, (capturedMs - cycleStartMs) / 36e5) : null;
    const confidence = confidenceForProjection({
      cycleAgeHours,
      estimate,
      recent7Credits,
      recentMedianCredits,
      stats,
      usedPercent,
    });
    const confidenceLabel = t(`metrics.projectionConfidence.${confidence}`);
    const hint = [
      t("metrics.projected.1", { confidence: confidenceLabel }),
      confidence === "low" ? t("metrics.projectionLag") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const digits = estimate >= 1000 ? 0 : 1;
    return {
      canEstimate,
      confidence,
      estimate,
      value: escapeHtml(`~${fmtCredits(estimate, digits)}`),
      hint,
      usdValue: escapeHtml(fmtUsd(estimate)),
      usdHint: hint,
    };
  };

  const renderSummaryCards = (report) => {
    const stats = report.currentStats;
    const weeklyWindow = weeklyLimitWindow(report);
    const shortWindow = shortLimitWindow(report);
    const sparkWindow = sparkLimitWindow(report, "weekly");
    const sparkShortWindow = sparkLimitWindow(report, "short");
    const projection = weeklyProjection(report);
    const weighted = { current: n(report.currentModelTokenStats?.totals?.creditEquivalent) };
    const weightedUnavailable = escapeHtml(t("metrics.weightedUnavailable.0"));
    const hasModelTokenData = (report.currentModelTokenStats?.models || []).some(
      (model) => n(model.tokens) > 0,
    );
    return `
      <div class="cqc-grid">
        ${renderQuotaCard("gauge", "weekly", weeklyWindow, "fresh")}
        ${renderQuotaCard("clock", "short", shortWindow, "blue")}
        ${renderQuotaCard("sparkles", "spark", sparkWindow, "amber")}
        ${renderQuotaCard("clock", "sparkShort", sparkShortWindow, "amber")}
        ${renderMetricCard("coins", t("metrics.credits.0"), fmtCredits(stats.credits, 2), "mint", false, t("metrics.credits.1"))}
        ${renderMetricCard("cpu", t("metrics.tokens.0"), fmtNum(stats.tokens), "blue", false, t("metrics.tokens.1"))}
        ${renderMetricCard("trendingUp", t("metrics.projected.0"), projection.value, "amber", false, projection.hint)}
        ${renderMetricCard("layers", t("metrics.cache.0"), `${(stats.cacheRatio * 100).toFixed(1)}%`, "violet", false, t("metrics.cache.1"))}
        ${renderMetricCard("wallet", t("metrics.usd.0"), projection.usdValue, "ink", false, projection.usdHint)}
        ${hasModelTokenData ? renderMetricCard("cpu", t("metrics.weightedUsage.0"), weighted.current > 0 ? `~${fmtCredits(weighted.current, weighted.current >= 1000 ? 0 : 1)}` : weightedUnavailable, "blue", false, t("metrics.weightedUsage.1")) : ""}
      </div>
    `;
  };

  const renderModelTokenSection = (report) => {
    const stats = report.currentModelTokenStats;
    const models = (stats?.models || []).filter((model) => n(model.tokens) > 0);
    if (!models.length) return "";
    const totals = stats.totals || {};
    const coverage = Math.round(n(totals.rateCoverage) * 100);
    const meta = t("sections.modelsMeta", {
      coverage,
      date: report.tokenRateCardDate || "--",
    });
    return `
      <div class="cqc-section-title">
        <span>${icon("cpu")}${escapeHtml(t("sections.models"))}</span>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="cqc-table-wrap">
        <table class="cqc-table cqc-model-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("modelTable.model"))}</th>
              <th>${escapeHtml(t("modelTable.tokens"))}</th>
              <th>${escapeHtml(t("modelTable.uncachedInput"))}</th>
              <th>${escapeHtml(t("modelTable.cachedInput"))}</th>
              <th>${escapeHtml(t("modelTable.output"))}</th>
              <th>${escapeHtml(t("modelTable.cache"))}</th>
              <th>${escapeHtml(t("modelTable.equivalent"))}</th>
            </tr>
          </thead>
          <tbody>
            ${models
              .map((model) => {
                const input = n(model.uncachedInputTokens) + n(model.cachedInputTokens);
                const modelCacheRatio = input > 0 ? n(model.cachedInputTokens) / input : 0;
                const equivalent = model.separateQuota
                  ? t("modelTable.separate")
                  : model.hasRate
                    ? fmtCredits(model.creditEquivalent, model.creditEquivalent >= 1000 ? 0 : 2)
                    : t("modelTable.unavailable");
                return `
                  <tr>
                    <td class="cqc-model-name">${escapeHtml(model.model)}</td>
                    <td class="cqc-mono">${fmtNum(model.tokens)}</td>
                    <td class="cqc-mono">${fmtNum(model.uncachedInputTokens)}</td>
                    <td class="cqc-mono">${fmtNum(model.cachedInputTokens)}</td>
                    <td class="cqc-mono">${fmtNum(model.outputTokens)}</td>
                    <td class="cqc-mono">${(modelCacheRatio * 100).toFixed(0)}%</td>
                    <td class="cqc-mono">${escapeHtml(equivalent)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t("table.total"))}</td>
              <td class="cqc-mono">${fmtNum(totals.tokens)}</td>
              <td class="cqc-mono">${fmtNum(totals.uncachedInputTokens)}</td>
              <td class="cqc-mono">${fmtNum(totals.cachedInputTokens)}</td>
              <td class="cqc-mono">${fmtNum(totals.outputTokens)}</td>
              <td class="cqc-mono">${(n(totals.cacheRatio) * 100).toFixed(0)}%</td>
              <td class="cqc-mono">${fmtCredits(totals.creditEquivalent, totals.creditEquivalent >= 1000 ? 0 : 2)}</td>
            </tr>
          </tfoot>
        </table>
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
      if (allowRefresh && !reportCoversChartRange(latestReport)) return refreshPassiveReport({ force: true });
      if (allowRefresh) refreshPassiveReport();
      return Promise.resolve(latestReport);
    }
    return hydrateCachedReport().then((cached) => {
      if (cached) {
        if (allowRefresh && !reportCoversChartRange(cached)) return refreshPassiveReport({ force: true });
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
    const requestedScopeKey = meterChartScope().key;
    if (failedPassiveScopeKey === requestedScopeKey) return Promise.resolve(latestReport);
    const now = Date.now();
    if (!force && now - lastPassiveRefreshAt < PASSIVE_REFRESH_MIN_INTERVAL_MS) {
      return Promise.resolve(latestReport);
    }
    if (!passiveReportPromise) {
      passiveReportError = null;
      lastPassiveRefreshAt = now;
      passiveReportPromise = reportService
        .refreshReport()
        .then((report) => {
          latestReport = report;
          if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
          if (ENABLE_CHART_TOOLTIP_ENHANCER) scheduleChartTooltipEnhance();
          return report;
        })
        .catch((error) => {
          passiveReportError = error.message || String(error);
          failedPassiveScopeKey = requestedScopeKey;
          if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
          return latestReport;
        })
        .finally(() => {
          passiveReportPromise = null;
          if (usageChartMode === CHART_MODES.meter && isAnalyticsRoute() && !reportCoversChartRange(latestReport) && failedPassiveScopeKey !== meterChartScope().key) {
            refreshPassiveReport({ force: true });
          }
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
      const hasChartSwitch = Boolean(document.getElementById(CHART_IDS.switcher));
      const needsButton = isAnalyticsRoute() && meterSettings.showPageButton && !hasButton;
      const needsChartSwitch = isAnalyticsRoute() && meterSettings.showChartControls && !hasChartSwitch;
      const staleButton = !isAnalyticsRoute() && hasButton;
      if (!routeChanged && !needsButton && !needsChartSwitch && !staleButton) return;
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
    const observer = new MutationObserver((records) => {
      const changed = records.some((record) => {
        if (isCodexMeterOwned(record.target)) return false;
        if (record.type === "attributes") return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) =>
          node.nodeType === Node.ELEMENT_NODE && !isCodexMeterOwned(node),
        );
      });
      if (changed) notify();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "aria-valuetext"],
    });
    window.__codexMeterMutationObserver = observer;
    window.clearInterval(window.__codexMeterRouteInterval);
    window.__codexMeterRouteInterval = window.setInterval(poll, 1200);
    window.addEventListener("visibilitychange", poll);
  };

  const installUsageChartControlSync = () => {
    if (installUsageChartControlSync.didInstall) return;
    installUsageChartControlSync.didInstall = true;
    const onPossibleControlChange = (event) => {
      if (!isAnalyticsRoute()) return;
      if (!isOfficialAnalyticsControlTarget(event.target)) return;
      scheduleUsageChartControlSync();
    };
    document.addEventListener("click", onPossibleControlChange, true);
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        onPossibleControlChange(event);
      },
      true,
    );
  };

  const installUsageChartResizeSync = () => {
    if (installUsageChartResizeSync.didInstall) return;
    installUsageChartResizeSync.didInstall = true;
    const sync = () => {
      if (!isAnalyticsRoute() || usageChartResizeFrame) return;
      usageChartResizeFrame = requestAnimationFrame(() => {
        usageChartResizeFrame = 0;
        ensureDetailButton();
        ensureUsageChartSwitch();
        if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
      });
    };
    window.addEventListener("resize", sync, { passive: true });
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(sync);
      observer.observe(document.documentElement);
      window.__codexMeterResizeObserver?.disconnect?.();
      window.__codexMeterResizeObserver = observer;
    }
  };

  const isOfficialAnalyticsControlTarget = (target) => {
    const element = target instanceof Element ? target : null;
    if (!element || isCodexMeterOwned(element)) return false;
    const mount = usagePage.findMount();
    return Boolean(mount?.section.contains(element));
  };

  const scheduleUsageChartControlSync = () => {
    window.clearTimeout(usageChartControlTimer);
    const sync = () => {
      usageChartControlTimer = 0;
      if (!isAnalyticsRoute()) return;
      ensureDetailButton();
      ensureUsageChartSwitch();
      if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
    };
    usageChartControlTimer = window.setTimeout(sync, 180);
    window.setTimeout(() => {
      if (isAnalyticsRoute()) {
        ensureUsageChartSwitch();
        if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
      }
    }, 520);
  };

  const init = () => {
    ensureChromeRuntimeListener();
    installSettingsSync();
    installRouteObserver();
    installUsageChartControlSync();
    installUsageChartResizeSync();
    window.__codexQuotaCompassUpdateVisibility = updateVisibility;
    updateVisibility();
    loadMeterSettings();
  };

  init();
})();
