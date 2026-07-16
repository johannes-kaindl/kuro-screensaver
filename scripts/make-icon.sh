#!/usr/bin/env bash
# Regenerate native/windows/host/assets/kuro.ico from the SVG sources.
#
# The .ico is COMMITTED, so this script is not part of any build — it exists so
# the icon stays reproducible instead of being a binary nobody can re-derive.
# Run it only when the artwork changes.
#
# Two sources on purpose: icons are drawn per size, not scaled. kuro-small.svg
# is the 16px cut (fewer strokes, heavier weights) — the full drawing's five
# vanishing lines smear together at tray size.
#
# Needs: rsvg-convert (brew install librsvg) + Python Pillow.
# Usage: bash scripts/make-icon.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/native/windows/host/assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v rsvg-convert >/dev/null || { echo "✗ rsvg-convert missing — brew install librsvg" >&2; exit 1; }

# 16 gets the simplified cut; everything above gets the full drawing.
rsvg-convert -w 16  -h 16  "$ASSETS/kuro-small.svg" -o "$TMP/16.png"
rsvg-convert -w 32  -h 32  "$ASSETS/kuro.svg"       -o "$TMP/32.png"
rsvg-convert -w 48  -h 48  "$ASSETS/kuro.svg"       -o "$TMP/48.png"
rsvg-convert -w 256 -h 256 "$ASSETS/kuro.svg"       -o "$TMP/256.png"

python3 - "$TMP" "$ASSETS/kuro.ico" <<'PY'
import sys
from PIL import Image

tmp, out = sys.argv[1], sys.argv[2]
# The LARGEST image must be the base: Pillow silently drops any requested size
# bigger than the base image, so saving from the 16px one yields a 451-byte ico
# containing nothing but 16px. append_images then keeps each smaller size's own
# drawing rather than resampling it from the base — which is the whole point of
# kuro-small.svg (verified below).
base = Image.open(f"{tmp}/256.png").convert("RGBA")
extra = [Image.open(f"{tmp}/{s}.png").convert("RGBA") for s in (16, 32, 48)]
base.save(out, format="ICO", sizes=[(256, 256), (48, 48), (32, 32), (16, 16)],
          append_images=extra)
print(f"✓ {out}")
PY

python3 - "$ASSETS/kuro.ico" "$TMP" <<'PY'
import sys
from PIL import Image

ico_path, tmp = sys.argv[1], sys.argv[2]

# Windows picks a size per context (16 tray, 32 start menu, 256 "Apps &
# Features"). A missing entry gets resampled from a neighbour and looks soft, so
# assert all four made it in.
with Image.open(ico_path) as im:
    got = sorted({s[0] for s in im.info["sizes"]})
want = [16, 32, 48, 256]
assert got == want, f"✗ ico has {got}, want {want}"

# And that the 16px entry is the SIMPLIFIED drawing, not the 256 squeezed down —
# if Pillow ever resamples instead of embedding, this is the only thing that
# would notice, and the tray icon is the one the user sees all day.
ico = Image.open(ico_path)
ico.size = (16, 16)
ico.load()
embedded = list(ico.convert("RGBA").getdata())
intended = list(Image.open(f"{tmp}/16.png").convert("RGBA").getdata())
assert embedded == intended, "✗ the 16px entry is not kuro-small.svg — Pillow resampled it"

print(f"✓ verified sizes: {got}; 16px is the simplified cut")
PY
