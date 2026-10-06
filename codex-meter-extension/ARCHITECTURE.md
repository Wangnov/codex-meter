# Codex Meter Architecture

This extension is intentionally buildless, so each layer is loaded as a classic MV3 script in manifest order.

## Layers

- `domain/usage-domain.js`
  - Pure usage rules: token totals, input totals, cache ratio, limit-window normalization, cycle stats, compact report shape, and numeric formatting.
  - Builds chart series and full-data summaries from flat daily client/model records. Keeps unclassified residuals separate and reports grouped totals that exceed reported totals.
  - Does not read DOM, call Chrome APIs, or fetch network data.

- `application/report-service.js`
  - The report refresh use case.
  - Coordinates the ChatGPT client, domain calculations, and report repository.
  - Owns the workflow, not the rendering.

- `infrastructure/chatgpt-client.js`
  - Reads ChatGPT bootstrap data from the current page.
  - Calls private `wham` endpoints with the page bearer token.

- `infrastructure/usage-page.js`
  - Adapts the current ChatGPT Usage history DOM, date ranges, and period navigation into stable page-level operations.
  - Reconstructs the full period from the official slider's 1-based index when its accessible value contains a selected single day.
  - Keeps current page selectors and labels out of the report workflow and rendering logic.

- `infrastructure/report-repository.js`
  - Persists compact snapshots in `chrome.storage.local`.
  - Hides Chrome storage details from the application and presentation code.

- `shared/config.js`
  - Shared configuration, DOM ids, route constants, and route checks.

- `content.js`
  - Content-page composition root and ChatGPT usage-page presentation.
  - Owns locale copy, button placement, modal rendering, exports, and route observer wiring.
  - Owns chart dimensions, series visibility, pointer and keyboard date selection, and period/day legend presentation.
  - Keeps chart nodes stable across interactions and transitions rendered geometry and visibility using the official motion timing, with immediate final states when reduced motion is enabled.

- `popup.js`
  - Extension popup composition and presentation.
  - Reads snapshots through the repository instead of talking to storage directly.
  - Mirrors the active ChatGPT tab's current theme variables, with the system theme as the fallback elsewhere.

## Dependency Direction

```text
presentation -> application -> domain
presentation -> infrastructure
application -> infrastructure
infrastructure -> domain only when storing compact report shapes
domain -> no project layer
```

No domain code depends on Chrome, fetch, DOM, or ChatGPT Usage history page structure. That keeps the quota math portable if this later becomes a CLI, background worker, or protocol-based collector.

## Page and Data Contracts

- The supported route is exactly `https://chatgpt.com/settings/usage?tab=analytics`; unrelated query parameters are allowed, but the origin, path, and `tab=analytics` value must match.
- The current Usage history page combines Work, Codex, and other usage. `usage-page.js` owns that page structure while `content.js` consumes the adapter.
- `/backend-api/wham/usage` supplies plan limit windows. `/backend-api/wham/analytics/daily-workspace-usage-counts` supplies absolute Credits, turns, and Token fields. Requests cover the latest 45 days by default; navigating further back extends `start_date` to the beginning of the current visible range, while `end_date` remains an exclusive upper bound.
- `/backend-api/wham/usage/daily-token-usage-breakdown?units=percent` supplies percentage breakdowns only and must not replace the absolute Token series.
- Daily `clients` supply absolute Tokens, Credits, and turns; daily `models` supply turns and a Credits field that may be zero for the entire account range. Model grouping is unavailable for Tokens, and model credit grouping requires nonzero details in the visible range. Hiding a series does not alter the full-data share denominator.
