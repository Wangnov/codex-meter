<p align="center">
  <img src="./store-assets/images/marquee-promo-1400x560.jpg" alt="Codex Meter">
</p>

<p align="center">
  <img src="./assets/logo.png" width="160" alt="Codex Meter logo">
</p>

<h1 align="center">Codex Meter</h1>

<p align="center">
  Local Codex quota, Credits, and token analytics inside ChatGPT.
</p>

<p align="center">
  <a href="https://github.com/Wangnov/codex-meter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea44f" alt="MIT license"></a>
  <a href="https://github.com/Wangnov/codex-meter"><img src="https://img.shields.io/badge/Chrome-MV3-4285f4?logo=googlechrome&logoColor=white" alt="Chrome MV3"></a>
  <a href="https://chatgpt.com/codex/cloud/settings/analytics"><img src="https://img.shields.io/badge/Codex-analytics-111111" alt="Codex analytics"></a>
</p>

<p align="center">
  <a href="#readme-cn">中文</a> · <a href="#readme-en">English</a>
</p>

## Screenshots / 截图

<p align="center">
  <img src="./store-assets/images/screenshot-1-analytics-button.jpg" width="49%" alt="Codex Meter button on the Codex analytics page">
  <img src="./store-assets/images/screenshot-2-quota-modal.jpg" width="49%" alt="Codex Meter quota modal">
</p>

<p align="center">
  <img src="./store-assets/images/screenshot-3-meter-chart.jpg" width="49%" alt="Codex Meter metric chart">
  <img src="./store-assets/images/screenshot-4-history-export.jpg" width="49%" alt="Codex Meter history and export controls">
</p>

---

<a id="readme-cn"></a>

# 中文

`Codex Meter` 是一个本地 Chrome 扩展，用来增强 ChatGPT Codex 的分析页面。它会在 Codex analytics 页面里的「使用详情」旁边加入入口按钮和图表控制器，并用贴近 Codex 官方界面的页面内弹窗展示本周期 Credits、Tokens、缓存命中率、推算周额度、折算金额和每日明细。浏览器扩展弹窗只作为管理面板，用来控制页面内按钮、图表入口、默认图表模式和本地快照。

它不需要额外登录，也不会保存 ChatGPT Web token。刷新数据时，它只在当前页面内读取 ChatGPT 页面已经持有的鉴权信息，并请求同一组 Codex Web analytics 接口。

## 适合谁用

- 你经常使用 Codex，并想更清楚地看 Credits 和 Tokens 消耗
- 你希望把每日用量、周期内合计、历史区间放在一个更直观的弹窗里看
- 你希望工具尽量贴近 Codex 官方 UI，而不是额外开一个陌生 dashboard
- 你接受这是一个依赖 ChatGPT Web 私有接口的本地增强工具

## 功能

- 在 `https://chatgpt.com/codex/cloud/settings/analytics` 的「使用详情」右侧加入 `Codex Meter` 按钮
- 在官方「按来源」图表旁加入 `Meter` 图表视图，支持 Credits、总 Tokens、折算金额、轮数等指标
- 浏览器扩展弹窗提供页面内按钮、图表控制和默认图表模式管理
- Meter 图表跟随页面顶部的 7 天 / 1 个月 / 自定义范围，以及天 / 周分组方式
- 总 Tokens 图表按未缓存输入、缓存输入、输出 Tokens 分层展示
- 使用 Codex 页面 CSS 变量，跟随浅色 / 深色主题
- 按页面 locale 自动切换文案，内置 `zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`ja-JP`、`fr-FR`、`ru-RU`、`es-ES`、`de-DE`
- 统计本周期 Credits、总 Tokens、输入 Tokens、缓存命中率、推算周额度和折算金额
- 展示本周期每日明细和周期外历史明细
- 支持 JSON / CSV 导出
- 用 `chrome.storage.local` 保存紧凑的本地快照
- 使用本地内联 SVG 图标，不加载远程脚本

## 安装

```bash
git clone https://github.com/Wangnov/codex-meter.git
```

然后在 Chrome 里：

1. 打开 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`
4. 选择 clone 下来的扩展目录：

```text
codex-meter/codex-meter-extension
```

## 使用

1. 打开 <https://chatgpt.com/codex/cloud/settings/analytics>
2. 点击「使用详情」右侧的 `Codex Meter`
3. 在页面内弹窗里刷新、查看明细，或导出 JSON / CSV；在浏览器扩展弹窗里管理显示开关和本地快照

## 隐私和限制

