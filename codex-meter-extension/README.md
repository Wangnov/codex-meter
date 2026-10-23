# Codex Meter

Local Chrome extension for the usage analytics page in ChatGPT settings.

## What It Does

- Adds a `Codex Meter` button beside Usage history on `https://chatgpt.com/settings/usage?tab=analytics`.
- Opens an in-page modal styled with the current ChatGPT theme for Credits, token totals, cache hit rate, and estimated value.
- Uses the browser extension popup as a management panel for the in-page button, chart controls, default chart mode, and local snapshots.
- Makes the extension popup follow the active ChatGPT tab's current theme, with the system theme as the fallback on other pages.
- Keeps the modal at a stable size with a skeleton loading state while data is being fetched.
- Uses the current ChatGPT settings surface, text, and border color tokens so the modal follows the light or dark theme.
- Matches the official Usage history chart dimensions, legend typography, colors, and controls, with smooth transitions and reduced motion support.
- Follows the ChatGPT page locale from `client-bootstrap.locale` / `html[lang]` using official-style locale IDs. Included UI copy: `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`, `fr-FR`, `ru-RU`, `es-ES`, and `de-DE`, with English fallback.
- Reads the private same-origin `wham` usage endpoints available to the page.
- Shows current-cycle credits, total tokens, input tokens, cache hit rate, estimated USD value, and daily usage rows in the page modal.
- Separately shows ordinary Codex and Spark 5-hour/weekly quota windows without mixing their percentages.
- Reads the optional per-model token breakdown endpoint and shows uncached input, cached input, output, and a non-billing credit-equivalent estimate. Models with separate limits such as Spark are excluded from the general weekly estimate.
- Hides model-weighted cards and the model table when plans such as Pro do not expose a workspace model breakdown.
- Notes that quota percentages are near real time while model token and Credits details may lag, making projections approximate.
- Saves compact local snapshots in `chrome.storage.local`.
- Exports the latest page-level data as JSON or CSV.
- Uses local inline Lucide-style SVG icons; no remote icon script is loaded.

The extension does not store the ChatGPT Web bearer token. It extracts the token from the current page only when refreshing data.

The current Usage history page combines Work, Codex, and other usage. Meter uses `/usage` for limit windows and `/analytics/daily-workspace-usage-counts` for absolute Credits, turns, and Token fields. It requests the latest 45 days by default, extends `start_date` to the beginning of the currently displayed range when the user navigates further back, and always treats `end_date` as an exclusive upper bound; the returned range depends on available account history. `/usage/daily-token-usage-breakdown?units=percent` is percentage-only data and does not replace Meter's absolute Token series.

## Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the cloned extension folder:

```text
codex-meter/codex-meter-extension
```

## Use

1. Open <https://chatgpt.com/settings/usage?tab=analytics>.
2. Click the `Codex Meter` button beside Usage history.
3. Use the page modal for usage details and export; use the extension popup to manage display settings and local snapshots.

## Notes

- See `ARCHITECTURE.md` for the buildless DDD-style layer split.
- Licensed under the MIT License.
- This depends on private ChatGPT Web endpoints and may need updates if OpenAI changes the page internals.
- This is intentionally local-only. Keep it unpacked unless you want to maintain extension packaging and review.
- The button targets the Usage history section of the current ChatGPT settings page. If it does not appear after loading the extension, refresh that tab once.

### 模型 Token 明细与标准速度估值

当账号提供可选的 workspace 模型明细时，面板展示未缓存输入、缓存输入、输出、缓存命中率和模型汇总；接口不可用时保留原有图表与报表。普通 Codex 周/短周期和 Spark 单独显示。

等值 Credits 采用 [2026-10-23 官方标准速度费率](https://learn.chatgpt.com/docs/pricing)，未知模型显示未定价；它不包含 Fast/Ultrafast 倍率，也不代表实际账单或套餐内额度，因此不会用模型估值反推套餐周容量。原始逐日模型明细不写入快照，只保存汇总。
