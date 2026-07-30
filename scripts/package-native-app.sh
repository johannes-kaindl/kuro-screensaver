#!/usr/bin/env bash
# Package the standalone Metal screensaver app for distribution: build (Developer
# ID + hardened runtime), notarize, staple, and wrap it in a signed + notarized
# .dmg (drag-to-Applications) that opens cleanly on any Mac (no Gatekeeper
# warning). Distribution switched zip → dmg with v0.9.1 (2026-07-15).
#
# Unlike a .saver bundle, an .app CAN be stapled — so the notarization ticket
# travels with the artifact and works offline on the target machine. The dmg
# gets its own notarization + staple on top (Gatekeeper assesses the container
# too, and a stapled dmg validates offline).
#
#   scripts/package-native-app.sh                       # uses profile 'jkaindl'
#   KURO_NOTARY_PROFILE=other scripts/package-native-app.sh
#
# One-time notary setup (already done for 'jkaindl'):
#   xcrun notarytool store-credentials jkaindl --apple-id <id> --team-id U9X7M39R56
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/native/macos/build"
APP="$BUILD/KuroMetalApp.app"
DIST="$ROOT/dist-native"
# Asset name kept stable across releases + matching README/MACOS-INSTALL.md.
OUT="$DIST/KuroScreensaver-native-app-macos.dmg"
NOTARY_PROFILE="${KURO_NOTARY_PROFILE:-jkaindl}"
SIGN_ID="${KURO_SIGN_ID:-Developer ID Application: Johannes Kaindl (U9X7M39R56)}"

# 1. Build + Developer-ID-sign the app (build-native-app.sh handles signing).
echo "── building + signing app ──"
bash "$ROOT/scripts/build-native-app.sh"

if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  echo "✗ Developer ID '$SIGN_ID' not found — can't notarize. Aborting." >&2
  echo "  (Without it the app is only ad-hoc signed and Gatekeeper blocks it on other Macs.)" >&2
  exit 1
fi

mkdir -p "$DIST"

# 2. Notarize (submit a zip of the signed app, wait for the verdict).
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "✗ no notarytool profile '$NOTARY_PROFILE'. Set it up once:" >&2
  echo "  xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <id> --team-id U9X7M39R56" >&2
  exit 1
fi

# Re-verify the signature right before submitting — a broken/missing signature is a
# guaranteed Apple rejection, so fail fast locally instead of round-tripping to Apple.
echo "── re-verifying signature before notarize ──"
codesign --verify --strict "$APP" || { echo "✗ codesign verify failed — not submitting" >&2; exit 1; }

echo "── notarizing (profile $NOTARY_PROFILE; this takes a few minutes) ──"
NZIP="$BUILD/KuroMetalApp-notarize.zip"
ditto -c -k --keepParent "$APP" "$NZIP"

# Retry transient notary failures (network / Apple 5xx) with backoff — mirrors the
# Release-upload retry in release.yml. The signed app stays on disk, so a failed run
# is resumable by simply re-running the script.
notarized=0
for attempt in 1 2 3 4; do
  if xcrun notarytool submit "$NZIP" --keychain-profile "$NOTARY_PROFILE" --wait; then
    notarized=1; break
  fi
  echo "⚠ notarization attempt $attempt failed" >&2
  if [ "$attempt" = 4 ]; then break; fi
  sleep $((attempt * 10))
done
rm -f "$NZIP"
[ "$notarized" = 1 ] || { echo "✗ notarization failed after 4 attempts — re-run to resume (app is signed on disk)" >&2; exit 1; }

# 3. Staple the ticket onto the .app so it validates offline.
echo "── stapling ──"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl -a -vvv -t exec "$APP" 2>&1 | head -3 || true   # Gatekeeper assessment (informational)

# 4. Wrap the stapled app in a signed + notarized dmg (drag-to-Applications).
echo "── building dmg ──"
STAGE="$BUILD/dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/KuroMetalApp.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT"
hdiutil create -volname "Kuro Screensaver" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
rm -rf "$STAGE"
codesign --force --sign "$SIGN_ID" "$OUT"

echo "── notarizing dmg (profile $NOTARY_PROFILE) ──"
dmg_notarized=0
for attempt in 1 2 3 4; do
  if xcrun notarytool submit "$OUT" --keychain-profile "$NOTARY_PROFILE" --wait; then
    dmg_notarized=1; break
  fi
  echo "⚠ dmg notarization attempt $attempt failed" >&2
  if [ "$attempt" = 4 ]; then break; fi
  sleep $((attempt * 10))
done
[ "$dmg_notarized" = 1 ] || { echo "✗ dmg notarization failed after 4 attempts — re-run to resume" >&2; exit 1; }
xcrun stapler staple "$OUT"
xcrun stapler validate "$OUT"

echo
echo "✓ notarized + stapled: $OUT"
echo "  Distribute this dmg; users open it → drag KuroMetalApp.app to /Applications → open."
ls -lh "$OUT"
