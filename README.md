# Kuro Screensaver

> A standalone retro-CRT 3D screensaver engine — five seeded procedural
> scenes, a synthetic CRT signal-degradation pass, a self-typing narrative
> terminal, and a full Web Audio layer. Runs in any modern browser. No
> framework, no backend.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-8a4dff?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![three.js](https://img.shields.io/badge/three.js-0.164-000000?style=flat-square)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?style=flat-square)](https://vitejs.dev)

<p align="center">
  <a href="https://jkaindl.codeberg.page/kuro-screensaver/">
    <img alt="Launch the web app" src="https://img.shields.io/badge/Launch_Web_App-16e0e0?style=for-the-badge&logo=pwa&logoColor=060709">
  </a>
</p>

<p align="center">
  <img alt="Kuro Screensaver — procedural CRT terrain" src="docs/images/hero.jpg" width="100%">
</p>

Extracted from the `kuro-companion` Obsidian plugin into a focused,
browser-hosted engine. The standalone is the primary development line —
the plugin gets changes backported only when needed. Designed for static
hosting (Codeberg Pages) and for embedding on a homepage.

---

## Gallery

Five seeded procedural scenes, each recolored by any of 13 phosphor presets:

<table>
  <tr>
    <td width="50%"><img alt="Terrain" src="docs/images/scene-terrain.jpg"><br><sub><b>TERRAIN</b> — seam-free infinite wireframe landscape</sub></td>
    <td width="50%"><img alt="The Rift" src="docs/images/scene-rift.jpg"><br><sub><b>THE RIFT</b> — barrel-roll dynamics through a fracture</sub></td>
  </tr>
  <tr>
    <td><img alt="City" src="docs/images/scene-city.jpg"><br><sub><b>CITY</b> — drifting wireframe towers</sub></td>
    <td><img alt="Tunnel" src="docs/images/scene-tunnel.jpg"><br><sub><b>TUNNEL</b> — banking flight down a Catmull-Rom spine</sub></td>
  </tr>
  <tr>
    <td><img alt="Void" src="docs/images/scene-void.jpg"><br><sub><b>VOID</b> — suspended particle fields</sub></td>
    <td valign="center"><sub>Same seed → same run. The renderer recolors the
    entire material pool in a single pass on a preset switch.</sub></td>
  </tr>
</table>

<p align="center">
  <img alt="Live motion" src="docs/images/motion.gif" width="70%"><br>
  <sub>Live engine — terrain flythrough (Ember preset)</sub>
</p>

### 13 phosphor presets

<p align="center"><img alt="All 13 color presets" src="docs/images/presets.jpg" width="100%"></p>

<sub>Kuro · Neural Bleed · Rust Signal · Toxic Haze · Biolink · Ghost Protocol ·
Voidwitch · Circuit · Crimson · Phosphor · Ember · Spectre · Pearl</sub>

---

## The loop that never repeats the same way

Each run is a CORP operator's shift, told through the narrative terminal:
`ROUTINE → INTRUSION → ALARM → PANIC → SILENCE`. When the shift ends the
system **crashes** — a choreographed CRT collapse to a power-off line, then
black, then an unstable reboot into a fresh shift with a new persona.

<p align="center"><img alt="The diegetic CRT crash sequence" src="docs/images/crash-sequence.jpg" width="100%"></p>

<sub>Signal failure → glitch storm → power-off collapse → dead screen → reboot →
new shift. In the pre-rendered video screensaver, this black moment is also the
seamless loop point — the loop is diegetic, not a hidden crossfade.</sub>

---

## Download — native builds

The same engine ships natively for both platforms:

| Platform | Download | Run |
|---|---|---|
| **Windows** (`.scr` screen saver) | **[↓ windows.zip](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest)** | Unzip, right-click `KuroScreensaver.scr` → **Install**. Needs the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on current Win10/11). |
| **macOS** (`.saver`, one per preset) | **[↓ pick a preset](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest)** (`Kuro <Preset>.saver.zip`) | Download the preset(s) you want, unzip, copy the `.saver` into `~/Library/Screen Savers/`, then pick it in **System Settings ▸ Screen Saver**. Pre-rendered video loops — a real screensaver. |
| **macOS** (live `.app`) | **[↓ macos.zip](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest)** | The live WebGL engine in a fullscreen window (full procedural variation). Unsigned → clear quarantine once: `xattr -dr com.apple.quarantine KuroScreensaver.app`. **Esc**/**⌘Q** exits. |

All versions: **[releases page](https://codeberg.org/jkaindl/kuro-screensaver/releases)**.

> **Why both a `.saver` and an `.app` on macOS?** WebGL doesn't composite inside
> macOS's sandboxed screen-saver process, so the *live* engine can't run as a
> real `.saver`. The video `.saver` sidesteps this by playing a pre-rendered
> loop (AVFoundation video composites fine there) — a true screensaver that
> starts on idle. The `.app` keeps the live, fully procedural engine for when
> you want it.

Builds are **unsigned** — macOS Gatekeeper / Windows SmartScreen will ask you
to confirm on first run.

---

## What it does

- **Five seeded procedural 3D scenes** — `TERRAIN · CITY · THE RIFT ·
  TUNNEL · VOID`. Logical-offset chunk tiling for seam-free infinite
  landscapes; a curved Catmull-Rom tunnel spine with banking flight;
  barrel-roll dynamics in The Rift. Same seed → same run.
- **Narrative terminal** — a bottom strip that types itself out: a
  scripted persona working a shift, driven by a realistic typing engine
  (typos, hesitations, abandoned lines) over a phase-modulated script
  bank. Ends each shift with a diegetic system crash (see above).
- **CRT simulation** — a composite signal-degradation post-pass:
  H-sync tear, V-roll, brightness flicker, black-frame drops, VHS-style
  rolling band, chromatic spikes, wave distortion, static bursts,
  scanline pulse / hum bar / interlace flicker. One intensity knob drives
  the whole chain.
- **HUD overlay** — DOM info panels, sweeping radar, scrolling terminal,
  crosshair, vault kanji (黒), real-time clock, scene-label slab, plus a
  power-on boot sequence.
- **Synthetic audio** — a fully procedural Web Audio layer (CRT hum,
  scanline whine, boot beeps, scene-switch whoosh, jet crescendo on
  tunnel boost, sonar ping). No audio assets.
- **13 color presets** — phosphor palettes in `engine/data/presets.ts`.
  The renderer recolors the whole material pool in one pass on a switch.

---

## Quickstart

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
# … or
npm run build      # production bundle → dist/
npm run preview    # serve the built bundle locally
npm run typecheck  # tsc --noEmit (run before committing src/ changes)
```

Open the page and hit **▶ Start Screensaver**. It goes fullscreen; press
**Esc** to exit.

To re-render the video screensavers (needs a GPU + ffmpeg):

```bash
npm run dev &                              # serve the screensaver entry
node scripts/render-saver-videos.mjs       # one looping H.265 clip per preset
```

---

## Controls

| Key       | Action                          |
|-----------|---------------------------------|
| `1`–`5`   | Switch scene                    |
| `M`       | Mute / unmute audio             |
| `P`       | Pause / resume                  |
| `S`       | Screenshot                      |
| `Esc`     | Exit fullscreen / close         |
| any other | Close the screensaver           |

---

## Architecture at a glance

The engine is **plugin-shaped but framework-free**: it never `import`s
from `obsidian`. The host contract it depends on (`HostPlugin`) is
declared locally in `controller.ts`. In the browser, `host-web/`
fulfils that contract — settings live in `localStorage` and the few DOM
helpers Obsidian adds to `HTMLElement` (`createEl` / `createDiv` /
`createSpan` / `empty`) are polyfilled. The same engine bundle can
therefore be backported into the Obsidian plugin unchanged.

```
src/
├── main.ts                       Standalone browser entry (sane non-Obsidian defaults)
├── screensaver/main.ts           Screensaver-mode entry (?preset= / ?scene= / ?storyScale=)
├── host-web/                     Web host — bridges the plugin-shaped engine to the browser
│   ├── plugin-shim.ts            Fulfils the HostPlugin contract (settings tree + saveData)
│   ├── persistence.ts            Settings in localStorage
│   └── obsidian-dom-polyfill.ts  Polyfills createEl / createDiv / createSpan / empty
└── engine/                       The screensaver engine (no `import` from 'obsidian')
    ├── controller.ts             Overlay lifecycle, hotkeys, fullscreen; declares HostPlugin
    ├── engine/                   THREE renderer (inner namespace — intentional doubling)
    │   ├── core.ts               Renderer + composer + scene manager + frame loop
    │   ├── color.ts              Color resolver (kuro-preset / custom)
    │   ├── materials.ts          Material pool (recolor / dispose en masse)
    │   ├── rng.ts                Seeded LCG
    │   └── scenes/               terrain · city · rift · tunnel · void (+ scene-base)
    ├── fx/crt-sim.ts             CRT signal-degradation post-pass (+ the crash sequence)
    ├── audio/synth.ts            Synthetic Web Audio layer
    ├── terminal/                 Bottom-strip narrative (narrative · persona · typing · script-bank)
    ├── hud/                      DOM overlay (index + boot sequence)
    └── data/                     Static config (defaults · dictionary · presets)
```

Native builds live in `native/` (Windows `.scr`, macOS video `.saver` +
live `.app`); the video render + `.saver` pipeline is in `scripts/`.
Conventions for AI assistants and contributors live in
[`AGENTS.md`](AGENTS.md). Design history is under [`docs/specs/`](docs/specs/).

---

## Deployment

The build is a static `dist/` — it can be served from anywhere. The repo
ships two helper scripts for the Codeberg setup:

```bash
# Publish dist/ to the `pages` branch → https://jkaindl.codeberg.page/kuro-screensaver/
bash scripts/deploy-page.sh

# Push the source repo to Codeberg (SSH — no token needed)
bash scripts/push-to-codeberg.sh
```

Both scripts authenticate via SSH (your Codeberg SSH key); no token is
required or stored. Codeberg serves any branch named exactly `pages`
automatically.

---

## Compatibility

- **Modern browsers** — Chromium ≥ 90, Firefox ≥ 90, Safari ≥ 14.
- **WebGL2** required (three.js renderer).
- **Desktop-oriented** — uses `requestFullscreen` and `AudioContext`;
  audio starts on the first user gesture (the Start button).

---

## License

[GNU AGPL-3.0](LICENSE) — copyleft with the network-use clause. If you
host this engine (or a fork) so others can use it over a network, the
source of your variant must also be available under the AGPL.
