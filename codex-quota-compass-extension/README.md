# Codex Meter

Local Chrome extension for the ChatGPT Codex analytics page.

## What It Does

- Adds a `Codex Meter` button to the right side of the usage details area on `https://chatgpt.com/codex/cloud/settings/analytics`.
- Opens a native-feeling Codex modal for credits, token totals, cache hit rate, and estimated value.
- Keeps the modal at a stable size with a skeleton loading state while data is being fetched.
- Uses Codex page CSS variables so the modal follows the current light or dark theme where those variables are available.
- Follows the Codex page locale from `client-bootstrap.locale` / `html[lang]` using official-style locale IDs. Included UI copy: `zh-CN`, `zh-TW`, `zh-HK`, `en-US`, `ja-JP`, `fr-FR`, `ru-RU`, `es-ES`, and `de-DE`, with English fallback.
- Reads the same private `wham` analytics endpoints used by the page.
- Shows current-cycle credits, total tokens, input tokens, cache hit rate, estimated USD value, and daily usage rows.
- Saves compact local snapshots in `chrome.storage.local`.
- Exports the latest page-level data as JSON or CSV.
- Uses local inline Lucide-style SVG icons; no remote icon script is loaded.

The extension does not store the ChatGPT Web bearer token. It extracts the token from the current page only when refreshing data.

## Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

```text
/Users/wangnov/Documents/Codex/2026-05-16/userscript-name-codex-quota-compass-visual/codex-quota-compass-extension
```

## Use

1. Open <https://chatgpt.com/codex/cloud/settings/analytics>.
2. Click the `Codex Meter` button beside the usage details area.
3. Use the modal or extension popup for refresh, local snapshots, CSV, and JSON export.

## Notes

- See `ARCHITECTURE.md` for the buildless DDD-style layer split.
- This depends on private ChatGPT Web endpoints and may need updates if OpenAI changes the page internals.
- This is intentionally local-only. Keep it unpacked unless you want to maintain extension packaging and review.
- The button uses page structure first, then localized text, then a fixed-position fallback. If it still does not appear, refresh the analytics tab after loading the extension.
