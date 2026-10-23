const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const reportServiceSource = fs.readFileSync(
  path.join(__dirname, "../codex-meter-extension/application/report-service.js"),
  "utf8",
);

const FIXED_NOW = "2026-10-06T08:00:00.000Z";

class FixedDate extends Date {
  constructor(value) {
    super(arguments.length === 0 ? FIXED_NOW : value);
  }

  static now() {
    return new Date(FIXED_NOW).getTime();
  }
}

const localDate = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const normalize = (value) => JSON.parse(JSON.stringify(value));

const createHarness = ({ getDateRange, dailyRows = [] } = {}) => {
  const window = {};
  vm.runInNewContext(reportServiceSource, { Date: FixedDate, window });

  const requests = [];
  const statsInputs = [];
  const chatGptClient = {
    getBootstrapToken: () => "bootstrap-token",
    apiGet: async (url, token) => {
      requests.push({ token, url });
      if (url === "/backend-api/wham/usage") return { rate_limit: {} };
      return { data: dailyRows };
    },
  };
  const domainWindow = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../codex-meter-extension/domain/usage-domain.js"), "utf8"), { window: domainWindow });
  const domain = {
    ...domainWindow.CodexMeterDomain,
    addDays,
    extractLimitWindows: () => [],
    getStats: (rows) => {
      statsInputs.push(rows);
      return { rowCount: rows.length };
    },
    localDate,
  };
  const service = window.CodexMeterReportService.createReportService({
    chatGptClient,
    config: { LOOKBACK_DAYS: 45 },
    domain,
    getDateRange,
    getPageLocale: () => "zh-CN",
    pageHref: () => "https://chatgpt.com/settings/usage?tab=analytics",
    reportRepository: { save: async () => {} },
    translate: (key) => key,
  });

  return { requests, service, statsInputs };
};

test("默认请求仍覆盖最近 45 天至明日", async () => {
  const { requests, service } = createHarness();

  const report = await service.buildReport();

  assert.equal(report.startDate, "2026-08-22");
  assert.equal(report.endDate, "2026-10-07");
  assert.deepEqual(requests.filter(request => !request.url.includes("daily-workspace-user-token-usage-breakdown")), [
    { token: "bootstrap-token", url: "/backend-api/wham/usage" },
    {
      token: "bootstrap-token",
      url: "/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=2026-08-22&end_date=2026-10-07&group_by=day",
    },
  ]);
});

test("选择更早的历史周期时扩大起始日期，并将选中结束日按闭区间计入", async () => {
  const { requests, service } = createHarness({
    getDateRange: () => ({ startDate: "2026-08-01", endDate: "2026-09-01" }),
  });

  const report = await service.buildReport();

  assert.equal(report.startDate, "2026-08-01");
  assert.equal(report.endDate, "2026-10-07");
  assert.equal(
    requests[1].url,
    "/backend-api/wham/analytics/daily-workspace-usage-counts?start_date=2026-08-01&end_date=2026-10-07&group_by=day",
  );
});

test("非法、未来、倒序或抛错的页面范围不会进入请求", async (t) => {
  const invalidRanges = [
    { name: "不存在的日期", value: { startDate: "2026-02-30", endDate: "2026-03-01" } },
    { name: "非 ISO 日期", value: { startDate: "2026-8-01", endDate: "2026-09-01" } },
    { name: "未来日期", value: { startDate: "2026-10-01", endDate: "2026-10-07" } },
    { name: "倒序日期", value: { startDate: "2026-09-02", endDate: "2026-09-01" } },
  ];

  for (const invalid of invalidRanges) {
    await t.test(invalid.name, async () => {
      const { requests, service } = createHarness({ getDateRange: () => invalid.value });
      const report = await service.buildReport();

      assert.equal(report.startDate, "2026-08-22");
      assert.equal(report.endDate, "2026-10-07");
      assert.match(requests[1].url, /start_date=2026-08-22&end_date=2026-10-07/);
    });
  }

  await t.test("回调抛错", async () => {
    const { requests, service } = createHarness({
      getDateRange: () => {
        throw new Error("page is rerendering");
      },
    });
    await service.buildReport();

    assert.match(requests[1].url, /start_date=2026-08-22&end_date=2026-10-07/);
  });
});

test("旧接口返回的全部 token 字段原样保留", async () => {
  const dailyRows = [
    {
      date: "2026-10-05",
      totals: {
        credits: 1.25,
        turns: 3,
        threads: 2,
        text_total_tokens: 1234,
        cached_text_input_tokens: 456,
        uncached_text_input_tokens: 567,
        text_output_tokens: 211,
      },
      by_model: {
        "gpt-5": {
          cached_text_input_tokens: 100,
          uncached_text_input_tokens: 200,
          text_output_tokens: 50,
        },
      },
    },
  ];
  const { requests, service, statsInputs } = createHarness({ dailyRows });

  const report = await service.buildReport();

  assert.deepEqual(normalize(report.dailyList), dailyRows);
  assert.deepEqual(normalize(report.currentCycleList), dailyRows);
  assert.deepEqual(normalize(statsInputs.at(-1)), dailyRows);
  assert.match(requests[1].url, /^\/backend-api\/wham\/analytics\/daily-workspace-usage-counts\?/);
  assert.doesNotMatch(requests[1].url, /percent|token-usage-breakdown/);
});
