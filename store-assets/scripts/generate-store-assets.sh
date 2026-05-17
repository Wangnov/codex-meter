#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HTML_FILE="$ROOT_DIR/store-assets/source/store-assets.html"
OUT_DIR="$ROOT_DIR/store-assets/images"
TMP_DIR="$ROOT_DIR/store-assets/.tmp"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SOURCE_LOGO="$ROOT_DIR/assets/logo.png"
SOURCE_MARQUEE="$ROOT_DIR/store-assets/source/source-marquee.png"
SOURCE_SMALL_PROMO="$ROOT_DIR/store-assets/source/source-small-promo.png"

mkdir -p "$OUT_DIR" "$TMP_DIR"

capture_png() {
  local asset="$1"
  local width="$2"
  local height="$3"
  local out="$4"
  local profile="$TMP_DIR/chrome-profile-${asset}-${width}x${height}"
  rm -f "$out"
  rm -rf "$profile"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --disable-background-networking \
    --disable-extensions \
    --no-first-run \
    --no-default-browser-check \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --user-data-dir="$profile" \
    --window-size="${width},${height}" \
    --screenshot="$out" \
    "file://${HTML_FILE}?asset=${asset}" >/dev/null 2>&1 &
  local pid=$!
  local previous_size=0
  for _ in $(seq 1 80); do
    if [[ -s "$out" ]]; then
      local current_size
      current_size="$(stat -f%z "$out")"
      if [[ "$current_size" -gt 0 && "$current_size" == "$previous_size" ]]; then
        kill "$pid" >/dev/null 2>&1 || true
        wait "$pid" >/dev/null 2>&1 || true
        return 0
      fi
      previous_size="$current_size"
    fi
    sleep 0.1
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
  if [[ ! -s "$out" ]]; then
    echo "Failed to render $asset" >&2
    return 1
  fi
}

capture_jpg() {
  local asset="$1"
  local width="$2"
  local height="$3"
  local out="$4"
  local png="$TMP_DIR/${asset}-${width}x${height}.png"
  capture_png "$asset" "$width" "$height" "$png"
  sips -s format jpeg -s formatOptions 95 "$png" --out "$out" >/dev/null
}

resize_cover() {
  local src="$1"
  local width="$2"
  local height="$3"
  local out="$4"
  python3 - "$src" "$width" "$height" "$out" <<'PY'
import sys
from PIL import Image

src = Image.open(sys.argv[1]).convert("RGB")
target_w = int(sys.argv[2])
target_h = int(sys.argv[3])
scale = max(target_w / src.width, target_h / src.height)
resized = src.resize((round(src.width * scale), round(src.height * scale)), Image.Resampling.LANCZOS)
left = (resized.width - target_w) // 2
top = (resized.height - target_h) // 2
resized.crop((left, top, left + target_w, top + target_h)).save(sys.argv[4], quality=95)
PY
}

resize_cover "$SOURCE_LOGO" 128 128 "$OUT_DIR/store-icon-128.png"
resize_cover "$SOURCE_LOGO" 128 128 "$OUT_DIR/logo-128.png"
capture_jpg screenshot1 1280 800 "$OUT_DIR/screenshot-1-analytics-button.jpg"
capture_jpg screenshot2 1280 800 "$OUT_DIR/screenshot-2-quota-modal.jpg"
capture_jpg screenshot3 1280 800 "$OUT_DIR/screenshot-3-meter-chart.jpg"
capture_jpg screenshot4 1280 800 "$OUT_DIR/screenshot-4-history-export.jpg"
resize_cover "$SOURCE_SMALL_PROMO" 440 280 "$OUT_DIR/small-promo-440x280.jpg"
resize_cover "$SOURCE_MARQUEE" 1400 560 "$OUT_DIR/marquee-promo-1400x560.jpg"

rm -rf "$TMP_DIR"

echo "Generated store assets in $OUT_DIR"
