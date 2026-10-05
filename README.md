# Kuro Screensaver

> A retro-CRT 3D screensaver: eight seeded procedural scenes, a full synthetic
> CRT signal-degradation pass, a self-typing operator-under-attack terminal, and
> a procedural audio layer. Runs as a **native macOS screensaver** (live-rendered
> in Metal), a **real Windows `.scr`**, and in **any browser**.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-8a4dff?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/kuro-screensaver?gitea_url=https%3A%2F%2Fgit.jkaindl.de&style=flat-square&label=release&color=39ff7a)](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest)
[![macOS — Metal](https://img.shields.io/badge/macOS-Metal-39ff7a?style=flat-square&logo=apple&logoColor=060709)](native/macos)
[![Windows — .scr](https://img.shields.io/badge/Windows-.scr-0078d4?style=flat-square)](native/windows)
[![Web — three.js](https://img.shields.io/badge/Web-three.js-16e0e0?style=flat-square)](https://threejs.org)
[![Swift](https://img.shields.io/badge/Swift-6-f05138?style=flat-square&logo=swift&logoColor=fff)](native/macos)

<p align="center">
  <a href="https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest">
    <img alt="Download the macOS app" src="https://img.shields.io/badge/Download_macOS_App-39ff7a?style=for-the-badge&logo=apple&logoColor=060709">
  </a>
  &nbsp;
  <a href="https://pages.jkaindl.de/kuro-screensaver/">
    <img alt="Launch the web app" src="https://img.shields.io/badge/Launch_Web_App-16e0e0?style=for-the-badge&logo=pwa&logoColor=060709">
  </a>
</p>

<p align="center">
  <img alt="Kuro Screensaver — banking flight over procedural CRT terrain" src="docs/images/hero.jpg" width="820">
</p>

Started life as a browser engine (extracted from the `kuro-companion` Obsidian
plugin). **The headline is a full native rewrite in Metal** — a real, live-rendered
macOS screensaver: no WebView, no pre-rendered video, the whole engine running on
the GPU. The web build lives on for in-browser play and cross-platform packaging.

**New in v0.10.0 — Windows grows up.** The `.scr` gets the full settings dialog
(looks, seven CRT sliders, story & automation — parity with the macOS app),
multi-monitor support (one panoramic image spanning all displays, or per-monitor
scene/color/off), an **animated desktop wallpaper mode** with a tray icon
and a power policy that freezes it behind fullscreen apps, on battery, or when
locked — plus a render-scale + adaptive-quality package against dropped frames.

**v0.6.0 — the world reacts to the story.** As the operator's shift escalates
(`ROUTINE → INTRUSION → ALARM → PANIC`), the 3D world tightens with it: the fog closes
in, the CRT degrades, the camera hesitates when something is noticed, a storm builds,
and an "enemy" colour bleeds into the geometry — a subtle build that pays off near
PANIC and is released by the crash. On web + native.

Earlier (v0.4.x): web↔native feature parity — analog-CRT pass, dynamic banking flight,
one-click Looks, a cinematic 5-layer matrix rain (also a selectable **MATRIX** scene),
plus a native flat-HUD toggle and richer preset colours.

---

## Gallery

Eight seeded procedural scenes, each recolorable by any of 13 phosphor presets:

<table>
  <tr>
    <td width="50%"><img alt="Terrain" src="docs/images/scene-terrain.jpg" width="380"><br><sub><b>TERRAIN</b> — seam-free infinite wireframe landscape, banking flythrough</sub></td>
    <td width="50%"><img alt="City" src="docs/images/scene-city.jpg" width="380"><br><sub><b>CITY</b> — banking down a neon-wireframe corridor</sub></td>
  </tr>
  <tr>
    <td><img alt="The Rift" src="docs/images/scene-rift.jpg" width="380"><br><sub><b>THE RIFT</b> — barrel-roll dynamics through a fracture</sub></td>
    <td><img alt="Tunnel" src="docs/images/scene-tunnel.jpg" width="380"><br><sub><b>TUNNEL</b> — banking flight down a Catmull-Rom spine</sub></td>
  </tr>
  <tr>
    <td><img alt="Void" src="docs/images/scene-void.jpg" width="380"><br><sub><b>VOID</b> — flythrough an asteroid belt (depth fade-in)</sub></td>
    <td><img alt="Matrix" src="docs/images/scene-matrix.jpg" width="380"><br><sub><b>MATRIX</b> — multi-layer 3D-depth digital rain</sub></td>
  </tr>
  <tr>
    <td><img alt="Metro" src="docs/images/scene-metro.jpg" width="380"><br><sub><b>METRO</b> — a real OpenStreetMap district as a CRT wireframe city</sub></td>
    <td><img alt="Wreckage" src="docs/images/scene-wreckage.jpg" width="380"><br><sub><b>WRECKAGE</b> — drifting debris field, evasive flight</sub></td>
  </tr>
</table>

<p align="center">
  <img alt="Live dynamic banking flight" src="docs/images/motion.gif" width="320"><br>
  <sub>Live engine — dynamic banking flight over the terrain (Toxic Haze)</sub>
</p>

<p align="center">
  <img alt="The narrative terminal in its Apple-Lisa center-window layout" src="docs/images/terminal-window.jpg" width="820"><br>
  <sub>The narrative terminal in its <b>Apple-Lisa center-window</b> layout (also available as a bottom strip or full-width band)</sub>
</p>

### 13 phosphor presets

<p align="center"><img alt="All 13 color presets" src="docs/images/presets.jpg" width="820"></p>

<sub>Kuro · Neural Bleed · Rust Signal · Toxic Haze · Biolink · Ghost Protocol ·
Voidwitch · Circuit · Crimson · Phosphor · Ember · Spectre · Pearl</sub>

---

## The story that never repeats the same way

Each run is a CORP compliance operator's shift, told through the narrative
terminal: `ROUTINE → INTRUSION → ALARM → PANIC → SILENCE`. An encrypted
"ghostlink" backchannel to a former instructor (**INSTR-KARSEN**) answers in
koans — growing guarded, then silent, as things worsen; HQ turns automated and
hollow; the operator drafts, hesitates, and deletes. Every shift differs (role ×
trait × HQ tier × which exchanges fire). When the shift ends the system
**crashes** — a choreographed CRT collapse to a power-off line, black, then an
unstable reboot into a fresh shift with a new persona.

<p align="center"><img alt="The diegetic CRT crash sequence" src="docs/images/crash-sequence.jpg" width="820"></p>

<sub>Signal failure → glitch storm → power-off collapse → dead screen → reboot →
new shift. In the pre-rendered video screensaver this black moment is also the
seamless loop point — the loop is diegetic, not a hidden crossfade.</sub>

---

## Download

### macOS — native app · **notarized** (recommended)

The live Metal screensaver as a standalone app — full procedural variation,
every CRT effect, the whole narrative.

**[↓ KuroScreensaver-native-app-macos.dmg](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest)** → open, drag **KuroMetalApp.app** to `Applications`, launch. Turn on **auto-start-on-idle** in its settings to use it as a real screensaver.

> Notarized + stapled with a Developer ID — it opens cleanly, no Gatekeeper
> warning. Requires macOS 14+ (Apple Silicon).

### Windows 11 (`.scr` + animated wallpaper)

A real `.scr` — since **v0.9.0** a tiny native host (~270 KB zip, no bundled
runtime; the old ~65 MB .NET package is history). WebView2 does the rendering
and is built into Windows 11 (on Windows 10 the host shows a download link if
it's missing). It understands multi-monitor setups, and ships an **animated
desktop wallpaper** as its own app (`KuroWallpaper.exe`, since **v0.11.0**) with
its own settings.

| Download | Run |
|---|---|
| [↓ KuroScreensaver-Setup.exe](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest) | Easiest: one-click installer, per-user, no admin rights. |
| [↓ KuroScreensaver-windows.zip](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest) | Manual: unzip into a folder you keep, right-click `KuroScreensaver.scr` → **Install**. |

Full steps + troubleshooting: **[docs/WINDOWS-INSTALL.md](docs/WINDOWS-INSTALL.md)**.

Or just play it in a browser: **[pages.jkaindl.de/kuro-screensaver](https://pages.jkaindl.de/kuro-screensaver/)**.

All versions: **[releases page](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases)**.

> The Windows `.scr` is unsigned, so SmartScreen warns on first run — click
> **"More info" → "Run anyway"** (once). Full notes: [docs/WINDOWS-INSTALL.md](docs/WINDOWS-INSTALL.md).
>
> The old macOS `.saver` builds (pre-rendered video `.saver`s + the legacy WebGL
> `.app`/`.saver`) were **retired in v0.5.0** — the notarized native app above
> replaces them.

---

## Features

- **Eight procedural 3D scenes** — `TERRAIN · CITY · THE RIFT · TUNNEL · VOID ·
  WRECKAGE · METRO` plus a static **MATRIX** rain scene. **METRO** flies a real
  OpenStreetMap district, baked at build time so the saver stays fully offline. **Dynamic banking flight**: a weaving camera
  that banks into its turns (adjustable strength, always-level start) with
  occasional eased maneuvers; seam-free infinite terrain; a Catmull-Rom tunnel
  spine; barrel rolls in The Rift. Same seed → same run.
- **Narrative terminal** — the full operator's-shift story (INSTR-KARSEN
  ghostlink, HQ escalation drafts, hesitations, last words) driven by a realistic
  typewriter over a phase-modulated script bank, in three layouts: a bottom
  **strip**, a full-width **band**, or an **Apple-Lisa center-window**.
- **Retro-CRT suite** — screen curvature, aperture-grille phosphor mask, phosphor
  persistence trails, bloom + warm halation, NTSC dot-crawl, scanlines + vignette,
  a power-on flash, and a glitch chain (H-sync tear, V-roll, flicker, black
  frames, static) feeding the diegetic crash→reboot. One intensity knob, or
  per-effect sliders.
- **Looks** — one-click vibe presets (*Clean · Heavy CRT · Broken Terminal ·
  Vaporwave · Matrix*) that set every effect at once.
- **HUD overlay** — tactical info panels, crosshair, scene-label slab, real-time
  clock, plus a power-on + BIOS boot sequence.
- **Procedural audio** — a synthetic CRT hum + Carpenter-style soundscape. No
  audio assets.
- **Day/night + weather**, **13 color presets**, scene auto-cycle, and
  auto-start-on-idle (native app).
- **Multi-monitor (Windows)** — span one panoramic image across every display
  (portrait monitors show their tall slice of it), or configure each monitor
  individually: on with its own scene + color, random, or off.
- **Animated wallpaper (Windows)** — the engine behind your desktop icons, as
  its own app: a tray icon (pause / settings / autostart / quit), a settings tab
  with a complete set of values independent of the screensaver's, and a power
  policy that suspends it when hidden, frozen behind fullscreen apps, or on
  battery.
- **Performance controls** — render-scale slider plus adaptive quality that
  first dials back effects, then resolution, when frames drop.

<sub>Native macOS app: Swift + Metal (shaders compiled at runtime — no Xcode
needed). Web / cross-platform builds: TypeScript + three.js (WebGL2).</sub>

---

## Usage

- **macOS app** — launch `KuroMetalApp.app`: the config window has a live
  preview, one-click Looks, and every slider; **Start fullscreen** (Enter) runs
  the saver, **←/→** switch scenes with a warp transition, any other input
  exits. Enable *auto-start-on-idle* to use it as the real screensaver, or *Set
  as wallpaper* for an animated desktop.
- **Windows `.scr`** — right-click → **Install**, then configure via the
  Windows screensaver dialog (**Settings…**): scene/color/tempo, Looks, CRT
  sliders, story & automation, per-monitor setup, and the performance section.
  Every input exits the running saver.
- **Windows wallpaper** — Start menu → **Kuro Wallpaper** (from the ZIP:
  double-click `KuroWallpaper.exe`). It starts the wallpaper and opens its
  settings, where the **Wallpaper** tab holds a full set of values independent
  of the screensaver's. The tray icon pauses/resumes, opens settings, toggles
  autostart, and quits.
- **Browser** — [launch the web app](https://pages.jkaindl.de/kuro-screensaver/):
  `1–9` pick scenes, `←/→` cycle, `M` mutes, `P` pauses, `S` screenshots,
  **Esc** exits; the control bar (mouse) exposes everything else.

Details, troubleshooting, and the full Windows walkthrough:
[docs/WINDOWS-INSTALL.md](docs/WINDOWS-INSTALL.md) ·
[docs/MACOS-INSTALL.md](docs/MACOS-INSTALL.md).

---

## Build

### Native macOS app (Metal — Xcode-free)

```bash
bash scripts/build-native-app.sh       # build + sign → native/macos/build/KuroMetalApp.app
bash scripts/package-native-app.sh     # + notarize + staple → dist-native/ (needs a Developer ID)
bash scripts/run-native-tests.sh       # logic tests (assert-based, headless)
```

The renderer is verified headlessly by rendering frames to PNG
(`scripts/build-native-harness.sh`) — no window or real screensaver activation
needed.

### No build step

The native macOS app deliberately needs **no Xcode and no build system** beyond
`swiftc` — the Metal shaders ship as source and compile at runtime, so the
whole app builds from a plain shell script in seconds and stays reviewable as
text. (The web target does use Vite, but only as a bundler for three.js — the
engine itself is framework-free TypeScript.)

### Web app

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production bundle → dist/
npm run typecheck  # tsc --noEmit (run before committing src/ changes)
```

The web app exits on **Esc**; the native app exits on any input and keeps its
settings (scene, preset, effects, terminal layout, bank strength…) in a config
window with a live preview.

---


### Deterministic image sequences (dev)

`scripts/render-sequence.mjs` renders a scene as a PNG sequence that is reproducible from its
parameters: the engine keeps running on wall-clock APIs, but Playwright drives a faked clock
(`page.clock`, paused before the page loads and advanced by `1000/fps` ms per frame), seeds
`Math.random`, pins the engine seed via `?seed=` and switches the HUD off via `?hud=off`.
The crash sequence comes from the DEV-only `window.__kuro` hook, so the dev server must run.

```bash
npm run dev
node scripts/render-sequence.mjs --scene city --preset kuro --seed 7 --seconds 15 --fps 24
node scripts/render-sequence.mjs --scene city --crash forward --seconds 5   # or --crash reverse
node scripts/render-sequence.mjs --scene city --seconds 2 --check          # render twice, compare
```

Output goes to `render-out/<scene>-<preset>-s<seed>/` as `frame-NNNN.png` plus `bildfolge.json`
(parameters, time and sha256 per frame, provenance with the commit). `--check` reports
byte-identical frames or the maximum pixel difference; measured on Metal, two runs agree to
within 2/255 (GPU rounding in the post-FX chain), so a different Chromium or GPU may produce
different bytes from the same timeline. Needs `ffmpeg` for `--check`.

## Architecture at a glance

**Native (`native/macos/`)** — a platform-agnostic Metal renderer plus a thin host:

```
native/macos/
├── KuroNativeSaver/Core/   Platform-agnostic engine (Metal):
│   ├── Renderer · Shaders   scene pass → bloom/trails → CRT composite
│   ├── *Scene.swift         terrain · city · rift · tunnel · void · matrix
│   ├── CameraFly            banked weaving flight choreography
│   ├── Terminal · Script    the operator narrative (+ INSTR-KARSEN ghostlink)
│   ├── Hud · TextRenderer · FontAtlas   overlay + runtime CoreText glyph atlas
│   └── MatrixRain · Synth · Palette · …
├── KuroMetalApp/           Standalone macOS app host (CAMetalLayer + CVDisplayLink)
└── harness/                Headless PNG render harness for verification
```

**Web (`src/`)** — the original engine is **plugin-shaped but framework-free**
(it never `import`s from `obsidian`); `host-web/` fulfils the host contract in
the browser, so the same bundle backports into the Obsidian plugin unchanged.

```
src/engine/   controller · engine/scenes · fx/crt-sim · audio/synth · terminal · hud · data
src/host-web/ plugin-shim · persistence (localStorage) · obsidian-dom-polyfill
```

Conventions for contributors and AI assistants are in [`AGENTS.md`](AGENTS.md);
design history is under [`docs/specs/`](docs/specs/).

---

## Compatibility

- **macOS 14+** — the native app (Apple Silicon; Metal). The 60 fps cap
  and adaptive quality keep it smooth on weaker GPUs.
- **Modern browsers** — the web app: Chromium ≥ 90, Firefox ≥ 90, Safari ≥ 14,
  WebGL2 required.

---

## License

- **Code** — [GNU AGPL-3.0](LICENSE): copyleft with the network-use clause. If
  you host this engine (or a fork) so others can use it over a network, the
  source of your variant must also be available under the AGPL.
- **Documentation, diagrams and images** in this repository —
  [CC BY-SA 4.0](LICENSE-DOCS).

A **commercial license** is available for uses the AGPL does not fit (a
proprietary product, a closed-source service, an App Store build) — see
[`LICENSING.md`](LICENSING.md). Contributions are made under the
[Contributor License Agreement](CLA.md); see [`CONTRIBUTING.md`](CONTRIBUTING.md)
to get started and [`SECURITY.md`](SECURITY.md) to report a vulnerability.
Release history: [`CHANGELOG.md`](CHANGELOG.md).

### Third-party data

The **METRO** scene is seeded by a small real-world building district baked from
**OpenStreetMap** at build time (`scripts/bake-osm-district.mjs` →
`src/engine/data/osm-district.json`). Map data © OpenStreetMap contributors,
licensed under the [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
Only vector building footprints are used — no imagery.
