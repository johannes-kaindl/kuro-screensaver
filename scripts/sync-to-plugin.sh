#!/usr/bin/env bash
# Sync the standalone Screensaver engine from animation/ to the kuro-theme-settings plugin.
#
# Direction: animation/src/engine/ → kuro-theme-settings/src/screensaver/
# Excludes:  embed-view.ts (plugin-only Obsidian view)
# Mode:      one-way (no reverse). Re-run after edits in animation/.
#
# Usage:
#   ./scripts/sync-to-plugin.sh           # dry-run preview
#   ./scripts/sync-to-plugin.sh --apply   # actually copy files
#
# History: between 2026-05-27 (Companion-Rollback) and the plugin reconciliation
# in feat/reconcile-with-companion-rollback, this script carried a hard guard
# that required --i-know-what-im-doing. The guard is gone now that the plugin
# is back in sync with the rolled-back engine.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/src/engine"
DST="/Users/Shared/code/kuro/kuro-theme-settings/src/screensaver"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: source $SRC not found." >&2
  exit 1
fi
if [[ ! -d "$DST" ]]; then
  echo "ERROR: destination $DST not found." >&2
  exit 1
fi

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

RSYNC_OPTS=(
  -rc                            # recursive + checksum-based (timestamp-blind)
  --delete                       # mirror deletions (e.g. removed host.ts/menubar would propagate)
  --exclude='embed-view.ts'      # plugin-only Obsidian view
)

if [[ $APPLY -eq 0 ]]; then
  echo "=== DRY RUN: files that would be copied animation/ → kuro-theme-settings/ ==="
  rsync "${RSYNC_OPTS[@]}" -n -v "$SRC/" "$DST/" | sed -E '/^building file list|^$|^sent |^total |^sending|wrote /d' | head -40
  echo ""
  echo "(Run with --apply to actually copy. Files listed above will be overwritten in target.)"
  exit 0
fi

echo "=== APPLY: copying animation/src/engine/ → kuro-theme-settings/src/screensaver/ ==="
rsync "${RSYNC_OPTS[@]}" -v "$SRC/" "$DST/" | sed -E '/^building file list|^$|^sent |^total |^sending|wrote /d' | head -40

echo ""
echo "=== Plugin-only files preserved ==="
ls "$DST"/host-obsidian.ts "$DST"/embed-view.ts 2>/dev/null

echo ""
echo "=== Next: cd /Users/Shared/code/kuro/kuro-theme-settings && npm run build:all to verify ==="
