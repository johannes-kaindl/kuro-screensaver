#!/usr/bin/env bash
# Build the Windows .scr distributable.
#
# Cross-builds on macOS/Linux (no Windows needed) via `dotnet publish
# -r win-x64`, bundles the web assets next to the executable, renames it to
# .scr, and zips the folder (the .scr needs its companion DLLs + web/ in the
# same directory).
#
# Requires the .NET 8 SDK on PATH (e.g. ~/.dotnet from dotnet-install.sh).
# Usage: bash scripts/package-windows.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.dotnet:$PATH"

command -v dotnet >/dev/null 2>&1 || { echo "ERROR: dotnet not found on PATH" >&2; exit 1; }

bash "$ROOT/scripts/bundle-web.sh"

PROJ="$ROOT/native/windows/KuroScreensaver.csproj"
OUT="$ROOT/native/windows/bin/Release/net8.0-windows/win-x64/publish"

echo "=== dotnet publish (win-x64) ==="
dotnet publish "$PROJ" -c Release -r win-x64 --self-contained false -p:DebugType=none

rm -rf "$OUT/web"
cp -R "$ROOT/native/windows/web" "$OUT/web"

# A .scr is just the renamed executable; keep only the .scr to avoid confusion.
cp "$OUT/KuroScreensaver.exe" "$OUT/KuroScreensaver.scr"
rm -f "$OUT/KuroScreensaver.exe" "$OUT/KuroScreensaver.pdb"

DIST="$ROOT/dist-native"
mkdir -p "$DIST"
rm -f "$DIST/KuroScreensaver-windows.zip"
( cd "$OUT" && zip -rq "$DIST/KuroScreensaver-windows.zip" . )

echo "✓ $DIST/KuroScreensaver-windows.zip"
echo "  Install on Windows: extract, right-click KuroScreensaver.scr → Install."
echo "  Needs the WebView2 Evergreen runtime (preinstalled on current Win10/11)."
