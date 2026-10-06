# Codex Meter — 社区维护版

适配 ChatGPT 新版 **使用情况 → 分析** 页的本地 Chrome 扩展。查看 Credits、Tokens、每日消耗百分比，并长期记录各次快照隐含的额度换算基准。

- 维护 fork：<https://github.com/mouzhi/codex-meter>
- 原项目：<https://github.com/Wangnov/codex-meter>
- 维护分支：`maintenance/settings-usage`
- 扩展版本：`0.2.21`，Manifest V3，无需构建
- 页面入口：<https://chatgpt.com/settings/usage?tab=analytics>
- 协议：[MIT](LICENSE)；保留原项目版权声明。本项目不是 OpenAI 官方产品。

## 为什么继续维护

官方已将原来的 Codex analytics 页面迁移到统一的使用情况页面，旧版依赖标题、图例和官方组件布局的注入方式不再可靠。本 fork 保留用量分析窗口，移除了官方图表替换、图表指标切换、提示框增强及 DOM/尺寸监听，避免页面重绘与插件挂载互相触发。

**当前版本不尝试接管官方组件。** 只在分析页右下角放一个独立的纯文字 `Codex Meter` 按钮。点击打开窗口；打开时只读缓存，只有用户主动点击刷新才读取接口。旧截图和商店素材仍在仓库中，仅用于保留上游资源，不代表本版本 UI。

## 安装与升级

```bash
git clone --branch maintenance/settings-usage https://github.com/mouzhi/codex-meter.git
cd codex-meter
```

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启开发者模式，选择“加载已解压的扩展程序”。
3. 选择 `codex-meter-extension` 目录，而不是仓库根目录。
4. 若同时装有商店版或其他 Codex Meter，请停用旧版，避免同一页面运行多个实例。

升级已有本地版本：

```bash
git pull --ff-only
```

随后在扩展管理页点击“重新加载”，并刷新已经打开的 ChatGPT 标签页。**只重新加载扩展不能替换旧标签页里已运行的脚本。** 不需要卸载重装；卸载可能删除本地历史。

## 使用方法

1. 登录 ChatGPT 并打开 <https://chatgpt.com/settings/usage?tab=analytics>。
2. 点击页面右下角的 `Codex Meter` 按钮。
3. 窗口先显示本地旧快照，提示不会自动更新。点击一次“刷新”获取当前数据。
4. 查看用量摘要、每日额度折算、本周期/历史日明细，或导出 JSON/CSV。
5. 点击 Chrome 工具栏的扩展图标，可打开页面/面板、手动刷新、导出普通快照及清空普通历史。
6. 在扩展弹窗中点击 **“额度基准历史（长期归档）”**，打开独立的本地历史页面。

离开分析页后，入口按钮移除，分析窗口关闭。旧版 `/codex/cloud/settings/analytics` 地址仍被识别。插件不会定时采集，也不会因图表、日期控件或页面重绘自动调用接口。URL 检查定时器仅用于显示/隐藏独立入口，不读取接口。

## 每日额度折算

最近 45 天按接口日数据展示：

- 日期（UTC 日期键）
- 每日 Credits
- 每日消耗百分比
- 反算 100% 对应 Credits
- 推测周期及重置标记

计算使用接口未舍入值：

```text
反算基准 = 当日 Credits × 100 ÷ 当日消耗百分比
```

缺失、单位不匹配、零分母时显示未知；不会伪造为零或截断超过 100% 的值。支持按当前账号保存人工全局重置时间（Unix 秒/毫秒或带时区 ISO 时间），这些记录只在本机用于标注，不向官方提交重置操作。

### 重要：基准不等于历史真实周额度

对照不同采集时刻的同一用量日，观察到 Credits 不变，而百分比随快照整体变化。这说明服务端可能重新归一化历史百分比。不能将反算结果直接解释为历史当天的真实套餐上限，也不能仅据此断言额度被下调。

周期标记仍是估算：日内跨周期无法拆分；累计百分比达到 100% 的推测可能因官方口径变化而产生错误边界；手动重置接口也不一定说明具体重置了哪种窗口。**不要把这些标记当作官方窗口账本。** 详细限制见 [每日额度折算说明](docs/daily-quota-history.md)。

## 长期额度基准历史

每次手动刷新获取成功，先将精简记录写入独立的长期归档，再尝试保存普通快照。历史页也会导入仍存在的最新缓存和历史快照；已经被淘汰或覆盖的数据无法恢复。

每份归档保留：

- 账号作用域和采集时间，按两者去重，已有归档不覆盖。
- 每个有效用量日的 Credits、百分比及反算基准。
- 有效日基准的中位数、最小值、最大值、样本天数和日期范围。
- 相比同账号上一份有效快照的基准变化百分比。

