# Long-term quota baseline archive

Entry: toolbar popup → 额度基准历史（长期归档） → extension-local history.html.

Manual refresh archives a report before normal snapshot persistence. Existing snapshots and latest cache are imported when refreshing or opening history. No new official API requests are introduced.

Archive uses extension-origin IndexedDB (via MV3 service worker for content-script reports), independent of the 10MB chrome.storage.local snapshot quota. It has no automatic eviction or TTL. Browser storage remains finite: uninstalling/clearing extension data loses archives, and write failures are explicitly reported. Export JSON periodically.

Each immutable record is keyed by account scope + capture timestamp, retains daily date/Credits/percent/baseline samples, and summarizes positive finite inferred baselines with median/min/max/count. Unknown/missing percentages are not zero. All-account change comparisons stay account-scoped. Accountless legacy snapshots are labeled unknown and cannot be reliably attributed.

The inferred baseline is not asserted to be the historical or current official weekly limit. Upstream historical percentages may be renormalized. Archived snapshots are evidence of values observed at capture time. Old snapshots already evicted or overwritten before installation cannot be recovered.

Offline checks: node --test tests/*.test.cjs (14 passing). Real-browser acceptance intentionally left to user. No authenticated browser tests or additional usage API traffic.
