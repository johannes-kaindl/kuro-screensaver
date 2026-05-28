#!/usr/bin/env bash
# Build the web app and copy the screensaver build into both native hosts.
#
# The native wrappers (macOS .saver / Windows .scr) load screensaver.html
# from a bundled `web/` folder. This script regenerates that folder from a
# fresh production build. Source maps and the demo landing page are stripped —
# the native bundle only needs the screensaver entry + its assets.
#
# Usage: bash scripts/bundle-web.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Building web (npm run build) ==="
npm run build

WIN_WEB="$ROOT/native/windows/web"
MAC_WEB="$ROOT/native/macos/KuroScreensaver/web"

for target in "$WIN_WEB" "$MAC_WEB"; do
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$ROOT/dist/." "$target/"
  rm -f "$target/index.html"          # demo landing page — not needed natively
  find "$target" -name '*.map' -delete # source maps — not needed in distribution
done

echo "✓ Web assets bundled into:"
echo "  $WIN_WEB"
echo "  $MAC_WEB"
