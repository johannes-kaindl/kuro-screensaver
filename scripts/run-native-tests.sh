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
# The shared query contract — the same fixture the Windows and Linux hosts pin.
# A MISSING file must fail the run, not skip a check (Linux/Windows do the same).
cp "$ROOT/native/shared/query-contract.txt" "$OUT/"

core_src=("$SRC"/Core/*.swift)
# AppDefaults is app-level, not engine, but it is what the contract test checks —
# so it is compiled in deliberately. It carries no AppKit, unlike AppSettings.
swiftc -O \
  "${core_src[@]}" \
  "$ROOT/native/macos/KuroMetalApp/AppDefaults.swift" \
  "$SRC/tests/main.swift" \
  -o "$OUT/tests" \
  -framework Metal -framework MetalPerformanceShaders -framework AVFoundation -framework Foundation -framework CoreText -framework CoreGraphics

echo "built $OUT/tests"
"$OUT/tests"
