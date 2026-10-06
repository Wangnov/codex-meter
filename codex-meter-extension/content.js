(function () {
  "use strict";

  const CONTENT_SCRIPT_VERSION = "0.4.22";
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
  let cacheHydrationPromise = null;
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
      cachedNotice: "当前显示本地缓存，不会自动更新。点击“刷新”获取最新数据。",
      storageSaveFailed: "最新数据已读取，但本地快照保存失败（可能已达到存储容量上限）。本次数据仅在当前页面有效，原有历史未删除。",
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
      cachedNotice: "Showing local cached data; it does not update automatically. Click Refresh for current data.",
      storageSaveFailed: "Fresh data was fetched, but saving the local snapshot failed (storage may be full). This update is available only on this page; existing history was not deleted.",
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

  const ensureChromeRuntimeListener = () => {
    if (ensureChromeRuntimeListener.didInstall) return;
    ensureChromeRuntimeListener.didInstall = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "CQC_OPEN_PANEL") {
        hydrateCachedReport()
          .then((report) => {
            ensureUi();
            if (report) renderReport(report);
            openPanel();
            sendResponse({ ok: true });
          })
          .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
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
      if (status.innerHTML !== html) status.innerHTML = html;
      if (status.dataset.kind !== kind) status.dataset.kind = kind;
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

    try {
      latestReport = await reportService.refreshReport();
      renderReport(latestReport);
      return latestReport;
    } catch (error) {
      setStatus(error.message || String(error), "error");
      throw error;
    } finally {
      isRunning = false;
    }
  };

  const renderReport = (report) => {
    const body = document.querySelector(`#${IDS.panel} .cqc-body`);
    if (!body) return;
    body.innerHTML = renderReportBody(report);
    bindQuotaHistoryActions(body, report);
  };

  const renderQuotaHistory = (report) => {
    const rows = window.CodexMeterQuotaHistory.buildRows(report);
    const number = (value, digits = 3) => value == null ? "—" : value.toLocaleString(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `<section class="cqc-quota-history" aria-label="每日额度折算">
      <div class="cqc-section-title"><span>每日额度折算</span><span>日期按 UTC · 最近 ${CONFIG.LOOKBACK_DAYS} 天</span></div>
      <p class="cqc-hint">折算100%对应Credits = 当日Credits ÷（当日消耗百分比 / 100）。百分比来自官方历史接口，保留超过100%的值；缺失或无法计算时显示 —。</p>
      <p class="cqc-hint">这是历史分析百分比隐含的换算值，不保证等于当时套餐周额度上限。接口可能按统一口径换算历史数据。</p>
      <p class="cqc-hint">周期仅为按天推测：手动/全局重置优先，其次起点+7天或累计达到100%后的次日。重置当天不拆分，可能跨周期；未记录的全局重置、闲置和采样缺失都会影响标记。周期标记不参与每日折算。</p>
      ${(report.historyWarnings || []).map(w => `<p class="cqc-hint" role="status">${escapeHtml(w)}</p>`).join("")}
      ${!report.percentageData ? '<p class="cqc-hint">尚无历史百分比，请刷新重试。</p>' : ""}
      <div class="cqc-table-wrap"><table class="cqc-table cqc-quota-table">
      <thead><tr><th>日期（UTC）</th><th>每日Credits</th><th>每日消耗百分比</th><th>折算100%对应Credits</th><th>推测周期 / 重置</th></tr></thead>
      <tbody>${rows.slice().reverse().map(row => `<tr><td>${escapeHtml(row.date)}</td><td class="cqc-mono">${number(row.credits)}</td><td class="cqc-mono">${number(row.percent, 6)}${row.percent == null ? "" : "%"}</td><td class="cqc-mono">${number(row.fullCredits)}</td><td>${escapeHtml(row.period)}${row.notes ? `<br><strong>${escapeHtml(row.notes)}</strong>` : ""}</td></tr>`).join("") || '<tr><td colspan="5">暂无日用量数据</td></tr>'}</tbody></table></div>
      <details class="cqc-reset-editor"><summary>记录全局重置（如 Tibo 重置） · ${(report.globalResets || []).length} 条</summary>
        <p class="cqc-hint">仅保存到本机当前账号。支持 Unix 秒/毫秒时间戳，或带时区时间，如 2026-09-12T09:00:00+08:00。按 UTC 日期标记。</p>
        <form data-cqc-reset-form><label>全局重置时间 <input name="resetTime" required placeholder="Unix 时间戳或带时区的 ISO 时间" aria-label="全局重置时间"></label><button type="submit" class="cqc-text-button">保存记录</button></form>
        <p data-cqc-reset-status role="status"></p>
        <ul>${(report.globalResets || []).map(row => `<li><time>${escapeHtml(row.at)}</time> <button type="button" class="cqc-text-button" data-cqc-remove-reset="${escapeHtml(row.at)}">删除记录</button></li>`).join("")}</ul>
      </details></section>`;
  };

  const bindQuotaHistoryActions = (body, report) => {
    const status = body.querySelector("[data-cqc-reset-status]");
    let saving = false;
    const save = async (update) => {
      if (saving) return;
      saving = true;
      try {
        // Read fresh records so other page refreshes do not resurrect deleted entries.
        const current = await reportRepository.loadGlobalResets(report.accountScope);
        const rows = update(current).sort((a, b) => a.at.localeCompare(b.at));
        await reportRepository.saveGlobalResets(report.accountScope, rows);
        report.globalResets = rows;
        if (latestReport?.accountScope === report.accountScope) latestReport.globalResets = rows;
        renderReport(latestReport || report);
        const editor = document.querySelector(`#${IDS.panel} .cqc-reset-editor`);
        if (editor) editor.open = true;
        const result = document.querySelector(`#${IDS.panel} [data-cqc-reset-status]`);
        if (result) result.textContent = "记录已保存，周期标记已更新。";
      } catch (error) { if (status) status.textContent = error.message || "保存失败，请重试。"; }
      finally { saving = false; }
    };
    body.querySelector("[data-cqc-reset-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      try {
        const at = window.CodexMeterQuotaHistory.parseResetTime(new FormData(event.currentTarget).get("resetTime"));
        void save(rows => rows.some(row => row.at === at) ? rows : [...rows, { at }]);
      } catch (error) { status.textContent = error.message; }
    });
    body.querySelectorAll("[data-cqc-remove-reset]").forEach(button => button.addEventListener("click", () => {
      void save(rows => rows.filter(row => row.at !== button.dataset.cqcRemoveReset));
    }));
  };

  const renderReportBody = (report) => `
      <div class="cqc-status">${icon("check")}<span>${escapeHtml(t("updated", { time: report.capturedAtLocal }))}</span></div>
      ${renderSummaryCards(report)}
      ${renderQuotaHistory(report)}
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

  const showCachedPanel = async () => {
    // Open immediately; cache parsing/rendering must not prevent access to Refresh.
    openPanel();
    const report = await hydrateCachedReport();
    ensureUi();
    if (report) {
      renderReport(report);
      setStatus(t("cachedNotice"), "info");
    }
    openPanel();
  };

  const syncPageButton = () => {
    const existing = document.getElementById(IDS.button);
    if (!isAnalyticsRoute()) {
      existing?.remove();
      closePanel();
      return;
    }
    if (existing) return;
    const button = document.createElement("button");
    button.id = IDS.button;
    button.type = "button";
    button.textContent = "Codex Meter";
    button.addEventListener("click", () => {
      showCachedPanel().catch((error) => setStatus(error.message || String(error), "error"));
    });
    // Independent fixed entry: never insert into or modify official components.
    document.documentElement.appendChild(button);
  };

  const init = () => {
    ensureChromeRuntimeListener();
    syncPageButton();
    // Inspect only the URL, not chart DOM. Remount only after a route change.
    let lastRoute = location.href;
    window.setInterval(() => {
      if (location.href === lastRoute) return;
      lastRoute = location.href;
      syncPageButton();
    }, 1000);
  };

  init();
})();
