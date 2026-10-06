# 历史额度窗口可行性调查

验证日期：2026-09-12。对象：本地 Codex Meter 0.2.19，以及用户已登录 Chrome 的 Codex analytics 页面。通过浏览器 CDP 捕获真实响应，并在同源页面执行只读 GET 参数测试。未修改扩展代码、未触发额度重置。打开插件会触发其原有刷新和本地快照保存。

## 结论

可以增加历史日期范围、日/周/月汇总和官方百分比消耗历史。已验证 2026-06-14 至 2026-09-12 的历史查询可返回 13 个周分组。

现有已验证接口不足以还原每个真实周额度窗口的精确起止、最终百分比和 Credits/Tokens：历史明细最低只有日粒度，当前窗口接口不返回历史窗口账本，手动重置记录也不含重置前后计数及受影响限额。不能把查询分组周当作额度窗口。

这是一项可行性调查，不表示扩展已完成历史窗口功能，也不证明服务端绝不存在其他未公开接口。

## 已验证接口

所有路径均为 `https://chatgpt.com` 同源，只在页面内使用已有鉴权；不保存 token、邮箱或账户标识。

| 路径 | 实测结果 | 用途和限制 |
| --- | --- | --- |
| `/backend-api/wham/usage` | HTTP 200；`rate_limit.primary_window` 含 `used_percent`、`limit_window_seconds`、`reset_at`、`reset_after_seconds` | 当前额度快照；本账号查询时 `used_percent=0`，窗口长度 604800 秒；不含历史窗口 |
| `/backend-api/wham/analytics/daily-workspace-usage-counts` | HTTP 200；`data`、`balance_unit=credit`、`group_by` | 日期分组的 Credits、Tokens、轮次等；本插件原有数据源 |
| `/backend-api/wham/usage/daily-token-usage-breakdown` | HTTP 200；`data`、`units=percent`、`group_by` | 日/周分组的用量百分比，含来源和模型拆分；字段名 `models[].credits` 不能脱离顶层 `units` 当作 Credits 解释 |
| `/backend-api/wham/rate-limit-reset-credits/history` | HTTP 200；`events`、`window_start`、`as_of`、`next_cursor=null` | 本次覆盖最近 30 天；只有 `kind`、`occurred_at`、事件 ID；无重置前后计数、无具体被重置窗口 |

原生页面请求日用量计数时带 `workspace_user=true`；插件原请求未带此参数。面向多用户工作区的实现必须核对个人/工作区作用域，不能默认两者相同。

## 真实参数测试

1. `daily-workspace-usage-counts?start_date=2026-06-14&end_date=2026-09-12&group_by=week`：200，13 个分组，首行日期 2026-06-14，末行 2026-09-06，包含 Tokens 和 Credits。
2. `daily-token-usage-breakdown?start_date=2026-06-14&end_date=2026-09-12&group_by=week`：200，13 行，`units=percent`。
3. 两个历史接口以 2026-09-07 至 2026-09-08、`group_by=hour` 查询：400。计数接口明确返回 `Input should be 'day', 'week' or 'month'`。
4. 计数接口用 `start_date=2026-09-07T01:09:51Z`、`end_date=2026-09-08T00:00:00Z`、`group_by=day`：400，`Datetimes provided to dates should have zero time - e.g. be exact dates`。

成功返回的范围证明该次查询有数据，不代表已确认所有日期齐全、端点包含规则、时区定义或最长保留期限。

## 百分比历史示例

以下是响应各日 `product_surface_usage_values` 的求和，单位按接口顶层 `units=percent`；日期保留服务端日期键，未转换为北京时间自然日。这些是历史分析百分比，不是过去某个额度窗口的最终结算比例。

| 日期 | 接口百分比汇总 |
| --- | ---: |
| 2026-09-04 | 55.40770388235678 |
| 2026-09-07 | 57.70276094975651 |
| 2026-09-08 | 30.84654331306296 |
| 2026-09-09 | 48.69985387696103 |

## 为什么不能精确倒推额度窗口

- 手动重置使用时间：2026-08-22 09:05:23、2026-09-04 11:26:37、2026-09-07 09:09:51（北京时间）。记录没有说明是否重置了周额度、5 小时额度或两者，不能直接认定每个事件都是新的周窗口起点。
- 若周窗口在日内重置，当日用量跨越前后窗口。日合计无法唯一拆成前后两段；按时间占比分摊仅是估算。
- 本次两次 `/wham/usage` 的周窗口 `reset_at` 分别为 1789810353 和 1789810458，相差 105 秒；两次均 `used_percent=0`、`reset_after_seconds=604800`。当前空闲状态下该字段不是可靠的固定历史锚点。不能据此断言历史周窗口采用哪种算法。
- 原代码在 `normalizeLimitWindow` 将 `reset_at - limit_window_seconds` 截断为 UTC 日期；服务层又以该日期的本地午夜筛选日行，丢失时分秒和一致时区。所谓“本周期 Credits/Tokens”也不能保证按真实窗口精确统计。
- 原代码仅把日行分为当前周期和全部历史，未保存独立的窗口账本；原快照还受数量上限截断。

## 建议实现范围

1. 增加历史区间选择和服务端日/周/月汇总，保留单位、查询范围、作用域、获取时间和数据完整性说明。
2. 接入 `daily-token-usage-breakdown`，直接呈现官方历史百分比；与 Credits、Tokens 分开标单位，不与当前剩余百分比混算。
3. 加入重置事件时间轴；只把它当作重置事实，受影响的窗口类型在响应缺失时标记未知。
4. 对真实额度窗口，展示已经观测到的起止和最后观测比例；没有重置前终值时写“最后观测值”，不能写“最终用量”。从现在开始采集也不能保证精确补齐离线、关浏览器或采样间隙。
5. 对无历史边界的数据，允许查看明确标记的日期周汇总或估算区间，但不命名为精确额度窗口。不要通过当前 `reset_at` 无限倒推。
6. 单独按账户、限额类型和稳定窗口身份保存长期记录，避免短时刷新挤掉较老窗口；空闲浮动 `reset_at` 不应每次生成新窗口。

精确模式仍需额外数据源：可信历史窗口边界，加上边界时点的计数或带精确时间戳的消耗事件，以及明确的计量和账户作用域。
