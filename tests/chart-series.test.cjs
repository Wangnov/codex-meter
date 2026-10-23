const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sandbox = { window: {}, Date, Intl };
vm.runInNewContext(
  fs.readFileSync(
    path.join(__dirname, "../codex-meter-extension/domain/usage-domain.js"),
    "utf8",
  ),
  sandbox,
);

const domain = sandbox.window.CodexMeterDomain;
const normalize = (value) => JSON.parse(JSON.stringify(value));

test("图表指标沿用原始绝对值，USD 留给 UI 换算", () => {
  const totals = {
    credits: 2.5,
    turns: 7,
    text_total_tokens: 1_000,
    cached_text_input_tokens: 300,
    uncached_text_input_tokens: 400,
    text_output_tokens: 200,
  };

  assert.equal(domain.chartMetricValue(totals, "credits"), 2.5);
  assert.equal(domain.chartMetricValue(totals, "usd"), 2.5);
  assert.equal(domain.chartMetricValue(totals, "turns"), 7);
  assert.equal(domain.chartMetricValue(totals, "tokens"), 1_000);
  assert.equal(
    domain.chartMetricValue(
      {
        cached_text_input_tokens: 30,
        uncached_text_input_tokens: 40,
        text_output_tokens: 20,
      },
      "tokens",
    ),
    90,
  );
});

test("真实扁平 clients 和 models 结构按稳定 key 分组并补齐残差", () => {
  const row = {
    date: "2026-10-06",
    totals: { credits: 10, turns: 8, text_total_tokens: 1_000 },
    clients: [
      { client_id: "CODEX_CLI", credits: 6, turns: 5, text_total_tokens: 600 },
      { client_id: "CODEX_WORK_WEB", credits: 3, turns: 3, text_total_tokens: 300 },
    ],
    models: [
      { model: "gpt-6.1-sol", credits: 0, turns: 5, users: 1, threads: 2 },
      { model: "gpt-6-astra", credits: 0, turns: 3, users: 1, threads: 1 },
    ],
  };

  assert.deepEqual(normalize(domain.chartSeries(row, "credits", "clients")), [
    { key: "CODEX_CLI", label: "CODEX_CLI", value: 6 },
    { key: "CODEX_WORK_WEB", label: "CODEX_WORK_WEB", value: 3 },
    { key: "unclassified", label: "", value: 1 },
  ]);
  assert.deepEqual(normalize(domain.chartSeries(row, "tokens", "clients")), [
    { key: "CODEX_CLI", label: "CODEX_CLI", value: 600 },
    { key: "CODEX_WORK_WEB", label: "CODEX_WORK_WEB", value: 300 },
    { key: "unclassified", label: "", value: 100 },
  ]);
  assert.deepEqual(normalize(domain.chartSeries(row, "turns", "models")), [
    { key: "gpt-6.1-sol", label: "gpt-6.1-sol", value: 5 },
    { key: "gpt-6-astra", label: "gpt-6-astra", value: 3 },
  ]);
  assert.deepEqual(normalize(domain.chartSeries(row, "credits", "models")), [
    { key: "unclassified", label: "", value: 10 },
  ]);
});

test("模型没有 token 字段时不伪造模型拆分", () => {
  const row = {
    totals: {
      text_total_tokens: 1_000,
      cached_text_input_tokens: 300,
      uncached_text_input_tokens: 400,
      text_output_tokens: 200,
    },
    models: [
      { model: "gpt-6.1-sol", credits: 0, turns: 5 },
      { model: "gpt-6-astra", credits: 0, turns: 3 },
    ],
  };

  assert.deepEqual(normalize(domain.chartSeries(row, "tokens", "models")), [
    { key: "unclassified", label: "", value: 1_000 },
  ]);
});

test("token 类型保留未知残差，不把它错误并入输出", () => {
  const row = {
    totals: {
      text_total_tokens: 1_000,
      cached_text_input_tokens: 300,
      uncached_text_input_tokens: 400,
      text_output_tokens: 200,
    },
  };

  assert.deepEqual(normalize(domain.chartSeries(row, "tokens", "tokens")), [
    { key: "uncachedInput", label: "Uncached input", value: 400 },
    { key: "cachedInput", label: "Cached input", value: 300 },
    { key: "output", label: "Output", value: 200 },
    { key: "unclassified", label: "", value: 100 },
  ]);
});

