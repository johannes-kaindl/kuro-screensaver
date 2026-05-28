#!/usr/bin/env bash
# Push helper for the animation/ standalone repo to Codeberg
# (kuro-screensaver). Sets origin to a clean (token-free) URL and pushes
# with the token embedded only in the push URL — so .git/config never
# carries the secret.
#
# Usage:
#   CODEBERG_TOKEN=xxxxxx bash scripts/push-to-codeberg.sh
#
# Optional env:
#   CODEBERG_USER  (default: jkaindl)

set -euo pipefail

TOKEN="${CODEBERG_TOKEN:-}"
USER="${CODEBERG_USER:-jkaindl}"

if [[ -z "$TOKEN" ]]; then
  cat >&2 <<EOF
ERROR: CODEBERG_TOKEN env var not set.

Example:
  CODEBERG_TOKEN=da6f602e19d3d87e54a654ac074a3904d019824b bash scripts/push-to-codeberg.sh
EOF
  exit 1
fi

push_repo() {
  local local_path="$1"
  local repo_name="$2"
  local clean_url="https://codeberg.org/$USER/$repo_name.git"
  local token_url="https://$USER:$TOKEN@codeberg.org/$USER/$repo_name.git"

  echo ""
  echo "=== $repo_name  ($local_path) ==="
  cd "$local_path"

  # Set origin to the clean URL (token-free) — idempotent.
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$clean_url"
  else
    git remote add origin "$clean_url"
  fi
  echo "origin -> $(git remote get-url origin)"

  # Push with the token URL one time only; origin stays clean.
  # NOTE: no -u — would leak the token into .git/config as branch.main.remote.
  # Upstream tracking is set explicitly below against the clean origin name.
  echo "Pushing main…"
  git push "$token_url" main
  git config "branch.main.remote" origin
  git config "branch.main.merge" "refs/heads/main"
}

push_repo /Users/Shared/code/kuro/animation                kuro-screensaver

echo ""
echo "✓ Done."
echo "Verify with:"
echo "  cd /Users/Shared/code/kuro/animation && git ls-remote origin | head -3"
