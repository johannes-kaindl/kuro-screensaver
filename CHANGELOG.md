# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases live on the [Forgejo instance](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases);
the Windows `.scr` and installer are attached by CI, the notarized macOS app is
built and attached locally (CI holds no Developer ID certificate).

Entries before v0.12.0 were reconstructed from the tag history in 2026-08-30,
when this file was first added — they summarise each release rather than
recording it as it happened.

## [Unreleased]

### Changed

- **The automatic scene change is off by default on every platform.** It had
  been on in all three native hosts and off on the web since v0.10, while those
  hosts promised in their own headers to reproduce the web defaults. Anyone who
  never opened the settings loses the automatic scene change on upgrade.
- **macOS: the day/night cycle is on by default**, and the scene-change interval
  is 5 minutes instead of 30 seconds — both were macOS-only deviations from the
  engine. Anyone who never opened the settings will see the slow brightness
  cycle they did not see before.
- macOS weather now speaks the same vocabulary as the web and Windows:
  `light-fog` (the scene default, previously called `clear` natively),
  `clear` (thin fog) and `heavy-fog` were added; the settings dropdown grew
  from three entries to five. The default picture is unchanged.

### Added

- A Linux host is in progress: `native/linux/host/` (GTK3/WebKitGTK, first
  target Linux Mint 22.3 Xfce/X11). So far only the settings/query half exists.
- `native/shared/query-contract.txt` — the query that unchanged defaults must
  produce, pinned once and read by all four hosts' tests.
- Story content is loaded from a single JSON source on both web and native
  (`src/engine/data/story-content.json`), with a parity guard over the
  remaining hand-maintained Swift literals.

### Fixed

- Tests, typecheck and the native logic tests now run on every push instead of
  only on a version tag — the gap that let two releases ship a break that had
  been in the tree for weeks.
- The README claimed six scenes; there are eight (METRO and WRECKAGE were
  missing from the gallery and the count).

## [0.11.1] — 2026-08-20

### Fixed

- macOS: the animated wallpaper stayed black — `occlusionState` is unusable at
  desktop window level, and `.frozen` without a first frame is an opaque sheet.

### Added

- **METRO scene** — a flyover of a real OpenStreetMap district, baked at build
  time so the screensaver stays fully offline.

## [0.11.0] — 2026-07-16

### Added

- Windows: the wallpaper is its own application (`KuroWallpaper.exe`) with its
  own icon, its own settings tab, single-instance behaviour and a bilingual
  installer — the shell discards arguments on `.scr` shortcuts, so a mode flag
  could never reach it.
- A `[Pause]` control in the settings dialog.

### Fixed

- 13 bugs found by three review passes, among them enum validation for fields
  an inactive tab never renders, and monitor cards writing modes they were
  never touched for.

## [0.10.1] — 2026-07-16

### Fixed

- Windows: the wallpaper mode was unreachable from the shell; native binaries
  received paths they could not resolve; Git-Bash mangled the installer
  compiler's arguments.

## [0.10.0] — 2026-07-16

### Added

- Windows wave 2: spanning and per-monitor saver windows, a DPI-correct
  settings dialog, `/w` wallpaper mode with tray icon and power policy.
- A full macOS-parity settings dialog (Looks, CRT sliders, monitors, performance).
- Engine: kiosk mode, render scale with adaptive downscaling, power bridge.

### Fixed

- 21 confirmed findings from a pre-release adversarial review, across engine,
  dialog and host.

## [0.9.1] — 2026-07-15

### Fixed

- Windows: `/p` paints a static preview frame; the binary carries VERSIONINFO.

## [0.9.0] — 2026-07-15

### Changed

- **Windows: the .NET host was replaced by a C++ micro-host** (~270 KB `.scr`
  hosting WebView2), removing the self-contained .NET runtime from the package.
- The `/c` settings dialog hosts an HTML settings page.

## [0.8.0] — 2026-07-15

### Changed

- macOS: CADisplayLink frame pacing, raising the deployment floor to macOS 14.
- Wallpaper render scale (default 0.66) and a power policy covering occlusion,
  lock, sleep, low-power mode and thermal pressure — measured at roughly a 40 %
  CPU reduction.

## [0.7.1] — 2026-07-14

### Fixed

- Windows: the `.scr` died without the .NET 8 Desktop Runtime — the publish is
  self-contained again.

## [0.7.0] — 2026-06-30

### Added

- Story arcs with per-arc threat curves, driving divergent corruption stages
  and endings.
- Windows: persistent settings (scene, colour, speed, FX, HUD) bridged to the
  `.scr`, plus an optional Inno Setup installer built by CI.

## [0.6.0] — 2026-06-04

### Added

- Reactive narrative world on web and native: fog and CRT escalation, camera
  hesitation and enemy-colour infection driven by the narrative threat level.

## [0.5.0] — 2026-06-03

### Removed

- **All macOS `.saver` paths.** Tahoe's sandboxed `legacyScreenSaver` process
  broke live GPU compositing; the notarized native app replaces the WebGL
  `.saver`, the live native `.saver` and the 13 pre-rendered video savers.

### Added

- `prefers-reduced-motion` support.

## [0.4.1] — 2026-06-03

### Added

- MATRIX as a selectable scene (pure rain, matching the native side).

## [0.4.0] — 2026-06-03

### Added

- The analog-CRT pass on the web: curvature, aperture grille, NTSC shimmer,
  halation.
- Dynamic banking flight, one-click "Looks" bundles, a cinematic five-layer
  matrix rain, and a flat HUD/terminal overlay option.

## [0.3.0] — 2026-06-03

### Added

- Bank-strength control with continuous, level-start flight; a full-width
  bottom terminal band with a height slider.

## [0.2.5] — 2026-05-30

### Added

- Thirteen pre-rendered video savers, one per preset, each with its own
  principal class so it plays its own video.
- A Gatekeeper / first-run guide for the unsigned builds.

## [0.1.6] — 2026-05-29

### Added

- Fog view-distance control.

## [0.1.0] — 2026-05-28

### Added

- First cross-platform release: macOS build and Windows `.scr`, built and
  published by GitHub Actions.

[Unreleased]: https://git.jkaindl.de/jkaindl/kuro-screensaver/compare/v0.11.1...main
[0.11.1]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.11.1
[0.11.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.11.0
[0.10.1]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.10.1
[0.10.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.10.0
[0.9.1]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.9.1
[0.9.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.9.0
[0.8.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.8.0
[0.7.1]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.7.1
[0.7.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.7.0
[0.6.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.6.0
[0.5.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.5.0
[0.4.1]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.4.1
[0.4.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.4.0
[0.3.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.3.0
[0.2.5]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.2.5
[0.1.6]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.1.6
[0.1.0]: https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/tag/v0.1.0
