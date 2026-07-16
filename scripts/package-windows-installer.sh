#!/usr/bin/env bash
# Build the Windows one-click installer (Inno Setup .exe).
#
# Runs the normal Windows packaging (fresh web bundle + cmake build (MSVC,
# Windows-only)), then compiles native/windows/installer/KuroScreensaver.iss
# with the Inno Setup compiler (ISCC) into
# dist-native/KuroScreensaver-Setup-<version>.exe.
#
# ISCC is Windows-only; on macOS/Linux it runs under wine (`wine ISCC.exe ...`).
# If neither is found, this prints instructions and exits 0 after producing the
# publish folder, so the .iss can be compiled on a Windows box or in CI.
#
# Usage: bash scripts/package-windows-installer.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Fresh web bundle + cmake build (produces the publish/ folder the .iss packs).
bash "$ROOT/scripts/package-windows.sh"

VERSION="$(node -p "require('$ROOT/package.json').version")"
ISS="$ROOT/native/windows/installer/KuroScreensaver.iss"
OUT="$ROOT/dist-native"
mkdir -p "$OUT"

# 2. Find an Inno Setup compiler: native ISCC, its default install location
#    (Windows runners ship it there but do NOT put it on PATH), or via wine.
run_iscc() {
  local installed
  if command -v iscc >/dev/null 2>&1; then
    iscc "/DMyAppVersion=$VERSION" "/O$OUT" "$ISS"
  elif command -v ISCC >/dev/null 2>&1; then
    ISCC "/DMyAppVersion=$VERSION" "/O$OUT" "$ISS"
  elif installed="$(ls -d "/c/Program Files (x86)/Inno Setup"*/ISCC.exe 2>/dev/null | head -1)" \
       && [ -n "$installed" ]; then
    "$installed" "/DMyAppVersion=$VERSION" "/O$OUT" "$ISS"
  elif command -v wine >/dev/null 2>&1 && [ -n "${ISCC_EXE:-}" ] && [ -f "$ISCC_EXE" ]; then
    wine "$ISCC_EXE" "/DMyAppVersion=$VERSION" "/O$OUT" "$ISS"
  else
    return 1
  fi
}

echo "=== Inno Setup compile (v$VERSION) ==="
if run_iscc; then
  echo "✓ $OUT/KuroScreensaver-Setup-$VERSION.exe"
else
  cat <<EOF

⚠ Inno Setup compiler (ISCC) not found — the publish folder is ready but the
  installer .exe was NOT built on this machine.

  To finish, compile the installer where Inno Setup 6 is available:
    • Windows:  ISCC /DMyAppVersion=$VERSION /Odist-native native/windows/installer/KuroScreensaver.iss
    • wine:     ISCC_EXE="/path/to/ISCC.exe" bash scripts/package-windows-installer.sh
    • CI:       run the same ISCC step on a windows runner

  Inno Setup 6: https://jrsoftware.org/isdl.php
EOF
  # Locally a missing compiler is fine (the publish folder is still useful), but
  # CI must never report success without having compiled the .iss — that silent
  # pass is how a broken installer reaches a release. Set KURO_REQUIRE_ISCC=1
  # anywhere the compile is the whole point of the run.
  if [ -n "${KURO_REQUIRE_ISCC:-}" ]; then
    echo "✗ KURO_REQUIRE_ISCC is set, but no Inno Setup compiler was found." >&2
    exit 1
  fi
fi
