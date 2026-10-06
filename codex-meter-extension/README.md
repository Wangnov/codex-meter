# Codex Meter 0.2.21 — maintained fork

This directory is the unpacked Chrome MV3 extension. Load it directly in `chrome://extensions`; no build step is required.

See the [repository README](../README.md) for complete installation, usage, privacy, backup and limitation notes.

## Current behavior

- Canonical page: `https://chatgpt.com/settings/usage?tab=analytics`.
- One independent fixed text button opens the analysis dialog from local cache.
- Explicit Refresh is the only usage API collection trigger.
- No official chart replacement, tooltip enhancements or chart DOM/resize observers.
- Toolbar popup links to the extension-local quota baseline history page.
- MV3 background worker archives capture-time baseline samples in extension-origin IndexedDB; it does not poll usage APIs.
- Ordinary snapshot save failures do not discard fresh data. Existing history is not automatically deleted.

The inferred quota baseline is not necessarily the actual historical weekly plan limit. Browser storage is local and finite; export archives regularly.

## Offline checks

From repository root:

```sh
npm ci --prefix tests
node --test tests/*.test.cjs
```

Tests do not use a real ChatGPT account. Browser acceptance is performed separately by the user.
