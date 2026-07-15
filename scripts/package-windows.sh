#!/usr/bin/env bash
# Build the Windows .scr distributable (C++/Win32 micro-host + web bundle).
#
# Single source for CI: both the `windows` and `windows-installer` release
# jobs call this script so build flags can never diverge (v0.7.0 shipped a
# broken installer because a CI step duplicated the build command).
#
# MSVC-only — must run on Windows (CI windows-latest runner or a local
# Windows box). There is no macOS/Linux cross-build for the Win32 host; the
# old dotnet cross-build died with the .NET host (v0.9.0).
#
# Usage: bash scripts/package-windows.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo "ERROR: the C++/Win32 host needs MSVC — run on Windows (CI: windows-latest)" >&2; exit 1 ;;
esac

bash "$ROOT/scripts/bundle-web.sh"

BUILD="$ROOT/native/windows/host/build"
echo "=== cmake build (MSVC x64, Release) ==="
cmake -S "$ROOT/native/windows/host" -B "$BUILD" -A x64
cmake --build "$BUILD" --config Release

OUT="$ROOT/dist-native/windows-scr"
rm -rf "$OUT"
mkdir -p "$OUT"

# A .scr is just the renamed executable; the web/ assets ride next to it.
cp "$BUILD/Release/KuroScreensaver.exe" "$OUT/KuroScreensaver.scr"
cp -R "$ROOT/native/windows/web" "$OUT/web"

ZIP="$ROOT/dist-native/KuroScreensaver-windows.zip"
rm -f "$ZIP"
# Git-Bash on the Windows runners has no `zip`, but 7z is preinstalled.
if command -v 7z >/dev/null 2>&1; then
  (cd "$OUT" && 7z a -tzip -r "$ZIP" . >/dev/null)
  echo "✓ $ZIP"
elif command -v zip >/dev/null 2>&1; then
  (cd "$OUT" && zip -rq "$ZIP" .)
  echo "✓ $ZIP"
else
  echo "⚠ neither 7z nor zip found — publish folder is ready: $OUT"
fi

echo "  Install on Windows: extract, right-click KuroScreensaver.scr → Install."
echo "  Needs the WebView2 runtime (inbox on Windows 11; download link shows on start if missing)."
