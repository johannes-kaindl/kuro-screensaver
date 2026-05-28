#!/usr/bin/env bash
# Build the macOS app distributable (KuroScreensaver.app).
#
# A fullscreen app that hosts the web engine in a WKWebView — WebGL composites
# correctly in a normal app process (unlike the .saver in the sandboxed
# legacyScreenSaver process). Requires Xcode + xcodegen.
#
# Usage: bash scripts/package-macos.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v xcodebuild >/dev/null 2>&1 || ! xcodebuild -version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: a full Xcode is required (CommandLineTools are not enough).

  1. Install Xcode (App Store or `xcodes install --latest`).
  2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  3. Re-run: bash scripts/package-macos.sh
EOF
  exit 1
fi

command -v xcodegen >/dev/null 2>&1 || { echo "ERROR: xcodegen missing — brew install xcodegen" >&2; exit 1; }

bash "$ROOT/scripts/bundle-web.sh"

cd "$ROOT/native/macos"
xcodegen generate

echo "=== xcodebuild (Release, app target) ==="
xcodebuild \
  -project KuroScreensaver.xcodeproj \
  -scheme KuroScreensaverApp \
  -configuration Release \
  -derivedDataPath build \
  build | tail -8

APP="$ROOT/native/macos/build/Build/Products/Release/KuroScreensaver.app"
[ -d "$APP" ] || { echo "ERROR: .app not produced at $APP" >&2; exit 1; }

# Re-sign ad-hoc with a proper resource seal. xcodebuild's signature can be a
# minimal linker-signed one (Sealed Resources=none → "damaged" on Apple
# Silicon); an explicit codesign fixes that. Still unsigned for distribution
# (no Developer ID) — users clear quarantine on first run (see README).
codesign --force --sign - "$APP"
codesign --verify --verbose=1 "$APP" 2>&1 | tail -2 || true

DIST="$ROOT/dist-native"
mkdir -p "$DIST"
rm -f "$DIST/KuroScreensaver-macos.zip"
( cd "$(dirname "$APP")" && zip -rqy "$DIST/KuroScreensaver-macos.zip" "KuroScreensaver.app" )

echo "✓ $DIST/KuroScreensaver-macos.zip"
echo "  Run: unzip, then — because it's unsigned — clear quarantine once:"
echo "    xattr -dr com.apple.quarantine KuroScreensaver.app && open KuroScreensaver.app"
