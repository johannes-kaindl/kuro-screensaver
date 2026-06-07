#!/usr/bin/env bash
# Headless render smoke test for the native Metal engine.
#
# Builds the offscreen harness and renders a single frame, then asserts a valid PNG
# came out. This exercises the *runtime* path the logic tests can't reach: Renderer
# init, runtime shader compilation, pipeline + scene-buffer creation, one full draw.
# It catches shader/pipeline regressions that compile fine but blow up at runtime.
#
# GPU-aware: a runner with no Metal device (some headless CI) is treated as a SKIP
# (exit 0), not a failure — so this step can run blocking in CI yet never break a
# build just because the runner lacks a GPU. A genuine render failure still exits 1.
#
#   scripts/smoke-test-native.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="/tmp/kuro-smoke"
rm -rf "$OUT"; mkdir -p "$OUT"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# build-native-harness.sh compiles Core/* + harness then forwards args to the harness.
# A single deterministic frame (terrain @ t=1) is enough to prove the engine runs.
if ! bash "$ROOT/scripts/build-native-harness.sh" --out "$OUT" --scene terrain --at 1 >"$log" 2>&1; then
  if grep -q "no Metal device" "$log"; then
    echo "⚠ smoke: no Metal GPU on this host — skipping render assertion (compile was OK)"
    exit 0
  fi
  echo "✗ smoke: harness build/run failed" >&2
  cat "$log" >&2
  exit 1
fi

png="$(ls -S "$OUT"/*.png 2>/dev/null | head -1 || true)"
if [ -z "$png" ]; then
  echo "✗ smoke: harness ran but produced no PNG" >&2
  cat "$log" >&2
  exit 1
fi

# BSD stat (macOS) then GNU stat (Linux) fallback.
size="$(stat -f%z "$png" 2>/dev/null || stat -c%s "$png")"
echo "smoke: rendered $(basename "$png") ($size bytes)"
if [ "$size" -le 100000 ]; then
  echo "✗ smoke: PNG suspiciously small ($size bytes) — likely a blank/broken frame" >&2
  exit 1
fi

echo "✓ headless render smoke test passed"
