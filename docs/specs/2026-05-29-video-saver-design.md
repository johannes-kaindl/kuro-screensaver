# Video-`.saver` — pre-rendered per-preset macOS screensavers

**Date:** 2026-05-29
**Status:** Design accepted, Phase 0 (render-proof) in progress

## Problem

WebGL does not composite in the sandboxed `legacyScreenSaver` process on
macOS (confirmed on-device, see `2026-05-28-screensaver-native-port-design.md`).
The current macOS shipping path is therefore a fullscreen **`.app`**, not a real
`.saver` — it must be launched manually and does not integrate with System
Settings or idle-start.

## Idea

A video plays through a completely different code path — native `AVPlayer` /
`AVPlayerLayer` (AVFoundation) — which **does** work in the screensaver
process (Apple's Aerial and most popular macOS savers are video-based). So:
pre-render the engine to a looping video and ship a real `.saver` that just
plays it.

## Decisions (2026-05-29, with user)

1. **Add, don't replace.** The video `.saver` is an *addition* — the live
   WebGL `.app` stays for users who want full procedural variation.
2. **One `.saver` per preset.** Instead of one `.saver` with a config sheet,
   ship `Kuro Toxic Haze.saver`, `Kuro Crimson.saver`, … Each bundle embeds a
   single loop video. macOS lists them all in System Settings — no Swift
   config UI needed.
3. **Diegetic loop via CRASH sequence.** The terminal narrative has a real
   dramatic arc (`narrative.ts`): `ROUTINE → INTRUSION → ALARM → PANIC →
   SILENCE → reset → ROUTINE`, a full cycle ~6-9 min. `SILENCE` is the story
   end ("final farewell"). Today `SILENCE → ROUTINE` does a silent `reset()`.
   We replace that with an **inszenierter CRT crash** (signal collapse →
   reboot flicker → fresh shift). This is a shared **engine feature** — it
   improves the live `.app` and Web build too, and gives the video a *designed*
   loop seam instead of a hidden crossfade.
4. **Rendered clip uses a shortened cycle (~2-3 min).** Phase durations scaled
   to ~⅓ for the render only; the live engine keeps the full 6-9 min arc.
   Keeps per-preset files ~50-90 MB at 1440p/H.265.

## Capture method — IMPORTANT

The screensaver is **WebGL canvas + DOM overlay layers** (CRT sim, HUD,
terminal narrative use `mix-blend-mode` / `overlayHost.appendChild`). Therefore
`canvas.captureStream()` is WRONG — it would capture only the 3D scene without
the CRT look, HUD, or story text.

Use **full-page composite capture**: Playwright `recordVideo` (records the
rendered viewport incl. DOM + WebGL), run **headful** so it uses the real Metal
GPU (avoids the SwiftShader fuzziness and the compositing limitation entirely).
Then `ffmpeg` → H.265 `.mov`, trimmed to loop exactly at the crash seam.

## Phases

| # | What | Risk |
|---|------|------|
| 0 | **Render-proof:** headful Chromium renders the engine → short video clip of one preset, verify WebGL + DOM overlays are all present and sharp | High — gates everything |
| 1 | **Crash-FX engine feature:** inszenierter CRT crash at `SILENCE` end, replaces silent reset (live + web + video) | Low |
| 2 | **`?preset=` param** in `screensaver/main.ts` (preset currently hardcoded to `toxic-haze`) + render-only story-duration scaling | Low |
| 3 | **Render pipeline** `scripts/render-saver-videos.mjs` — one ~2-3 min loop clip per preset → H.265 | Medium |
| 4 | **Video `.saver`** `native/macos/KuroVideoSaver/` — slim `AVPlayerLayer` ScreenSaverView, one build per preset | Medium |
| 5 | **CI/release** — render + multi-`.saver` build in GitHub Action | Low |

## Out of scope / open

- Windows: `.scr` already works via WebView2 (live). Video path is macOS-only
  for now.
- Multi-monitor / Retina resolution is baked into the rendered clip.
- Exact preset selection for shipping (all 13 vs a curated subset) — decide
  after Phase 0 proves file sizes.
