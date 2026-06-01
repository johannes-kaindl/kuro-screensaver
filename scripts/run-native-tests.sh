#!/usr/bin/env bash
# Build + run the assert-based logic tests for the native renderer Core.
# Exits non-zero if any assertion fails. No XCTest/SwiftPM (Xcode-free).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/KuroNativeSaver"
OUT="/tmp/kuro-native"
mkdir -p "$OUT"

# shellcheck disable=SC2046
swiftc -O \
  $(ls "$SRC"/Core/*.swift) \
  "$SRC/tests/main.swift" \
  -o "$OUT/tests" \
  -framework Metal -framework MetalPerformanceShaders -framework Foundation

echo "built $OUT/tests"
"$OUT/tests"
