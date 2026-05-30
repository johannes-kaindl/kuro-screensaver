#!/usr/bin/env bash
# Build one macOS .saver per rendered preset video.
#
# Strategy: rebuild the KuroVideoSaver target once PER preset, each with a unique
# Objective-C class name (KuroVideoSaver_<key>) — necessary so each .saver loads
# its OWN video (see the long note at the build loop). After each build, copy in
# that preset's loop.mov, set a unique name / bundle id / principal class, sign.
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

# Generate the Xcode project (idempotent).
( cd "$MACOS" && xcodegen generate >/dev/null )

# Each .saver needs a UNIQUE Objective-C principal class. The Obj-C runtime
# registers a class name only once per process, so if every bundle shipped the
# same `KuroVideoSaverView`, `Bundle(for: KuroVideoSaverView.self)` would resolve
# to whichever bundle loaded *first* — and every preset would play that bundle's
# video. So we rename the class per preset (`KuroVideoSaver_<key>`) and rebuild.
rm -f "$MACOS/KuroVideoSaver/loop.mov"   # video is copied in AFTER each build, not embedded
SRC="$MACOS/KuroVideoSaver/KuroVideoSaverView.swift"
SRC_ORIG="$(cat "$SRC")"
restore_src() { printf '%s' "$SRC_ORIG" > "$SRC"; }
trap restore_src EXIT   # leave the working tree's source untouched after the run

rm -rf "$OUT"; mkdir -p "$OUT"
for v in "${videos[@]}"; do
  key=$(basename "$v" .mov); key=${key#kuro-}
  label=$(labels "$key")
  cls="KuroVideoSaver_${key//-/_}"          # e.g. KuroVideoSaver_ghost_protocol

  # Rebuild the binary with this preset's unique class name.
  printf '%s' "$SRC_ORIG" | sed "s/KuroVideoSaverView/$cls/g" > "$SRC"
  rm -rf "$DERIVED"                          # clean build so no stale class lingers
  echo "Building $label (class $cls) …"
  xcodebuild -project "$MACOS/KuroScreensaver.xcodeproj" -scheme KuroVideoSaver \
    -configuration Release -derivedDataPath "$DERIVED" build >/dev/null
  built="$DERIVED/Build/Products/Release/KuroVideoSaver.saver"
  [ -d "$built" ] || { echo "✗ build failed for $key" >&2; exit 1; }

  saver="$OUT/Kuro $label.saver"
  rm -rf "$saver"; cp -R "$built" "$saver"
  # The built bundle has no Resources dir (loop.mov is no longer a target
  # resource), so create it before copying this preset's video in.
  mkdir -p "$saver/Contents/Resources"
  cp "$v" "$saver/Contents/Resources/loop.mov"   # embed this preset's video
  plist="$saver/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName Kuro $label" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.kuro.screensaver.video.$key" "$plist"
  /usr/libexec/PlistBuddy -c "Set :NSPrincipalClass $cls" "$plist"   # must match the binary
  codesign --remove-signature "$saver" 2>/dev/null || true
  codesign --force --deep --sign - "$saver"
  codesign --verify --deep --strict "$saver"
  mb=$(( $(stat -f%z "$v") / 1000000 ))
  echo "  ✓ Kuro $label.saver  (${mb} MB)"
done
restore_src; trap - EXIT

# Zip each .saver SEPARATELY — one ~240MB asset per preset stays under the
# release-asset size limit and lets users grab only the presets they want. A
# single combined zip is ~3GB and fails to upload as a release asset.
SAVERS_DIST="$ROOT/$DIST/savers"
rm -rf "$SAVERS_DIST"; mkdir -p "$SAVERS_DIST"
for saver in "$OUT"/*.saver; do
  base=$(basename "$saver")        # "Kuro Crimson.saver" — bundle keeps its space
  zipname="${base// /-}"           # "Kuro-Crimson.saver" — NO space in the asset name
  # (a space breaks the release-upload URL ?name=…; the bundle inside keeps its
  #  display name for System Settings.)
  ( cd "$OUT" && zip -rqy "$SAVERS_DIST/${zipname}.zip" "$base" )
done

echo ""
echo "Done: ${#videos[@]} .saver bundle(s) → $DIST/savers/*.saver.zip"
echo "Test: cp -R \"$OUT/\"*.saver ~/Library/Screen\\ Savers/  then open System Settings ▸ Screen Saver"
