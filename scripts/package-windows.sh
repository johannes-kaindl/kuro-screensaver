#!/usr/bin/env bash
# Build the Windows .scr distributable.
#
# Cross-builds on macOS/Linux (no Windows needed) via `dotnet publish
# -r win-x64`, bundles the web assets next to the executable, renames it to
# .scr, and zips the folder (the .scr needs its companion DLLs + web/ in the
# same directory).
#
# The publish is SELF-CONTAINED: Windows 10/11 does NOT ship the .NET 8
# Desktop Runtime, and a framework-dependent .scr dies instantly on machines
# without it (all modes — /s, /p and the WinForms-only /c config dialog).
# Bundling the runtime costs ~70 MB zipped but removes the prerequisite.
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
dotnet publish "$PROJ" -c Release -r win-x64 --self-contained true -p:DebugType=none

rm -rf "$OUT/web"
cp -R "$ROOT/native/windows/web" "$OUT/web"

# A .scr is just the renamed executable; keep only the .scr to avoid confusion.
cp "$OUT/KuroScreensaver.exe" "$OUT/KuroScreensaver.scr"
rm -f "$OUT/KuroScreensaver.exe" "$OUT/KuroScreensaver.pdb"

DIST="$ROOT/dist-native"
mkdir -p "$DIST"
rm -f "$DIST/KuroScreensaver-windows.zip"

# zip is absent in Git-Bash on Windows CI runners — there the installer job only
# needs the publish/ folder, so skipping the zip is fine.
if command -v zip >/dev/null 2>&1; then
  ( cd "$OUT" && zip -rq "$DIST/KuroScreensaver-windows.zip" . )
  echo "✓ $DIST/KuroScreensaver-windows.zip"
else
  echo "⚠ zip not found — skipped the zip; publish folder is ready: $OUT"
fi

echo "  Install on Windows: extract, right-click KuroScreensaver.scr → Install."
echo "  Needs the WebView2 Evergreen runtime (preinstalled on current Win10/11)."
echo "  .NET runtime is bundled (self-contained) — no separate install needed."
