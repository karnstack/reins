#!/usr/bin/env bash
# Render the store graphics to ../*.png at their exact sizes, as 24-bit PNGs
# with no alpha (the Chrome Web Store rejects alpha): the five 1280×800
# screenshots ([0-9]-*.html) and the two promo tiles (tile-*.html). Needs
# chrome-headless-shell (Playwright installs one: npx playwright install
# chromium-headless-shell) and python3 with Pillow. Full Chrome's --headless
# can hang on exit on macOS; the shell does not.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)}"
[ -x "$CHROME" ] || { echo "chrome-headless-shell not found; set CHROME=" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pass files to render a subset: ./render.sh 2-popup.html tile-small.html
if [ $# -eq 0 ]; then set -- [0-9]-*.html tile-*.html; fi
for f in "$@"; do
  case "$f" in
    tile-small.html) out="small-tile-440x280.png" w=440 h=280 ;;
    tile-marquee.html) out="marquee-1400x560.png" w=1400 h=560 ;;
    [0-9]-*.html) out="screenshot-${f%%-*}-1280x800.png" w=1280 h=800 ;;
    *) echo "unknown slide: $f" >&2; exit 1 ;;
  esac
  "$CHROME" --hide-scrollbars --force-device-scale-factor=1 --window-size="$w,$h" --virtual-time-budget=4000 \
    --screenshot="$TMP/out.png" "file://$PWD/$f" >/dev/null 2>&1
  python3 - "$TMP/out.png" "../$out" "$w" "$h" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
assert im.size == (int(sys.argv[3]), int(sys.argv[4])), im.size
im.save(sys.argv[2], optimize=True)
PY
  echo "$out"
done