test("周期汇总仅使用传入日，按全量 series 计算稳定百分比", () => {
  const selectedRows = [
    {
      date: "2026-10-05",
      totals: { credits: 10 },
      models: [
        { model: "gpt-6.1-sol", credits: 6 },
        { model: "gpt-6-astra", credits: 3 },
      ],
    },
    {
      date: "2026-10-06",
      totals: { credits: 10 },
      models: [
        { model: "gpt-6.1-sol", credits: 2 },
        { model: "gpt-5.6-sol", credits: 8 },
      ],
    },
    { date: "2026-10-07", totals: {} },
  ];
  const outsidePeriod = {
    date: "2026-09-01",
    totals: { credits: 1_000 },
    models: [{ model: "outside", credits: 1_000 }],
  };

  const summary = normalize(domain.chartSummary(selectedRows, "credits", "models"));
  assert.deepEqual(summary, {
    series: [
      { key: "gpt-5.6-sol", label: "gpt-5.6-sol", value: 8, share: 0.4 },
      { key: "gpt-6.1-sol", label: "gpt-6.1-sol", value: 8, share: 0.4 },
      { key: "gpt-6-astra", label: "gpt-6-astra", value: 3, share: 0.15 },
      { key: "unclassified", label: "", value: 1, share: 0.05 },
    ],
    total: 20,
    reportedTotal: 20,
    hasMismatch: false,
  });
  assert.equal(summary.series.some((series) => series.key === outsidePeriod.models[0].model), false);
});

test("分组和高于日 totals 时保留真实分项并使用自洽分母", () => {
  const rows = [
    {
      totals: { credits: 5 },
      models: [
        { model: "gpt-a", credits: 4 },
        { model: "gpt-b", credits: 3 },
      ],
    },
  ];

  const summary = normalize(domain.chartSummary(rows, "credits", "models"));
  assert.deepEqual(summary, {
    series: [
      { key: "gpt-a", label: "gpt-a", value: 4, share: 4 / 7 },
      { key: "gpt-b", label: "gpt-b", value: 3, share: 3 / 7 },
    ],
    total: 7,
    reportedTotal: 5,
    hasMismatch: true,
  });
});

test("Credits 浮点误差不会产生幽灵残差或误报不一致", () => {
  const rowWithTinyPositiveResidual = {
    totals: { credits: 0.1 + 0.2 },
    clients: [{ client_id: "CODEX_CLI", credits: 0.3 }],
  };
  assert.deepEqual(
    normalize(domain.chartSeries(rowWithTinyPositiveResidual, "credits", "clients")),
    [{ key: "CODEX_CLI", label: "CODEX_CLI", value: 0.3 }],
  );

  const summary = normalize(
    domain.chartSummary(
      [
        {
          totals: { credits: 0.3 },
          clients: [
            { client_id: "CODEX_CLI", credits: 0.1 },
            { client_id: "CODEX_WORK_WEB", credits: 0.2 },
          ],
        },
      ],
      "credits",
      "clients",
    ),
  );
  assert.equal(summary.hasMismatch, false);
  assert.equal(summary.reportedTotal, 0.3);
  assert.equal(summary.series.some((series) => series.key === "unclassified"), false);
});

test("getStats 累计输出与未归类 Tokens", () => {
  const stats = normalize(
    domain.getStats([
      {
        totals: {
          text_total_tokens: 1_000,
          cached_text_input_tokens: 300,
          uncached_text_input_tokens: 400,
          text_output_tokens: 200,
        },
      },
      {
        totals: {
          text_total_tokens: 500,
          cached_text_input_tokens: 200,
          uncached_text_input_tokens: 200,
          text_output_tokens: 150,
        },
      },
    ]),
  );

  assert.equal(stats.outputTokens, 350);
  assert.equal(stats.unclassifiedTokens, 100);
});
