#!/usr/bin/env bash
# Build + run the assert-based logic tests for the native renderer Core.
# Exits non-zero if any assertion fails. No XCTest/SwiftPM (Xcode-free).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/KuroNativeSaver"
OUT="/tmp/kuro-native"
mkdir -p "$OUT"

# Data resources. The Core loads these via Bundle.main; for a bare CLI binary that
# resolves to the executable's own directory, so they must sit next to $OUT/tests.
cp "$ROOT/src/engine/data/story-content.json" "$ROOT/src/engine/data/osm-district.json" "$OUT/"

core_src=("$SRC"/Core/*.swift)
swiftc -O \
  "${core_src[@]}" \
  "$SRC/tests/main.swift" \
  -o "$OUT/tests" \
  -framework Metal -framework MetalPerformanceShaders -framework AVFoundation -framework Foundation -framework CoreText -framework CoreGraphics

echo "built $OUT/tests"
"$OUT/tests"
