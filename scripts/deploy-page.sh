#!/usr/bin/env bash
# Deploy the built screensaver page to pages.jkaindl.de.
#
# Builds dist/ and rsyncs it to the pages server (/srv/pages/kuro-screensaver/,
# served at https://pages.jkaindl.de/kuro-screensaver/). Replaces the old
# Codeberg Pages flow (throwaway .git + force-push of a `pages` branch).
#
# Auth is via the dedicated deploy key behind the `pages-deploy` SSH host alias
# (~/.ssh/config) — restricted server-side to rsync into /srv/pages only.
#
# Requires real rsync 3.x — macOS ships openrsync, which is incompatible with
# the server-side rrsync wrapper: brew install rsync
#
# Usage:
#   bash scripts/deploy-page.sh

set -euo pipefail

RSYNC="${RSYNC:-/opt/homebrew/bin/rsync}"
# No pipe here: grep -q + pipefail would turn rsync's SIGPIPE into a failure.
case "$("$RSYNC" --version 2>/dev/null || true)" in
  *"version 3."*) ;;
  *)
    echo "ERROR: $RSYNC is not rsync 3.x (macOS openrsync won't work): brew install rsync" >&2
    exit 1
    ;;
esac

DEST="pages-deploy:kuro-screensaver/"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree not clean — commit or stash before deploying." >&2
  exit 1
fi

echo "=== Building (npm run build) ==="
npm run build

DIST="$REPO_ROOT/dist"
if [[ ! -f "$DIST/index.html" ]]; then
  echo "ERROR: dist/index.html missing after build." >&2
  exit 1
fi

echo ""
echo "=== Publishing dist/ via rsync ==="
"$RSYNC" -az --delete --chmod=D755,F644 "$DIST"/ "$DEST"

echo ""
echo "✓ Deployed. Live: https://pages.jkaindl.de/kuro-screensaver/"
