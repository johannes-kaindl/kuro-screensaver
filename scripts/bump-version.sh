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
[ -f "$PLIST" ] || { echo "✗ missing $PLIST" >&2; exit 1; }

# package.json (preserve key order + 2-space indent + trailing newline)
node -e "const f='$ROOT/package.json',fs=require('fs'),p=JSON.parse(fs.readFileSync(f));p.version='$VER';fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"

# Info.plist: short version = VER, build number = previous + 1
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VER" "$PLIST"
CUR=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST")
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $((CUR + 1))" "$PLIST"

echo "✓ version → $VER   (package.json + Info.plist; CFBundleVersion $CUR → $((CUR + 1)))"
echo "  next: git commit -am 'chore(release): v$VER' && git tag v$VER && git push origin main v$VER"