历史页面支持按账号筛选和导出全部归档 JSON。未知账号的旧缓存单独归为 `unknown`，不能可靠地追溯所属账号。百分比无效的快照保留为未知基准，而非 0。

### 本地保存与备份

| 数据 | 保存位置 | 生命周期 |
| --- | --- | --- |
| 最新数据、普通历史快照 | `chrome.storage.local` | 普通快照最多 180 条，受容量限制 |
| 人工全局重置记录 | `chrome.storage.local`，按账号隔离 | 清空普通快照不会删除 |
| 长期额度基准归档 | 扩展来源的 IndexedDB | 无自动过期或淘汰；清空普通快照不会删除 |

长期归档不与普通快照争用 `storage.local` 的容量，但仍受浏览器/磁盘存储条件限制，**不是无限存储或云备份**。卸载扩展、清除扩展数据、换浏览器配置文件可能丢失全部数据。建议定期导出长期归档 JSON，文件可能包含账号标识和用量数据，请谨慎分享。当前提供导出，不提供归档文件导入 UI。

## 请求、隐私和已知问题

- 数据只保存在本机；不向维护者服务器上传，没有第三方遥测。
- 不保存或导出 ChatGPT bearer token；刷新时使用当前页面已有鉴权，请求 ChatGPT 同源私有 `wham` 接口。
- 一次主动刷新会读取多个接口（当前用量、每日计数、历史百分比、重置历史），不是只有一个 HTTP 请求。没有自动重试循环；刷新进行中会阻止再次启动同页面刷新。
- 私有接口、单位、字段、账号作用域和可查询范围均可能变动；可选历史接口失败时显示缺失提示。
- **普通快照存储容量超限**：仍显示本次成功读取的最新数据，并提示未能保存；不会自动清空旧历史。长期归档会独立尝试保存。未保存的数据在页面刷新后可能回退到旧缓存。
- 推算周额度、美元价值和周期内统计是估算，不是账单、精确历史窗口或官方承诺。原美元换算系数为 40 美元/1000 Credits。
- 当前新历史页和简化 UI 以中文为主，旧面板保留原有多语言文案。
- 维护版的真实 Chrome 验收由用户完成；离线测试不能代替对安装权限、官方接口和实际页面的验收。

## 开发与离线测试

扩展保持 buildless；测试依赖只安装在 `tests/`，无需将 `node_modules` 放入扩展或发布包。

```bash
npm ci --prefix tests
node --test tests/*.test.cjs

# 所有扩展脚本的语法检查
find codex-meter-extension -name '*.js' -print0 | xargs -0 -n1 node --check
node -e "JSON.parse(require('fs').readFileSync('codex-meter-extension/manifest.json','utf8'))"
git diff --check
```

本次版本 14 项离线测试通过，覆盖：新旧路由与排除条件、有缓存时按钮打开窗口且零自动请求、不修改官方主体 DOM、存储超限后仍显示新数据、账号隔离、缺失值/日期/重置处理，以及长期归档的去重和同一用量日不同采集基准保留。归档测试使用模拟 IndexedDB，不访问真实账号。

主要模块：

- `content.js`：独立入口按钮及用量窗口；不集成官方图表。
- `application/report-service.js`：用户主动刷新、归档、普通快照保存。
- `domain/usage-domain.js`、`quota-history.js`、`quota-snapshot.js`：纯数据计算。
- `infrastructure/chatgpt-client.js`：同源只读接口。
- `infrastructure/report-repository.js`：普通快照与归档消息入口。
- `background.js`、`infrastructure/quota-archive.js`：MV3 扩展来源 IndexedDB 归档。
- `history.html/js/css`：仅使用本地数据的长期历史页。

进一步阅读：[简化适配说明](docs/settings-usage-maintenance.md)、[长期归档设计](docs/quota-baseline-archive.md)、[历史窗口调查](docs/history-window-investigation.md)、[架构](codex-meter-extension/ARCHITECTURE.md)。

## English summary

This community fork adapts Codex Meter to `https://chatgpt.com/settings/usage?tab=analytics`. It removes integration with official charts and keeps a standalone page button and usage dialog. Opening the dialog reads local cache only; authenticated API calls occur exclusively on explicit refresh actions.

An extension-local quota baseline history page archives capture-time inferred baselines in IndexedDB. Existing cached snapshots are imported when available. It preserves different observations of the same usage day, supports account filtering and JSON export, and has no automatic retention cap. The inferred baseline is **not guaranteed to be the actual historical weekly plan limit**: upstream percentages may be renormalized.

Load `codex-meter-extension/` as an unpacked Chrome extension, reload it after updates, and refresh existing ChatGPT tabs. Avoid running multiple versions simultaneously. All data remains local; uninstalling or clearing browser data may erase archives. Back up exports regularly. Offline tests pass; real-browser acceptance remains user-led.
