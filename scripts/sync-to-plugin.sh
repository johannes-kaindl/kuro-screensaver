#!/usr/bin/env bash
# Sync the standalone Screensaver engine from animation/ to the kuro-theme-settings plugin.
#
# Direction: animation/src/engine/ → kuro-theme-settings/src/screensaver/
# Excludes:  host-obsidian.ts, embed-view.ts (plugin-only files)
#            host.ts (leftover ScreensaverHost interface — unused post-rollback,
#                     and overwriting the plugin's host wiring would break it)
# Mode:      one-way (no reverse). Re-run after edits in animation/.
#
# Usage:
#   ./scripts/sync-to-plugin.sh                          # dry-run preview
#   ./scripts/sync-to-plugin.sh --apply                  # blocked (see GUARD)
#   ./scripts/sync-to-plugin.sh --apply --i-know-what-im-doing
#
# GUARD (2026-05-27): After the Companion-Rollback the animation engine is
# again Plugin-shaped (controller.ts expects a host object with .settings/.saveData/.app).
# The plugin still carries ObsidianScreensaverHost (host-obsidian.ts), a 26.5.
# adapter that wires the engine via the old ScreensaverHost interface — which
# this engine no longer accepts. Syncing without first reconciling the plugin
# side will break the plugin build. See:
#   docs/specs/2026-05-27-companion-rollback.md
# To override, pass --i-know-what-im-doing (acknowledges you've prepared the
# plugin side).

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
OVERRIDE=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --i-know-what-im-doing) OVERRIDE=1 ;;
  esac
done

if [[ $APPLY -eq 1 && $OVERRIDE -eq 0 ]]; then
  cat >&2 <<'EOF'
=== SYNC BLOCKED ===
After the 2026-05-27 Companion-Rollback the animation engine is incompatible
with kuro-theme-settings' current host wiring (host-obsidian.ts on the
26.5. ScreensaverHost interface). Syncing now would break the plugin build.

Read docs/specs/2026-05-27-companion-rollback.md first, then re-run with:
  ./scripts/sync-to-plugin.sh --apply --i-know-what-im-doing
EOF
  exit 2
fi

RSYNC_OPTS=(
  -rc                       # recursive + checksum-based (timestamp-blind)
  --exclude='host-obsidian.ts'   # plugin-only adapter
  --exclude='embed-view.ts'      # plugin-only Obsidian view
  --exclude='host.ts'            # leftover interface — see header
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
