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