- 扩展不会保存 ChatGPT Web bearer token
- 用量快照只保存在本机 Chrome 的 `storage.local`
- 这个项目依赖 ChatGPT Web 的私有 `wham` analytics 接口；如果 OpenAI 调整页面结构或接口字段，扩展可能需要适配
- 本项目不是 OpenAI 官方项目，也不与 OpenAI 存在隶属关系

## 开发

这个扩展是 buildless 的 MV3 项目，核心目录在 `codex-meter-extension/`。

```bash
# JS 语法检查
find codex-meter-extension -name '*.js' -maxdepth 3 -print0 | xargs -0 -n1 node --check

# manifest 检查
node -e "JSON.parse(require('fs').readFileSync('codex-meter-extension/manifest.json','utf8'))"

# 本地打包
rm -f codex-meter-extension.zip
(cd codex-meter-extension && zip -r ../codex-meter-extension.zip .)
unzip -t codex-meter-extension.zip
```

发布到 Chrome Web Store 的 GitHub Actions 工作流会在两种情况下运行：

- 手动触发 `Publish Chrome Web Store`
- 发布非 prerelease 的 `v*` GitHub Release

自动发布会校验 release tag 是否匹配 `manifest.json` 版本号，并在上传前检查商店中没有待审核版本。

---

<a id="readme-en"></a>

# English

`Codex Meter` is a local Chrome extension for the ChatGPT Codex analytics page. It adds an entry button and chart controls beside the usage details section, plus a Codex-native-feeling in-page modal for cycle Credits, Tokens, cache hit rate, projected weekly Credits, estimated value, and daily usage rows. The browser extension popup is a control panel for the in-page button, chart controls, default chart mode, and local snapshots.

It does not require another login and does not store your ChatGPT Web token. When you refresh data, it reads the authentication already available on the current ChatGPT page and calls the same Codex Web analytics endpoints.

## Who this is for

- You use Codex often and want a clearer view of Credits and token usage
- You want daily usage, cycle totals, and historical rows in one quick modal
- You prefer an enhancement that feels like part of Codex instead of a separate dashboard
- You are comfortable with a local tool that depends on private ChatGPT Web endpoints

## Features

- Adds a `Codex Meter` button beside Usage details on `https://chatgpt.com/codex/cloud/settings/analytics`
- Adds a `Meter` chart view beside the official source chart, with Credits, total Tokens, estimated USD value, and turns
- Provides an extension popup for managing in-page visibility, chart controls, and default chart mode
- Follows the page-level 7 days / 1 month / custom range and day / week grouping controls
- Shows total Tokens as uncached input, cached input, and output token layers
- Uses Codex page CSS variables and follows light / dark theme where available
- Follows the page locale, with copy for `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`, `fr-FR`, `ru-RU`, `es-ES`, and `de-DE`
- Shows cycle Credits, total Tokens, input Tokens, cache hit rate, projected weekly Credits, and estimated USD value
- Shows current-cycle daily rows and out-of-cycle history rows
- Exports JSON and CSV
- Stores compact local snapshots in `chrome.storage.local`
- Uses local inline SVG icons; no remote icon script is loaded

## Install

```bash
git clone https://github.com/Wangnov/codex-meter.git
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the cloned extension directory:

```text
codex-meter/codex-meter-extension
```

## Use

1. Open <https://chatgpt.com/codex/cloud/settings/analytics>
2. Click `Codex Meter` beside Usage details
3. Refresh, review daily rows, or export JSON / CSV from the in-page modal; use the extension popup to manage display settings and local snapshots

## Privacy and Limits

- The extension does not store the ChatGPT Web bearer token
- Usage snapshots stay in local Chrome `storage.local`
- This depends on private ChatGPT Web `wham` analytics endpoints; if OpenAI changes the page or fields, the extension may need adjustments
- This project is not an official OpenAI project and is not affiliated with OpenAI

## Development

This is a buildless MV3 extension. The extension root is `codex-meter-extension/`.

```bash
# JS syntax checks
find codex-meter-extension -name '*.js' -maxdepth 3 -print0 | xargs -0 -n1 node --check

# manifest check
node -e "JSON.parse(require('fs').readFileSync('codex-meter-extension/manifest.json','utf8'))"

# local package
rm -f codex-meter-extension.zip
(cd codex-meter-extension && zip -r ../codex-meter-extension.zip .)
unzip -t codex-meter-extension.zip
```

The Chrome Web Store GitHub Actions workflow runs in two cases:

- Manual `Publish Chrome Web Store` dispatch
- Published non-prerelease `v*` GitHub Releases

The release-triggered publish checks that the release tag matches the `manifest.json` version and that there is no pending Chrome Web Store submission before uploading.
