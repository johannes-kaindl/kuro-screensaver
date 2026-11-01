---
paths:
  - "src/engine/**"
  - "src/host-web/**"
  - "scripts/bake-osm-district.mjs"
---

# Engine — Unterlayout

Aufbau von `src/engine/` samt gebackenen OSM-Daten. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert); lädt, sobald unter `src/engine/` oder `src/host-web/` gearbeitet wird.

- **Engine sub-layout** (note the doubled `engine/` is intentional —
  outer `engine/` is the library namespace, inner is the THREE-renderer):
  - `engine/{core,materials,rng,color,scenes/}` — render loop + scenes
  - `fx/crt-sim.ts` — CRT signal-degradation post-pass
  - `audio/synth.ts` — Web Audio synthesizer
  - `terminal/{narrative,persona,typing,script-bank}.ts` — bottom-strip narrative
  - `hud/{index,boot}.ts` — DOM overlay
  - `data/{defaults,dictionary,presets}.ts` — static config
  - `data/osm-district.json` — **baked at build time, never fetched.** The
    `metro` scene renders real OpenStreetMap building footprints, but the
    screensaver must run fully offline and the Windows `.scr` bundle has a
    <5 MB budget. `scripts/bake-osm-district.mjs` (dev-only, run by hand) does
    the Overpass query + projection + simplification and writes this file
    (~8 KB). Do not add a runtime fetch. Map data © OpenStreetMap
    contributors, ODbL 1.0 — attribution lives in the README.
  - `controller.ts` — overlay lifecycle, hotkeys, fullscreen; declares
    local `HostPlugin` interface
  - `menubar.ts` — embed-pane control bar (unused in standalone, kept for
    plugin backport)
  - `host.ts` — leftover `ScreensaverHost` interface from the 2026-05-26
    boundary refactor; not consumed by the rolled-back controller. Will
    be re-evaluated on the next sync roundtrip.
