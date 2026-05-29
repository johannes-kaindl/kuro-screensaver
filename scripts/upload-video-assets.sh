#!/usr/bin/env bash
# Upload the locally-rendered preset videos to a dedicated Codeberg "assets"
# release, so the CI .saver build can fetch them (rendering needs a real GPU and
# ~90 min — too expensive to redo on every CI run; the videos only change when
# the engine does).
#
# Each video is uploaded as its own asset (avoids any single-asset size cap and
# lets you re-upload just one preset). The CI downloads them from the fixed tag.
#
# Usage:  CODEBERG_TOKEN=xxxx bash scripts/upload-video-assets.sh
# Re-run after re-rendering; existing assets of the same name are replaced.

set -euo pipefail
cd "$(dirname "$0")/.."

: "${CODEBERG_TOKEN:?set CODEBERG_TOKEN (Codeberg access token with repo write)}"
API="https://codeberg.org/api/v1/repos/jkaindl/kuro-screensaver"
TAG="assets-videos"
VIDEO_DIR="render-out/videos"

shopt -s nullglob
videos=("$VIDEO_DIR"/kuro-*.mov)
[ ${#videos[@]} -gt 0 ] || { echo "✗ no videos in $VIDEO_DIR — render first" >&2; exit 1; }
echo "Uploading ${#videos[@]} video(s) to Codeberg release '$TAG' …"

# Create the asset release (ignore 409 if it already exists). Marked as a
# prerelease so it doesn't show as the project's latest user-facing release.
curl -sS -X POST "$API/releases" \
  -H "Authorization: token $CODEBERG_TOKEN" -H "Content-Type: application/json" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"Video assets (CI input)\",\"body\":\"Pre-rendered preset loops consumed by the .saver CI build. Not a user release.\",\"prerelease\":true}" \
  -o /dev/null -w "create release HTTP %{http_code}\n" || true

rel_id=$(curl -sS "$API/releases/tags/$TAG" -H "Authorization: token $CODEBERG_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
test -n "$rel_id"

for v in "${videos[@]}"; do
  name=$(basename "$v")
  existing=$(curl -sS "$API/releases/$rel_id/assets" -H "Authorization: token $CODEBERG_TOKEN" \
    | python3 -c "import sys,json; print(next((a['id'] for a in json.load(sys.stdin) if a['name']=='$name'), ''))")
  if [ -n "$existing" ]; then
    curl -sS -X DELETE "$API/releases/$rel_id/assets/$existing" \
      -H "Authorization: token $CODEBERG_TOKEN" -o /dev/null -w "  replace $name (del HTTP %{http_code}) " || true
  fi
  curl -sS --fail-with-body -X POST "$API/releases/$rel_id/assets?name=$name" \
    -H "Authorization: token $CODEBERG_TOKEN" -F "attachment=@$v" \
    -o /dev/null -w "upload $name HTTP %{http_code}\n"
done

echo "Done. CI fetches these from: $API/releases/tags/$TAG"
