#!/usr/bin/env bash
# Push helper for the animation/ standalone repo to Codeberg
# (kuro-screensaver). Uses SSH (your Codeberg SSH key) — no token needed.
#
# Ensures origin points at the SSH URL, then pushes main with upstream
# tracking. Safe to run repeatedly (idempotent).
#
# Usage:
#   bash scripts/push-to-codeberg.sh
#
# Optional env:
#   CODEBERG_USER  (default: jkaindl)
#   CODEBERG_REPO  (default: kuro-screensaver)

set -euo pipefail

USER="${CODEBERG_USER:-jkaindl}"
REPO="${CODEBERG_REPO:-kuro-screensaver}"
SSH_URL="git@codeberg.org:$USER/$REPO.git"

cd "$(cd "$(dirname "$0")/.." && pwd)"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$SSH_URL"
else
  git remote add origin "$SSH_URL"
fi
echo "origin -> $(git remote get-url origin)"

echo "Pushing main…"
git push -u origin main

echo ""
echo "✓ Done."
echo "Verify with:"
echo "  git ls-remote origin | head -3"
