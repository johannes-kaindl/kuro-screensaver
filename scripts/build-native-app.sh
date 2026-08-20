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
core_src=("$SRC"/Core/*.swift)
app_src=("$APPSRC"/*.swift)
swiftc -O \
  -target arm64-apple-macos14.0 \
  "${core_src[@]}" "${app_src[@]}" \
  -o "$APP/Contents/MacOS/KuroMetalApp" \
  -framework Metal -framework MetalPerformanceShaders -framework AVFoundation -framework QuartzCore \
  -framework AppKit -framework CoreText -framework Foundation

cp "$APPSRC/Info.plist" "$APP/Contents/Info.plist"

# Data resources. story-content.json is the narrative SSOT shared with the web engine;
# osm-district.json is the build-time-baked OSM district the metro scene renders. Both
# are loaded via Bundle.main — never fetched (AGENTS.md § Architecture notes).
mkdir -p "$APP/Contents/Resources"
cp "$ROOT/src/engine/data/story-content.json" "$ROOT/src/engine/data/osm-district.json" \
   "$APP/Contents/Resources/"

# App icon: generate AppIcon.icns from the committed 1024² source. Mandatory for a
# labelled, distributable app — fail loudly rather than silently shipping iconless.
ICON_SRC="$APPSRC/icon-1024.png"
[ -f "$ICON_SRC" ] || { echo "✗ missing app icon: $ICON_SRC (required for a labelled, distributable app)" >&2; exit 1; }
ISET="$BUILD/AppIcon.iconset"; rm -rf "$ISET"; mkdir -p "$ISET" "$APP/Contents/Resources"
for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$ICON_SRC" --out "$ISET/icon_${sz}x${sz}.png" >/dev/null 2>&1
  sips -z "$((sz*2))" "$((sz*2))" "$ICON_SRC" --out "$ISET/icon_${sz}x${sz}@2x.png" >/dev/null 2>&1
done
iconutil -c icns "$ISET" -o "$APP/Contents/Resources/AppIcon.icns" && echo "icon generated"

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
