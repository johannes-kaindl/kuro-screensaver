#!/usr/bin/env bash
# Build one macOS .saver per rendered preset video.
#
# Strategy: build the KuroVideoSaver target ONCE as a template, then clone it
# per preset — swap in that preset's loop.mov, give it a unique name + bundle
# id, and re-sign. Avoids 13 slow xcodebuilds.
#
# Prereqs: render-out/videos/kuro-<preset>.mov exist (scripts/render-saver-videos.mjs),
#          xcodegen + Xcode installed.
#
# Output: native/macos/build/savers/Kuro <Label>.saver

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VIDEO_DIR="render-out/videos"
MACOS="native/macos"
BUILD="$MACOS/build"
DERIVED="$BUILD/DerivedData"
OUT="$BUILD/savers"
DIST="dist-native"

if ! command -v xcodebuild >/dev/null 2>&1 || ! xcodebuild -version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: a full Xcode is required (CommandLineTools are not enough).
  1. Install Xcode (App Store or `xcodes install --latest`).
  2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  3. Re-run: bash scripts/build-video-savers.sh
EOF
  exit 1
fi
command -v xcodegen >/dev/null 2>&1 || { echo "ERROR: xcodegen missing — brew install xcodegen" >&2; exit 1; }

# preset key → human label (matches PRESETS in src/engine/data/presets.ts)
labels() {
  case "$1" in
    kuro) echo "Kuro";; neural-bleed) echo "Neural Bleed";; rust-signal) echo "Rust Signal";;
    toxic-haze) echo "Toxic Haze";; biolink) echo "Biolink";; ghost-protocol) echo "Ghost Protocol";;
    voidwitch) echo "Voidwitch";; circuit) echo "Circuit";; crimson) echo "Crimson";;
    phosphor) echo "Phosphor";; ember) echo "Ember";; spectre) echo "Spectre";; pearl) echo "Pearl";;
    *) echo "$1";;
  esac
}

shopt -s nullglob
videos=("$VIDEO_DIR"/kuro-*.mov)
if [ ${#videos[@]} -eq 0 ]; then
  echo "✗ no videos in $VIDEO_DIR — run scripts/render-saver-videos.mjs first" >&2
  exit 1
fi
echo "Found ${#videos[@]} preset video(s)."

# 1. Generate the Xcode project (idempotent).
( cd "$MACOS" && xcodegen generate >/dev/null )

# 2. Build the template once, using the first video as a placeholder loop.mov.
cp "${videos[0]}" "$MACOS/KuroVideoSaver/loop.mov"
echo "Building KuroVideoSaver template …"
xcodebuild -project "$MACOS/KuroScreensaver.xcodeproj" -scheme KuroVideoSaver \
  -configuration Release -derivedDataPath "$DERIVED" \
  build >/dev/null
TEMPLATE="$DERIVED/Build/Products/Release/KuroVideoSaver.saver"
[ -d "$TEMPLATE" ] || { echo "✗ template build not found at $TEMPLATE" >&2; exit 1; }

# 3. Clone per preset.
rm -rf "$OUT"; mkdir -p "$OUT"
for v in "${videos[@]}"; do
  key=$(basename "$v" .mov); key=${key#kuro-}
  label=$(labels "$key")
  saver="$OUT/Kuro $label.saver"
  cp -R "$TEMPLATE" "$saver"
  cp "$v" "$saver/Contents/Resources/loop.mov"
  plist="$saver/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName Kuro $label" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.kuro.screensaver.video.$key" "$plist"
  # Re-sign ad-hoc after swapping resources (resource seal must match).
  codesign --remove-signature "$saver" 2>/dev/null || true
  codesign --force --deep --sign - "$saver"
  codesign --verify --deep --strict "$saver"
  mb=$(( $(stat -f%z "$v") / 1000000 ))
  echo "  ✓ Kuro $label.saver  (${mb} MB)"
done

rm -f "$MACOS/KuroVideoSaver/loop.mov"

# Zip all bundles into one distributable (preserves .saver bundle structure).
mkdir -p "$ROOT/$DIST"
ZIP="$ROOT/$DIST/KuroScreensaver-savers-macos.zip"
rm -f "$ZIP"
( cd "$OUT" && zip -rqy "$ZIP" ./*.saver )

echo ""
echo "Done: ${#videos[@]} .saver bundle(s) → $DIST/KuroScreensaver-savers-macos.zip"
echo "Test: cp -R \"$OUT/\"*.saver ~/Library/Screen\\ Savers/  then open System Settings ▸ Screen Saver"
