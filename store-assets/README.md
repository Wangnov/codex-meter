# Codex Meter Store Assets

Chrome Web Store materials prepared for Codex Meter.

## Upload Files

- Store icon: `images/store-icon-128.png`
- Standalone 128x128 logo: `images/logo-128.png`
- Screenshots:
  - `images/screenshot-1-analytics-button.jpg`
  - `images/screenshot-2-quota-modal.jpg`
  - `images/screenshot-3-meter-chart.jpg`
  - `images/screenshot-4-history-export.jpg`
- Small promotional tile: `images/small-promo-440x280.jpg`
- Marquee promotional tile: `images/marquee-promo-1400x560.jpg`

## Requirements Covered

- Screenshots: 4 images, each 1280x800, JPEG, no alpha channel.
- Small promotional tile: 440x280, JPEG, no alpha channel.
- Marquee promotional tile: 1400x560, JPEG, no alpha channel.
- Store icon and standalone logo: 128x128 PNG, no alpha channel.

## Source Images

The promotional tiles are generated from local source copies. The store icon is generated from the project logo in `../assets/logo.png`.

- `source/source-marquee.png`
- `source/source-small-promo.png`

## Regenerate

Run from the repo root:

```bash
./store-assets/scripts/generate-store-assets.sh
```
