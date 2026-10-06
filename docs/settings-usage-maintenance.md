# Simplified usage-page maintenance

Local branch: `maintenance/settings-usage`. No remote fork/push performed. Pre-existing quota-history changes preserved.

## Current behavior

- New entry URL: `https://chatgpt.com/settings/usage?tab=analytics`; legacy analytics URL also supported.
- One independent fixed text button in the bottom-right corner, outside official components.
- Clicking the button opens the existing Codex Meter dialog using local cached data only.
- Only explicit Refresh actions request usage endpoints. Opening the toolbar popup or dialog does not fetch usage.
- Removed official chart replacement, chart switches, metric menus, tooltip enhancements, DOM observers, ResizeObservers, and chart event listeners.
- A lightweight URL-only timer checks route changes. Unchanged URL causes no DOM writes or network requests.
- Leaving analytics removes the button and closes the dialog.
- Toolbar popup retains Open Page, Open Panel, Refresh, export and local-history actions. Removed obsolete chart/display settings.

## Offline verification

```sh
npm ci --prefix tests
node --test tests/*.test.cjs
```

11 tests pass. Panel-only test asserts zero network/refresh calls on initialization, repeated URL checks and opening the dialog; official main DOM remains unchanged. Route exclusions and quota-history tests pass. No browser testing performed for this simplified version, per user request.

## Known outstanding issue

Previously observed `Resource::kQuotaBytes quota exceeded` when persisting usage snapshots. No history has been cleared automatically. Storage capacity handling remains separate work.
