# Codex Meter Architecture

This extension is intentionally buildless, so each layer is loaded as a classic MV3 script in manifest order.

## Layers

- `domain/usage-domain.js`
  - Pure usage rules: token totals, input totals, cache ratio, limit-window normalization, cycle stats, compact report shape, and numeric formatting.
  - Does not read DOM, call Chrome APIs, or fetch network data.

- `application/report-service.js`
  - The report refresh use case.
  - Coordinates the ChatGPT client, domain calculations, and report repository.
  - Owns the workflow, not the rendering.

- `infrastructure/chatgpt-client.js`
  - Reads ChatGPT bootstrap data from the current page.
  - Calls private `wham` endpoints with the page bearer token.

- `infrastructure/report-repository.js`
  - Persists compact snapshots in `chrome.storage.local`.
  - Hides Chrome storage details from the application and presentation code.

- `shared/config.js`
  - Shared configuration, DOM ids, route constants, and route checks.

- `content.js`
  - Content-page composition root and Codex-page presentation.
  - Owns locale copy, button placement, modal rendering, exports, and route observer wiring.

- `popup.js`
  - Extension popup composition and presentation.
  - Reads snapshots through the repository instead of talking to storage directly.

## Dependency Direction

```text
presentation -> application -> domain
presentation -> infrastructure
application -> infrastructure
infrastructure -> domain only when storing compact report shapes
domain -> no project layer
```

No domain code depends on Chrome, fetch, DOM, or Codex page structure. That keeps the quota math portable if this later becomes a CLI, background worker, or protocol-based collector.
