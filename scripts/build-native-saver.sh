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

echo "signing (ad-hoc)…"
codesign --remove-signature "$SAVER" 2>/dev/null || true
codesign --force --deep --sign - "$SAVER"
codesign --verify --deep --strict "$SAVER"

( cd "$BUILD" && rm -f KuroNativeSaver.saver.zip && zip -qry KuroNativeSaver.saver.zip KuroNativeSaver.saver )

echo "smoke test (load bundle + instantiate principal class)…"
swiftc "$SRC/tools/load-check.swift" -o "$BUILD/load-check" \
  -framework ScreenSaver -framework AppKit -framework Foundation 2>/dev/null
"$BUILD/load-check" "$SAVER"

echo "built: $SAVER"
file "$MACOS_DIR/KuroNativeSaver"
echo "zip:   $BUILD/KuroNativeSaver.saver.zip"
