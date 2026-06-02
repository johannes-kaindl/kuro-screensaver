#!/usr/bin/env bash
# Build the native Metal .saver WITHOUT Xcode.
#
# A .saver is a loadable bundle (MH_BUNDLE) whose executable dlopen's at
# activation. We compile Core/ + Host/ with swiftc (`-Xlinker -bundle` →
# MH_BUNDLE) and assemble Contents/ by hand. Metal shaders are compiled at
# runtime (device.makeLibrary(source:)), so no `.metallib`/metal compiler is
# needed. Output: native/macos/build/KuroNativeSaver.saver (+ a .zip).
#
# The release path (CI / a machine with Xcode) can instead use the xcodegen
# target in project.yml; this script is the Xcode-free local build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/KuroNativeSaver"
BUILD="$ROOT/native/macos/build"
SAVER="$BUILD/KuroNativeSaver.saver"
MACOS_DIR="$SAVER/Contents/MacOS"

rm -rf "$SAVER"
mkdir -p "$MACOS_DIR"

echo "compiling bundle binary…"
# shellcheck disable=SC2046
swiftc -O -emit-library -Xlinker -bundle \
  -o "$MACOS_DIR/KuroNativeSaver" \
  $(ls "$SRC"/Core/*.swift) $(ls "$SRC"/Host/*.swift) \
  -module-name KuroNativeSaver \
  -framework ScreenSaver -framework Metal -framework MetalPerformanceShaders \
  -framework QuartzCore -framework AppKit -framework Foundation

cp "$SRC/Host/Info.plist" "$SAVER/Contents/Info.plist"

# Developer ID + hardened runtime if the cert is present (required for the saver
# to register with PluginKit / appear in the picker, alongside notarization);
# otherwise ad-hoc (preview/dev only).
SIGN_ID="${KURO_SIGN_ID:-Developer ID Application: Johannes Kaindl (U9X7M39R56)}"
codesign --remove-signature "$SAVER" 2>/dev/null || true
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  echo "signing (Developer ID + hardened runtime)…"
  codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$SAVER"
else
  echo "signing (ad-hoc — no Developer ID; preview only)…"
  codesign --force --deep --sign - "$SAVER"
fi
codesign --verify --deep --strict "$SAVER"

# Notarize if a credential profile exists (set up once via
# `xcrun notarytool store-credentials kuro-notary …`). Without notarization the
# saver is Gatekeeper-rejected and PluginKit won't register it on macOS 14+/26.
NOTARY_PROFILE="${KURO_NOTARY_PROFILE:-kuro-notary}"
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "notarizing (profile $NOTARY_PROFILE)…"
  ZIP="$BUILD/KuroNativeSaver-notarize.zip"
  ditto -c -k --keepParent "$SAVER" "$ZIP"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  # NOTE: a .saver bundle can't be stapled directly; ship inside a notarized .pkg
  # for distribution. For local use the online Gatekeeper check + registration
  # below suffices once the submission is Accepted.
  rm -f "$ZIP"
  echo "registering with PluginKit…"
  pluginkit -a "$SAVER" || true
  pluginkit -m 2>/dev/null | grep -i kuro && echo "registered ✓" || echo "not yet registered (may need killall pkd/WallpaperAgent + relogin)"
else
  echo "::note:: no notarytool profile '$NOTARY_PROFILE' — skipping notarization."
  echo "         Set up once: xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <id> --team-id U9X7M39R56"
fi

( cd "$BUILD" && rm -f KuroNativeSaver.saver.zip && zip -qry KuroNativeSaver.saver.zip KuroNativeSaver.saver )

echo "smoke test (load bundle + instantiate principal class)…"
swiftc "$SRC/tools/load-check.swift" -o "$BUILD/load-check" \
  -framework ScreenSaver -framework AppKit -framework Foundation 2>/dev/null
# Non-fatal: needs a Metal device (instantiation builds the renderer). A headless
# CI runner without one shouldn't fail the build — the .saver is already valid.
"$BUILD/load-check" "$SAVER" || echo "::warning:: smoke test skipped/failed (no Metal device?)"

echo "built: $SAVER"
file "$MACOS_DIR/KuroNativeSaver"
echo "zip:   $BUILD/KuroNativeSaver.saver.zip"
