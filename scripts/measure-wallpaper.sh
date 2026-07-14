#!/usr/bin/env bash
# Measure the wallpaper mode's CPU cost: launches `--wallpaper` with a fixed
# scene/preset (deterministic load), samples the process CPU% once per second,
# prints avg/max. GPU + package power need root → the matching powermetrics
# command is printed at the end for a manual sudo run.
#
# NOTE: stop any already-running wallpaper instance first (▦ menu → "Hintergrund
# beenden"), otherwise two instances render at once and the numbers are garbage.
#
#   scripts/measure-wallpaper.sh [SECONDS]   # default 60
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUR="${1:-60}"
APP="$ROOT/native/macos/build/KuroMetalApp.app/Contents/MacOS/KuroMetalApp"
[ -x "$APP" ] || bash "$ROOT/scripts/build-native-app.sh"

"$APP" --wallpaper --scene terrain --preset toxic-haze &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
sleep 8   # settle: boot overlay + window setup

echo "sampling ${DUR}s (pid $PID)…"
samples="$(for _ in $(seq 1 "$DUR"); do ps -o %cpu= -p "$PID" 2>/dev/null || break; sleep 1; done)"
echo "$samples" | awk '{s+=$1; if ($1>m) m=$1; n++}
  END {if (n==0) {print "no samples — app died?"; exit 1}
       printf "CPU avg %.1f%%  max %.1f%%  (n=%d)\n", s/n, m, n}'

echo
echo "GPU/Power/Wakeups (manuell, braucht sudo — bitte Johannes):"
echo "  sudo powermetrics -i 1000 -n 20 --samplers gpu_power,tasks 2>/dev/null | grep -E 'GPU Power|KuroMetalApp'"
