#!/usr/bin/env bash
# Single-source version bump: writes package.json + the native app Info.plist
# together so release versions can't drift apart (they did once — a stale plist
# shipped as "1.0"). Run before tagging a release.
#
#   bash scripts/bump-version.sh 0.4.2
#
# - package.json  → "version": "<ver>"
# - Info.plist    → CFBundleShortVersionString = <ver>, CFBundleVersion += 1
#
# macOS-only (uses PlistBuddy). Releases are cut locally on macOS anyway.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-}"
[ -n "$VER" ] || { echo "usage: $0 <version>   e.g. $0 0.4.2" >&2; exit 1; }
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ version must be X.Y.Z (got '$VER')" >&2; exit 1; }

PLIST="$ROOT/native/macos/KuroMetalApp/Info.plist"
PKG="$ROOT/package.json"

# Pre-flight: BOTH targets must exist and be writable before we touch anything, so a
# mid-run failure can never leave one file bumped and the other stale (drifted
# versions are the exact bug this script exists to prevent).
for f in "$PKG" "$PLIST"; do
  [ -f "$f" ] || { echo "✗ missing $f" >&2; exit 1; }
  [ -w "$f" ] || { echo "✗ not writable: $f" >&2; exit 1; }
done

# Stage edits into temp copies in the same dirs (so the final commit is an atomic
# rename), validate them, and only then move both into place. trap cleans temps up
# on any early exit, leaving the originals untouched.
PKG_TMP="$(mktemp "$ROOT/.bump.pkg.XXXXXX")"
PLIST_TMP="$(mktemp "$(dirname "$PLIST")/.bump.plist.XXXXXX")"
trap 'rm -f "$PKG_TMP" "$PLIST_TMP"' EXIT

# package.json → version (preserve key order + 2-space indent + trailing newline)
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('$PKG'));p.version='$VER';fs.writeFileSync('$PKG_TMP',JSON.stringify(p,null,2)+'\n')"

# Info.plist → short version = VER, build number = previous + 1 (read from original)
cp "$PLIST" "$PLIST_TMP"
CUR=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST_TMP")
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VER" "$PLIST_TMP"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $((CUR + 1))" "$PLIST_TMP"

# Validate the staged temps BEFORE committing either.
GOT_PKG=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG_TMP','utf8')).version)")
GOT_SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST_TMP")
GOT_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST_TMP")
[ "$GOT_PKG" = "$VER" ]            || { echo "✗ staged package.json version mismatch ($GOT_PKG ≠ $VER)" >&2; exit 1; }
[ "$GOT_SHORT" = "$VER" ]          || { echo "✗ staged Info.plist short version mismatch ($GOT_SHORT ≠ $VER)" >&2; exit 1; }
[ "$GOT_BUILD" = "$((CUR + 1))" ]  || { echo "✗ staged Info.plist build mismatch ($GOT_BUILD ≠ $((CUR + 1)))" >&2; exit 1; }

# Commit both via atomic rename (same filesystem). Each rename is individually atomic;
# two separate files can't be made transactional, so we re-read BOTH afterwards and
# fail loudly if they disagree — a loud drift error beats the silent stale-plist-as-1.0
# bug this script exists to prevent.
mv "$PKG_TMP" "$PKG"
mv "$PLIST_TMP" "$PLIST"
trap - EXIT

FIN_PKG=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PKG','utf8')).version)")
FIN_SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")
if [ "$FIN_PKG" != "$VER" ] || [ "$FIN_SHORT" != "$VER" ]; then
  echo "✗ version drift after write: package.json=$FIN_PKG, Info.plist=$FIN_SHORT (wanted $VER)" >&2
  echo "  re-run to repair: bash scripts/bump-version.sh $VER" >&2
  exit 1
fi

echo "✓ version → $VER   (package.json + Info.plist; CFBundleVersion $CUR → $((CUR + 1)))"
echo "  next: git commit -am 'chore(release): v$VER' && git tag v$VER && git push origin main v$VER"
