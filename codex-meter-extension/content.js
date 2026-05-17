(function () {
  "use strict";

  const CONTENT_SCRIPT_VERSION = "0.4.19";
  const ENABLE_CHART_TOOLTIP_ENHANCER = false;
  const CHART_IDS = {
    controls: "codex-meter-chart-controls",
    switcher: "codex-meter-chart-switcher",
    metric: "codex-meter-chart-metric",
    view: "codex-meter-chart-view",
  };
  const CHART_MODE_STORAGE_KEY = "codexMeterUsageChartMode";
  const CHART_METRIC_STORAGE_KEY = "codexMeterUsageChartMetric";
  const CHART_MODES = {
    source: "source",
    meter: "meter",
  };
  const CHART_RANGES = {
    sevenDays: "7d",
    month: "month",
    custom: "custom",
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
  let usageChartControlTimer = 0;
  let usageChartResizeFrame = 0;
  let usageChartMode = CHART_MODES.source;
  let meterChartMetric = CHART_METRICS.credits;
  let renderedMeterChartRows = [];
  let lastPassiveRefreshAt = 0;
  const PASSIVE_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

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
        source: "按来源",
        meter: "Meter",
        metric: "指标",
        loading: "正在读取 Meter 图表数据...",
        empty: "暂无可绘制的用量数据。",
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
      chart: {
        source: "按來源",
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
        source: "按來源",
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
        source: "By source",
        meter: "Meter",
        metric: "Metric",
        loading: "Reading Meter chart data...",
        empty: "No usage data to chart yet.",
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
      chart: {
        source: "ソース別",
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
        source: "Par source",
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
        source: "По источнику",
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
        source: "Por origen",
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
        source: "Nach Quelle",
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

  const hasProductUsageLegend = (element) => {
    const text = elementText(element);
    return /\bDesktop App\b/.test(text) && /\b(CLI|Cloud|Exec|Other)\b/.test(text);
  };

  const findProductUsageSection = () =>
    visibleMainSections()
      .filter(hasProductUsageLegend)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.top - br.top || ar.height - br.height;
      })[0] || null;

  const findProductLegendElement = (section) =>
    [...section.querySelectorAll("div,ul,ol,nav")]
      .filter(isRenderableElement)
      .filter((element) => element !== section && hasProductUsageLegend(element))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.width * ar.height - br.width * br.height;
      })[0] || null;

  const findProductChartHeading = (section) => {
    if (!section) return null;
    const headings = [...section.querySelectorAll("h2,h3,[role='heading']")]
      .filter(isRenderableElement)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const knownPersonalLabels = knownText("personalUsage");
    return (
      headings.find((heading) => knownPersonalLabels.includes(elementText(heading))) ||
      headings.findLast?.((heading) => heading.matches("h3,[role='heading']")) ||
      headings.filter((heading) => heading.matches("h3,[role='heading']")).at(-1) ||
      headings.at(-1) ||
      null
    );
  };

  const findProductChartFrame = (section, heading) => {
    if (!section) return null;
    const sectionRect = section.getBoundingClientRect();
    const headingBottom = heading?.getBoundingClientRect().bottom ?? sectionRect.top;
    const legend = findProductLegendElement(section);
    const legendTop = legend?.getBoundingClientRect().top ?? sectionRect.bottom;
    const candidates = [...section.querySelectorAll("div,section,article,svg,canvas")]
      .filter(isRenderableElement)
      .filter((element) => !element.closest(`#${IDS.overlay}, #${CHART_IDS.view}, #${CHART_IDS.controls}`))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const area = rect.width * rect.height;
        return (
          rect.top >= headingBottom + 12 &&
          rect.top < legendTop &&
          rect.bottom <= legendTop + 28 &&
          rect.width >= Math.min(520, sectionRect.width * 0.55) &&
          rect.height >= 220 &&
          area < sectionRect.width * sectionRect.height * 0.82
        );
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aKindScore = a.matches("svg.recharts-surface") ? -120 : a.matches("svg,canvas") ? -60 : 0;
        const bKindScore = b.matches("svg.recharts-surface") ? -120 : b.matches("svg,canvas") ? -60 : 0;
        const aScore = aKindScore + Math.abs(ar.top - (headingBottom + 32)) + Math.abs(ar.bottom - legendTop) * 0.35;
        const bScore = bKindScore + Math.abs(br.top - (headingBottom + 32)) + Math.abs(br.bottom - legendTop) * 0.35;
        return aScore - bScore;
      });
    return {
      frame: candidates[0] || null,
      legend,
    };
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

  const findUsageDetailsMount = () => {
    const knownHeading = findKnownHeading("usageDetails");
    if (knownHeading) return mountForHeading(knownHeading);

    const productLegendSection = findProductUsageSection();
    if (productLegendSection) {
      return mountForHeading(sectionHeading(productLegendSection) || headingNearSection(productLegendSection));
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

  const ensureUsageChartSwitch = () => {
    if (!isAnalyticsRoute()) {
      removeUsageChartSwitch();
      return false;
    }

    const section = findProductUsageSection();
    const heading = findProductChartHeading(section);
    if (!section || !heading) {
      removeUsageChartSwitch();
      return false;
    }

    if (getComputedStyle(section).position === "static") section.style.position = "relative";
    const detailMount = findUsageDetailsMount();
    const switcherMount = detailMount?.section || section;
    if (getComputedStyle(switcherMount).position === "static") switcherMount.style.position = "relative";
    if (usageChartMode === CHART_MODES.source) {
      setDatasetIfChanged(section, "cqmMeterChartMode", usageChartMode);
    }
    const chartMount = findProductChartFrame(section, heading);
    if (!chartMount?.frame) {
      removeUsageChartSwitch();
      return false;
    }
    markProductChartMount(chartMount);

    let controls = document.getElementById(CHART_IDS.controls);
    if (!controls) {
      controls = document.createElement("div");
      controls.id = CHART_IDS.controls;
    }
    if (controls.parentElement !== switcherMount) switcherMount.appendChild(controls);

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
          toggleMeterMetricMenu();
        }
      });
    }
    setHtmlIfChanged(metric, renderMeterMetricControl());
    if (metric.parentElement !== controls) controls.appendChild(metric);
    installMeterMetricDismiss();

    let view = document.getElementById(CHART_IDS.view);
    if (!view) {
      view = document.createElement("div");
      view.id = CHART_IDS.view;
      view.className = "cqm-meter-chart-view";
      view.addEventListener("pointermove", handleMeterChartPointerMove);
      view.addEventListener("pointerleave", hideMeterChartTooltip);
    }
    if (view.parentElement !== section) section.appendChild(view);

    setDatasetIfChanged(section, "cqmMeterChartMode", usageChartMode);
    updateUsageChartSwitcher(switcher);
    updateMeterMetricControl(metric);
    positionUsageChartLayer(section, heading, controls, view, chartMount, switcherMount);
    renderMeterChartView();
    if (usageChartMode === CHART_MODES.meter && !latestReport) {
      renderMeterChartLoading();
      ensurePassiveReport({ allowRefresh: true }).then((report) => {
        if (report && usageChartMode === CHART_MODES.meter) renderMeterChartView();
      });
    }
    return true;
  };

  const removeUsageChartSwitch = () => {
    document.getElementById(CHART_IDS.controls)?.remove();
    document.getElementById(CHART_IDS.switcher)?.remove();
    document.getElementById(CHART_IDS.metric)?.remove();
    document.getElementById(CHART_IDS.view)?.remove();
    clearProductChartMountMarks();
    document.querySelectorAll("[data-cqm-meter-chart-mode]").forEach((section) => {
      delete section.dataset.cqmMeterChartMode;
    });
  };

  const setUsageChartMode = (mode) => {
    if (mode !== CHART_MODES.source && mode !== CHART_MODES.meter) return;
    if (mode === usageChartMode) return;
    usageChartMode = mode;
    try {
      window.localStorage?.setItem(CHART_MODE_STORAGE_KEY, mode);
    } catch {}
    if (mode === CHART_MODES.source) {
      document.querySelectorAll("[data-cqm-meter-chart-mode]").forEach((section) => {
        setDatasetIfChanged(section, "cqmMeterChartMode", mode);
      });
      hideMeterChartTooltip();
    }
    ensureUsageChartSwitch();
  };

  const setMeterChartMetric = (metric) => {
    if (!Object.values(CHART_METRICS).includes(metric)) return;
    meterChartMetric = metric;
    try {
      window.localStorage?.setItem(CHART_METRIC_STORAGE_KEY, metric);
    } catch {}
    const control = document.getElementById(CHART_IDS.metric);
    if (control) setHtmlIfChanged(control, renderMeterMetricControl());
    if (control) setDatasetIfChanged(control, "open", "false");
    updateMeterMetricControl(control);
    renderMeterChartView();
  };

  const toggleMeterMetricMenu = () => {
    const control = document.getElementById(CHART_IDS.metric);
    if (!control) return;
    const nextOpen = control.dataset.open === "true" ? "false" : "true";
    setDatasetIfChanged(control, "open", nextOpen);
    control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", nextOpen);
  };

  const installMeterMetricDismiss = () => {
    if (installMeterMetricDismiss.didInstall) return;
    installMeterMetricDismiss.didInstall = true;
    document.addEventListener(
      "pointerdown",
      (event) => {
        const control = document.getElementById(CHART_IDS.metric);
        if (!control || control.contains(event.target)) return;
        setDatasetIfChanged(control, "open", "false");
        control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", "false");
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const control = document.getElementById(CHART_IDS.metric);
      if (!control) return;
      setDatasetIfChanged(control, "open", "false");
      control.querySelector(".cqm-chart-metric-button")?.setAttribute("aria-expanded", "false");
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
    [CHART_METRICS.credits]: "#dc2626",
    [CHART_METRICS.tokens]: "#1d4ed8",
    [CHART_METRICS.usd]: "#059669",
    [CHART_METRICS.turns]: "#7c2d12",
  };

  const meterTokenSeries = () => [
    { key: "uncachedInput", label: t("chart.series.uncachedInput"), color: "#dc2626" },
    { key: "cachedInput", label: t("chart.series.cachedInput"), color: "#7c2d12" },
    { key: "output", label: t("chart.series.output"), color: "#1d4ed8" },
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
        <span class="cqm-chart-metric-label">${escapeHtml(t("chart.metric"))}:</span>
        <i class="cqm-chart-metric-swatch" style="--cqm-series-color:${escapeHtml(current.color)}"></i>
        <span>${escapeHtml(current.label)}</span>
        ${icon("chevronDown")}
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
                ${icon("check")}
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

  const positionUsageChartLayer = (section, heading, controls, view, chartMount, switcherMount) => {
    const sectionRect = section.getBoundingClientRect();
    const switcherMountRect = switcherMount.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const frameRect = chartMount.frame.getBoundingClientRect();
    const legendRect = chartMount.legend?.getBoundingClientRect();
    const buttonRect = document.getElementById(IDS.button)?.getBoundingClientRect();
    const chartTop = Math.max(0, Math.round(frameRect.top - sectionRect.top));
    const chartBottom = Math.round((legendRect?.bottom || frameRect.bottom) - sectionRect.top);
    const height = Math.max(260, Math.min(620, chartBottom - chartTop));
    const svgHeight = Math.round(frameRect.height);
    const legendGap = Math.max(0, Math.round((legendRect?.top ?? frameRect.bottom) - frameRect.bottom));
    const switcherHeight = 30;
    setDatasetIfChanged(controls, "layout", "inline");
    if (buttonRect) {
      const minControlsWidth = usageChartMode === CHART_MODES.meter ? 456 : 172;
      const availableBeforeButton = Math.max(0, Math.round(buttonRect.left - switcherMountRect.left - 16));
      const compact = availableBeforeButton < minControlsWidth;
      const top = Math.max(
        0,
        Math.round(
          buttonRect.top -
            switcherMountRect.top +
            (compact ? buttonRect.height + 8 : (buttonRect.height - switcherHeight) / 2),
        ),
      );
      const buttonLeftRight = Math.max(24, Math.round(switcherMountRect.right - buttonRect.left));
      controls.style.setProperty("--cqm-chart-controls-top", `${top}px`);
      controls.style.setProperty("--cqm-chart-controls-right", `${compact ? 24 : buttonLeftRight + 8}px`);
      controls.style.setProperty(
        "--cqm-chart-controls-max-width",
        `${Math.max(240, Math.round(switcherMountRect.width - 48))}px`,
      );
      setDatasetIfChanged(controls, "layout", compact ? "compact" : "inline");
    } else {
      const top = Math.max(0, Math.round(headingRect.top - sectionRect.top - 1));
      controls.style.setProperty("--cqm-chart-controls-top", `${top}px`);
      controls.style.setProperty("--cqm-chart-controls-right", "24px");
      controls.style.setProperty("--cqm-chart-controls-max-width", `${Math.max(240, Math.round(sectionRect.width - 48))}px`);
    }
    view.style.setProperty("--cqm-meter-chart-top", `${chartTop}px`);
    view.style.setProperty("--cqm-meter-chart-height", `${height}px`);
    view.style.setProperty("--cqm-meter-svg-height", `${svgHeight}px`);
    view.style.setProperty("--cqm-meter-legend-gap", `${legendGap}px`);
  };

  const renderMeterChartLoading = () => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
    setHtmlIfChanged(
      view,
      `<div class="cqm-meter-chart-state">${icon("sparkles")}<span>${escapeHtml(t("chart.loading"))}</span></div>`,
    );
  };

  const renderMeterChartView = () => {
    const view = document.getElementById(CHART_IDS.view);
    if (!view) return;
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
    const chartWidth = meterChartRenderWidth(view);
    const key = `${getLocale()}|${meterChartMetric}|${scope.key}|${chartWidth}|${rows
      .map((row) => `${row.date}:${row.endDate || ""}:${row.credits}:${row.tokens}:${row.uncachedInputTokens}:${row.cachedInputTokens}:${row.outputTokens}:${row.turns}`)
      .join("|")}`;
    if (view.dataset.chartKey === key) return;
    view.dataset.chartKey = key;
    renderedMeterChartRows = rows;
    setHtmlIfChanged(view, renderMeterChart(rows, chartWidth));
  };

  const meterChartRenderWidth = (view) => {
    const rectWidth = view?.getBoundingClientRect?.().width || 0;
    return Math.max(360, Math.round(rectWidth || 952));
  };

  const meterChartRows = (report, scope = meterChartScope(report)) => {
    const dailyRows = sortedDailyRows(report).filter(
      (row) => row.date >= scope.startDate && row.date <= scope.endDate,
    );
    const rows =
      scope.grouping === CHART_GROUPINGS.week
        ? aggregateMeterRowsByWeek(dailyRows, scope)
        : dailyRows.map((row) => meterChartRowFromTotals(row.date, row.totals || {}));
    return rows.filter((row) => row.credits > 0 || row.tokens > 0 || row.turns > 0);
  };

  const sortedDailyRows = (report) =>
    [...(report?.dailyList || [])]
      .filter((row) => row?.date && row.date <= domain.localDate())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const meterChartScope = (report) => {
    const today = domain.localDate();
    const reportExtent = dailyReportExtent(report) || {
      startDate: dateKeyAdd(today, -31),
      endDate: today,
    };
    const range = detectOfficialChartRange();
    const grouping = detectOfficialChartGrouping();
    const officialExtent = officialChartDateExtent(report);
    const officialSpan = officialExtent ? daysBetween(officialExtent.startDate, officialExtent.endDate) : 0;
    const canUseOfficialExtent =
      officialExtent &&
      (range === CHART_RANGES.custom ||
        (range === CHART_RANGES.sevenDays && officialSpan <= 10) ||
        (range === CHART_RANGES.month && officialSpan >= 20 && officialSpan <= 40));

    let startDate = canUseOfficialExtent ? officialExtent.startDate : reportExtent.startDate;
    let endDate = canUseOfficialExtent ? officialExtent.endDate : reportExtent.endDate;

    if (!canUseOfficialExtent) {
      if (range === CHART_RANGES.sevenDays) {
        startDate = dateKeyAdd(today, -6);
        endDate = today;
      } else if (range === CHART_RANGES.month) {
        startDate = dateKeyAdd(today, -31);
        endDate = today;
      }
    }

    startDate = maxDateKey(startDate, reportExtent.startDate);
    endDate = minDateKey(endDate, reportExtent.endDate, today);
    if (startDate > endDate) {
      startDate = reportExtent.startDate;
      endDate = reportExtent.endDate;
    }

    return {
      range,
      grouping,
      startDate,
      endDate,
      key: `${range}:${grouping}:${startDate}:${endDate}`,
    };
  };

  const dailyReportExtent = (report) => {
    const rows = sortedDailyRows(report);
    if (!rows.length) return null;
    return {
      startDate: rows[0].date,
      endDate: rows.at(-1).date,
    };
  };

  const detectOfficialChartRange = () => {
    const buttons = findOfficialRangeButtons();
    const activeIndex = buttons.findIndex(isOfficialActiveSegmentButton);
    if (activeIndex === 0) return CHART_RANGES.sevenDays;
    if (activeIndex === 1) return CHART_RANGES.month;
    if (activeIndex === 2) return CHART_RANGES.custom;

    const activeText = normalizedText(buttons.find(isOfficialActiveSegmentButton)?.textContent || "");
    if (/(^|[^0-9])7([^0-9]|$)/.test(activeText)) return CHART_RANGES.sevenDays;
    if (/month|monate|mes|mois|месяц|月|개월/.test(activeText)) return CHART_RANGES.month;
    if (/custom|自定义|自訂|カスタム|personnalis|personaliz|benutzer|польз/.test(activeText)) {
      return CHART_RANGES.custom;
    }
    return CHART_RANGES.month;
  };

  const findOfficialRangeButtons = () => {
    const groups = [...document.querySelectorAll("main div")]
      .filter((element) => !isCodexMeterOwned(element))
      .map((group) => [...group.children].filter((child) => child.matches?.("button")))
      .filter((buttons) => buttons.length >= 3)
      .filter((buttons) => buttons.slice(0, 3).some((button) => button.getAttribute("aria-haspopup") === "dialog"))
      .filter((buttons) => buttons.every((button) => button.getBoundingClientRect().height > 0))
      .sort((a, b) => a[0].getBoundingClientRect().top - b[0].getBoundingClientRect().top);
    return groups[0]?.slice(0, 3) || [];
  };

  const isOfficialActiveSegmentButton = (button) => {
    const className = String(button?.className || "");
    return (
      /\bbg-token-bg-primary\b/.test(className) ||
      /\bshadow-sm\b/.test(className) ||
      button?.getAttribute("aria-selected") === "true" ||
      button?.getAttribute("aria-pressed") === "true"
    );
  };

  const detectOfficialChartGrouping = () => {
    const button = [...document.querySelectorAll("main button[role='combobox']")]
      .filter((element) => !isCodexMeterOwned(element) && isRenderableElement(element))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const text = normalizedText(button?.textContent || "");
    if (
      /week|weeks|semana|semaine|woche|недел|週|周/.test(text)
    ) {
      return CHART_GROUPINGS.week;
    }
    return CHART_GROUPINGS.day;
  };

  const officialChartDateExtent = (report) => {
    const rows = sortedDailyRows(report);
    if (!rows.length) return null;
    const frame =
      document.querySelector("[data-cqm-source-chart-frame='true']") ||
      (() => {
        const section = findProductUsageSection();
        return findProductChartFrame(section, findProductChartHeading(section))?.frame || null;
      })();
    if (!frame) return null;

    const rowByDate = new Map(rows.map((row) => [row.date, row]));
    const matchedDates = [];
    const labels = [...frame.querySelectorAll("text,tspan")]
      .map((element) => elementText(element))
      .filter(Boolean);
    labels.forEach((label) => {
      const explicitKeys = dateKeysFromTooltipText(label).filter((key) => rowByDate.has(key));
      if (explicitKeys.length) {
        matchedDates.push(...explicitKeys);
        return;
      }
      rows.forEach((row) => {
        if (dateVariants(row.date).some((variant) => textContainsDateVariant(label, variant))) {
          matchedDates.push(row.date);
        }
      });
    });

    const dates = [...new Set(matchedDates)].sort();
    if (dates.length < 2) return null;
    return {
      startDate: dates[0],
      endDate: dates.at(-1),
    };
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

  const meterChartRowFromTotals = (date, totals, { endDate = date } = {}) => {
    const credits = n(totals.credits);
    const tokens = tokenTotal(totals);
    return {
      row: { date, totals },
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
    Boolean(element?.closest?.(`#${IDS.overlay}, #${IDS.button}, #${CHART_IDS.controls}, #${CHART_IDS.view}`));

  const renderMeterChart = (rows, chartWidth = 952) => {
    const width = Math.max(360, Math.round(chartWidth));
    const height = 220;
    const plot = { left: 40, right: 20, top: 29, bottom: 30 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const values = rows.map((row) => meterMetricTotal(row));
    const maxValue = Math.max(...values, 1);
    const slot = plotWidth / rows.length;
    const maxBarWidth = rows.length <= 8 ? 120 : rows.length <= 14 ? 72 : 28;
    const barWidth = Math.max(3, Math.min(maxBarWidth, slot * 0.78));
    const bandWidth = Math.max(barWidth + 10, Math.min(slot, slot * 0.9));
    const barRadius = 3;
    const axisX = 22;
    const firstTickX = plot.left + (slot - barWidth) / 2 + 1.5;
    const lastTickX = width - plot.right - (slot - barWidth) / 2 - 1.5;
    const squarePath = (x, y, w, h) =>
      `M${x.toFixed(2)},${y.toFixed(2)}H${(x + w).toFixed(2)}V${(y + h).toFixed(2)}H${x.toFixed(2)}Z`;
    const roundedTopPath = (x, y, w, h) => {
      const radius = Math.min(barRadius, w / 2, h);
      if (radius <= 0.25) return squarePath(x, y, w, h);
      return [
        `M${x.toFixed(2)},${(y + h).toFixed(2)}`,
        `L${x.toFixed(2)},${(y + radius).toFixed(2)}`,
        `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + radius).toFixed(2)},${y.toFixed(2)}`,
        `H${(x + w - radius).toFixed(2)}`,
        `Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + radius).toFixed(2)}`,
        `V${(y + h).toFixed(2)}Z`,
      ].join("");
    };
    const bars = rows
      .map((row, index) => {
        const x = plot.left + slot * index + (slot - barWidth) / 2;
        const total = values[index];
        const hitHeight = total > 0 ? Math.max(2, (total / maxValue) * plotHeight) : 0;
        const slotX = plot.left + slot * index;
        const displaySegments = meterMetricSeries(row)
          .filter((series) => series.value > 0 && total > 0)
          .map((series) => ({
            ...series,
            height: (series.value / total) * hitHeight,
          }))
          .filter((series) => series.height >= 0.35);
        let yCursor = plot.top + plotHeight;
        const segments = displaySegments
          .map((series, segmentIndex) => {
            const isTopSegment = segmentIndex === displaySegments.length - 1;
            yCursor -= series.height;
            const y = Math.max(plot.top, yCursor);
            const path = isTopSegment
              ? roundedTopPath(x, y, barWidth, series.height)
              : squarePath(x, y, barWidth, series.height);
            return `
              <path
                class="cqm-meter-chart-bar-segment"
                data-index="${index}"
                data-series="${series.key}"
                d="${path}"
                style="--cqm-series-color:${escapeHtml(series.color)}"
              />
            `;
          })
          .join("");
        const hitY = plot.top + plotHeight - hitHeight;
        const bandX = slotX + (slot - bandWidth) / 2;
        return `
          ${segments}
          <rect
            class="cqm-meter-chart-hit"
            data-index="${index}"
            data-band-x="${bandX.toFixed(2)}"
            data-band-width="${bandWidth.toFixed(2)}"
            data-band-y="${plot.top.toFixed(2)}"
            data-band-height="${plotHeight.toFixed(2)}"
            x="${slotX.toFixed(2)}"
            y="${plot.top.toFixed(2)}"
            width="${slot.toFixed(2)}"
            height="${plotHeight.toFixed(2)}"
          />
        `;
      })
      .join("");
    const maxLabel = formatMeterMetricValue(maxValue);
    return `
      <svg class="cqm-meter-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Codex Meter">
        <line class="cqm-meter-axis-line" x1="${plot.left}" x2="${width - plot.right}" y1="${plot.top + plotHeight}" y2="${plot.top + plotHeight}" />
        <rect class="cqm-meter-chart-hover-band" hidden />
        <text class="cqm-meter-axis-label" data-axis="y" x="${axisX}" y="4" text-anchor="start"><tspan x="${axisX}" dy="0.355em">${escapeHtml(maxLabel)}</tspan></text>
        <text class="cqm-meter-axis-label" data-axis="y" x="${axisX}" y="${plot.top + plotHeight}" text-anchor="start"><tspan x="${axisX}" dy="0.355em">0</tspan></text>
        ${bars}
        <text class="cqm-meter-axis-label" x="${firstTickX.toFixed(2)}" y="${height - 12}">${escapeHtml(formatAxisDate(rows[0].date))}</text>
        <text class="cqm-meter-axis-label" x="${lastTickX.toFixed(2)}" y="${height - 12}" text-anchor="end">${escapeHtml(formatAxisDate(rows.at(-1).endDate || rows.at(-1).date))}</text>
      </svg>
      <div class="cqm-meter-chart-legend">
        ${meterMetricLegend()
          .map((series) => `<span><i style="--cqm-series-color:${escapeHtml(series.color)}"></i>${escapeHtml(series.label)}</span>`)
          .join("")}
      </div>
      <div class="cqm-meter-chart-tooltip" hidden></div>
    `;
  };

  const meterMetricSeries = (row) => {
    if (meterChartMetric === CHART_METRICS.tokens) {
      const components = [
        { ...meterTokenSeries()[0], value: n(row.uncachedInputTokens) },
        { ...meterTokenSeries()[1], value: n(row.cachedInputTokens) },
        { ...meterTokenSeries()[2], value: n(row.outputTokens) },
      ];
      const componentTotal = sumValues(components.map((series) => series.value));
      if (componentTotal > 0) {
        const residual = Math.max(0, n(row.tokens) - componentTotal);
        if (residual > 0) components[2].value += residual;
        return components;
      }
      return [{ ...meterTokenSeries()[0], value: n(row.tokens) }];
    }
    if (meterChartMetric === CHART_METRICS.usd) {
      return [{ key: "usd", label: t("table.usd"), color: meterMetricColors[CHART_METRICS.usd], value: n(row.usd) }];
    }
    if (meterChartMetric === CHART_METRICS.turns) {
      return [{ key: "turns", label: t("table.turns"), color: meterMetricColors[CHART_METRICS.turns], value: n(row.turns) }];
    }
    return [{ key: "credits", label: t("table.credits"), color: meterMetricColors[CHART_METRICS.credits], value: n(row.credits) }];
  };

  const meterMetricTotal = (row) => {
    if (meterChartMetric === CHART_METRICS.tokens) {
      const componentTotal = n(row.uncachedInputTokens) + n(row.cachedInputTokens) + n(row.outputTokens);
      return Math.max(n(row.tokens), componentTotal);
    }
    return sumValues(meterMetricSeries(row).map((series) => series.value));
  };

  const meterMetricLegend = () => {
    if (meterChartMetric === CHART_METRICS.tokens) return meterTokenSeries();
    const current = currentMeterMetricOption();
    return [{ key: current.key, label: current.label, color: current.color }];
  };

  const formatMeterMetricValue = (value) => {
    if (meterChartMetric === CHART_METRICS.tokens) return fmtNum(value);
    if (meterChartMetric === CHART_METRICS.usd) return fmtUsd(value / CONFIG.USD_PER_CREDIT);
    if (meterChartMetric === CHART_METRICS.turns) return String(Math.round(value));
    return fmtCredits(value, value >= 100 ? 0 : 1);
  };

  const formatAxisDate = (dateKey) => {
    const date = new Date(`${dateKey}T12:00:00`);
    try {
      return new Intl.DateTimeFormat(getPageLocale(), { month: "numeric", day: "numeric" }).format(date);
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
    const bar = event.target.closest?.(".cqm-meter-chart-bar-segment, .cqm-meter-chart-hit");
    const view = document.getElementById(CHART_IDS.view);
    if (!bar || !view?.contains(bar)) {
      hideMeterChartTooltip();
      return;
    }
    const row = renderedMeterChartRows[Number(bar.dataset.index)];
    if (!row) {
      hideMeterChartTooltip();
      return;
    }
    showMeterChartHoverBand(view, bar);
    showMeterChartTooltip(view, row, event.clientX, event.clientY);
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
    band.removeAttribute("hidden");
  };

  const showMeterChartTooltip = (view, row, clientX, clientY) => {
    const tooltip = view.querySelector(".cqm-meter-chart-tooltip");
    if (!tooltip) return;
    const tooltipKey = `${meterChartMetric}:${row.date}:${row.endDate || ""}`;
    if (tooltip.dataset.key !== tooltipKey) {
      tooltip.dataset.key = tooltipKey;
      setHtmlIfChanged(tooltip, renderMeterChartTooltip(row));
    }
    tooltip.hidden = false;
    const rect = view.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const x = Math.min(Math.max(16, clientX - rect.left + 16), Math.max(16, rect.width - tooltipRect.width - 16));
    const y = Math.min(Math.max(16, clientY - rect.top - tooltipRect.height - 12), Math.max(16, rect.height - tooltipRect.height - 16));
    tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const renderMeterChartTooltip = (row) => {
    const seriesRows = meterMetricSeries(row).filter((series) => series.value > 0);
    const total = meterMetricTotal(row);
    return `
      <div class="cqm-meter-tooltip-title">${escapeHtml(formatMeterTooltipDate(row))}</div>
      <div class="cqm-meter-tooltip-grid">
        ${seriesRows
          .map(
            (series) => `
              <span><i style="--cqm-series-color:${escapeHtml(series.color)}"></i>${escapeHtml(series.label)}</span>
              <strong>${escapeHtml(formatMeterMetricValue(series.value))}</strong>
            `,
          )
          .join("")}
        ${
          seriesRows.length > 1
            ? `<span class="cqm-meter-tooltip-total">${escapeHtml(t("table.total"))}</span><strong class="cqm-meter-tooltip-total">${escapeHtml(formatMeterMetricValue(total))}</strong>`
            : ""
        }
      </div>
    `;
  };

  const hideMeterChartTooltip = () => {
    const tooltip = document.querySelector(`#${CHART_IDS.view} .cqm-meter-chart-tooltip`);
    if (tooltip) tooltip.hidden = true;
    const band = document.querySelector(`#${CHART_IDS.view} .cqm-meter-chart-hover-band`);
    if (band) band.setAttribute("hidden", "");
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
      ensureDetailButton();
      ensureUsageChartSwitch();
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

  const weeklyLimitWindow = (report) =>
    (report.windows || []).find((window) => n(window.limitWindowSeconds) >= 6 * 24 * 60 * 60) ||
    report.primaryWindow ||
    null;

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
    const projection = weeklyProjection(report);
    const remaining = weeklyWindow?.remainingPercent;
    return `
      <div class="cqc-grid">
        ${renderMetricCard("gauge", t("metrics.remaining.0"), remaining == null ? "N/A" : `${remaining.toFixed(1)}%`, "fresh", true, t("metrics.remaining.1"))}
        ${renderMetricCard("coins", t("metrics.credits.0"), fmtCredits(stats.credits, 2), "mint", false, t("metrics.credits.1"))}
        ${renderMetricCard("cpu", t("metrics.tokens.0"), fmtNum(stats.tokens), "blue", false, t("metrics.tokens.1"))}
        ${renderMetricCard("trendingUp", t("metrics.projected.0"), projection.value, "amber", false, projection.hint)}
        ${renderMetricCard("layers", t("metrics.cache.0"), `${(stats.cacheRatio * 100).toFixed(1)}%`, "violet", false, t("metrics.cache.1"))}
        ${renderMetricCard("wallet", t("metrics.usd.0"), projection.usdValue, "ink", false, projection.usdHint)}
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
          if (usageChartMode === CHART_MODES.meter) renderMeterChartView();
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
      const hasChartSwitch = Boolean(document.getElementById(CHART_IDS.switcher));
      const needsButton = isAnalyticsRoute() && !hasButton;
      const needsChartSwitch = isAnalyticsRoute() && !hasChartSwitch;
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
    window.__codexMeterMutationObserver = null;
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
    const action = element.closest("button,[role='combobox'],[role='option'],[role='menuitemradio']");
    if (!action || isCodexMeterOwned(action)) return false;
    if (action.closest("[role='dialog'], [data-radix-popper-content-wrapper]")) return true;
    if (action.matches("button[role='combobox']")) return true;
    if (action.getAttribute("role") === "option") return true;
    const rangeGroup = action.parentElement;
    if (!rangeGroup) return false;
    const buttons = [...rangeGroup.children].filter((child) => child.matches?.("button"));
    return buttons.length >= 3 && buttons.slice(0, 3).some((button) => button.getAttribute("aria-haspopup") === "dialog");
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
    installRouteObserver();
    installUsageChartControlSync();
    installUsageChartResizeSync();
    window.__codexQuotaCompassUpdateVisibility = updateVisibility;
    updateVisibility();
  };

  init();
})();
