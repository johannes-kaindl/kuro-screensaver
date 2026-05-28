#!/usr/bin/env bash
# Build the macOS .saver distributable.
#
# Requires Xcode (CommandLineTools alone lack ScreenSaver.framework) and
# xcodegen. Bundles the web assets, generates the project, builds the .saver,
# and zips it.
#
# Usage: bash scripts/package-macos.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v xcodebuild >/dev/null 2>&1 || ! xcodebuild -version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: a full Xcode is required (CommandLineTools lack ScreenSaver.framework).

  1. Install Xcode from the App Store.
  2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  3. Re-run: bash scripts/package-macos.sh
EOF
  exit 1
fi

command -v xcodegen >/dev/null 2>&1 || { echo "ERROR: xcodegen missing — brew install xcodegen" >&2; exit 1; }

bash "$ROOT/scripts/bundle-web.sh"

cd "$ROOT/native/macos"
xcodegen generate

echo "=== xcodebuild (Release) ==="
xcodebuild \
  -project KuroScreensaver.xcodeproj \
  -scheme KuroScreensaver \
  -configuration Release \
  -derivedDataPath build \
  build | tail -8

SAVER="$ROOT/native/macos/build/Build/Products/Release/KuroScreensaver.saver"
[ -d "$SAVER" ] || { echo "ERROR: .saver not produced at $SAVER" >&2; exit 1; }

DIST="$ROOT/dist-native"
mkdir -p "$DIST"
rm -f "$DIST/KuroScreensaver-macos.zip"
( cd "$(dirname "$SAVER")" && zip -rqy "$DIST/KuroScreensaver-macos.zip" "KuroScreensaver.saver" )

echo "✓ $DIST/KuroScreensaver-macos.zip"
echo "  Install: double-click the .saver (unsigned → confirm in System Settings)."
