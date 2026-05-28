#!/usr/bin/env bash
# Deploy the built screensaver to Codeberg Pages.
#
# Publishes dist/ to a `pages` branch of the kuro-screensaver repo. Codeberg
# serves any branch named exactly `pages` automatically, so the result lands at:
#   https://jkaindl.codeberg.page/kuro-screensaver/
#
# Mechanics: dist/ is gitignored in the main repo, so we drop a throwaway
# .git inside dist/, commit the build, force-push it as the `pages` branch,
# then remove the temp .git. The page branch is a snapshot (no history value),
# hence force-push.
#
# Usage:
#   CODEBERG_TOKEN=xxxxxx bash scripts/deploy-page.sh
#
# Optional env:
#   CODEBERG_USER  (default: jkaindl)
#   CODEBERG_REPO  (default: kuro-screensaver)

set -euo pipefail

TOKEN="${CODEBERG_TOKEN:-}"
USER="${CODEBERG_USER:-jkaindl}"
REPO="${CODEBERG_REPO:-kuro-screensaver}"

if [[ -z "$TOKEN" ]]; then
  cat >&2 <<EOF
ERROR: CODEBERG_TOKEN env var not set.

Example:
  CODEBERG_TOKEN=da6f602e19d3d87e54a654ac074a3904d019824b bash scripts/deploy-page.sh
EOF
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Building (npm run build) ==="
npm run build

DIST="$REPO_ROOT/dist"
if [[ ! -f "$DIST/index.html" ]]; then
  echo "ERROR: dist/index.html missing after build." >&2
  exit 1
fi

# Codeberg Pages serves files at the repo root of the `pages` branch. A
# .domains file is only needed for custom domains — skipped here.

echo ""
echo "=== Publishing dist/ to '$REPO' pages branch ==="
TOKEN_URL="https://$USER:$TOKEN@codeberg.org/$USER/$REPO.git"

pushd "$DIST" >/dev/null
rm -rf .git
git init -q
git checkout -q -b pages
git add -A
git -c user.name="deploy" -c user.email="deploy@local" \
    commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q --force "$TOKEN_URL" pages:pages
rm -rf .git
popd >/dev/null

echo ""
echo "✓ Pushed build to the 'pages' branch."
echo "  Live in ~1-2 min: https://$USER.codeberg.page/$REPO/"
echo ""
echo "If it 404s after a few minutes: confirm on Codeberg that the branch is"
echo "named exactly 'pages' and that the repo is not private (Pages needs a"
echo "public repo, or Pages enabled for private repos in repo settings)."
