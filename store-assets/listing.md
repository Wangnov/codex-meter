# Codex Meter Chrome Web Store Listing

## Extension Name

Codex Meter

## Short Description

Track Codex Credits, token usage, weekly quota estimates, and daily analytics inside ChatGPT Codex.

## Detailed Description

Codex Meter is a local Chrome extension for the ChatGPT Codex analytics page. It adds a native-feeling Meter button beside the Usage details section, opens a clean in-page modal for Codex Credits, Tokens, cache hit rate, estimated value, and daily usage rows, and uses the browser extension popup as a compact control panel.

The extension is designed to feel like part of Codex. It follows the page theme, uses local inline icons, and supports multiple page locales including Simplified Chinese, Traditional Chinese, English, Japanese, French, Russian, Spanish, and German.

Core features:

- View current-cycle Credits and token usage in one focused panel.
- Estimate weekly Credits and estimated USD value from the official quota percentage.
- Compare daily usage with history outside the current quota cycle.
- Switch the analytics chart between the official source view and Codex Meter metrics.
- Inspect Credits, total Tokens, estimated value, and turns in a Codex-style chart.
- Manage the in-page button, chart controls, default chart mode, and local snapshots from the extension popup.
- Export the latest data as CSV or JSON.
- Keep compact snapshots locally in Chrome storage.

Privacy:

Codex Meter does not store your ChatGPT Web bearer token. When you refresh data, it reads the authentication already available on the current ChatGPT page and calls the same Codex Web analytics endpoints from that page context. Usage snapshots are stored locally in `chrome.storage.local`.

Notes:

This project is not an official OpenAI project and is not affiliated with OpenAI. It depends on private ChatGPT Web analytics endpoints and may need updates if the Codex analytics page changes.

## Chinese Description

Codex Meter 是一个本地 Chrome 扩展，用来增强 ChatGPT Codex 的分析页面。它会在「使用详情」旁边加入一个贴近 Codex 官方风格的 Meter 按钮，打开页面内弹窗后展示本周期 Credits、Tokens、缓存命中率、推算周额度、估算金额和每日明细；浏览器扩展弹窗则作为紧凑管理面板。

主要功能：

- 在 Codex analytics 页面内查看本周期 Credits 和 Tokens。
- 根据官方限额百分比反推每周 Credits 和估算价值。
- 查看本周期每日用量与周期外历史记录。
- 在官方「按来源」图表和 Codex Meter 指标图表之间切换。
- 按 Credits、总 Tokens、折算金额、轮数等指标查看图表。
- 在浏览器扩展弹窗里管理页面内按钮、图表控制、默认图表模式和本地快照。
- 导出 CSV / JSON。
- 用本地 `chrome.storage.local` 保存紧凑快照。

隐私说明：

Codex Meter 不会保存 ChatGPT Web bearer token。刷新数据时，它只读取当前 ChatGPT 页面已经持有的鉴权信息，并从页面上下文请求 Codex Web analytics 接口。用量快照只保存在本机 Chrome。

本项目不是 OpenAI 官方项目，也不与 OpenAI 存在隶属关系。它依赖 ChatGPT Web 私有 analytics 接口；如果 Codex 页面或接口发生变化，扩展可能需要适配。

## Category

Productivity

## Language

English, Chinese

## Keywords

Codex, ChatGPT, OpenAI, Credits, Tokens, analytics, quota, developer tools

## Permission Justification

`storage`: saves compact local usage snapshots and UI preferences.

`tabs`: opens or focuses the Codex analytics page from the extension popup.

`scripting`: injects the content script on the Codex analytics page for the in-page button, modal, and chart controls.

Host permission `https://chatgpt.com/*`: required to run only on ChatGPT pages and call the Codex analytics endpoints from the signed-in page context.

## Data Usage Disclosure

Codex Meter does not collect, sell, or transmit user data to third-party servers. Usage data remains local in the browser unless the user exports CSV or JSON manually.
