#!/usr/bin/env bash
# Build the standalone fullscreen Metal screensaver app (KuroMetalApp) — the
# robust macOS-26 path that avoids the legacyScreenSaver host. Xcode-free
# (swiftc); shaders compile at runtime. Signed with Developer ID + hardened
# runtime if available, else ad-hoc (runs locally either way).
#
#   scripts/build-native-app.sh            # build + sign
#   open native/macos/build/KuroMetalApp.app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/KuroNativeSaver"
APPSRC="$ROOT/native/macos/KuroMetalApp"
BUILD="$ROOT/native/macos/build"
APP="$BUILD/KuroMetalApp.app"
SIGN_ID="${KURO_SIGN_ID:-Developer ID Application: Johannes Kaindl (U9X7M39R56)}"

rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"

echo "compiling app…"
# shellcheck disable=SC2046
swiftc -O \
  $(ls "$SRC"/Core/*.swift) $(ls "$APPSRC"/*.swift) \
  -o "$APP/Contents/MacOS/KuroMetalApp" \
  -framework Metal -framework MetalPerformanceShaders -framework QuartzCore \
  -framework AppKit -framework Foundation

cp "$APPSRC/Info.plist" "$APP/Contents/Info.plist"

echo "signing…"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP"
  echo "signed with Developer ID"
else
  codesign --force --sign - "$APP"
  echo "ad-hoc signed (no Developer ID found)"
fi
codesign --verify --strict "$APP" && echo "codesign verify OK"

echo "built: $APP"
echo "run:   open \"$APP\""
