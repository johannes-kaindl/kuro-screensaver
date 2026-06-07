#!/usr/bin/env bash
# Build + run the headless Metal render harness (no Xcode needed).
# Compiles the platform-agnostic Core/ + harness with swiftc; shaders are
# compiled at runtime. All args after the script are forwarded to the harness.
#
#   scripts/build-native-harness.sh --preset phosphor --at 8
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/KuroNativeSaver"
OUT="/tmp/kuro-native"
mkdir -p "$OUT"

core_src=("$SRC"/Core/*.swift)
swiftc -O \
  "${core_src[@]}" \
  "$SRC/harness/main.swift" \
  -o "$OUT/harness" \
  -framework Metal -framework MetalPerformanceShaders -framework AVFoundation -framework Foundation \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework UniformTypeIdentifiers

echo "built $OUT/harness"
"$OUT/harness" "$@"
