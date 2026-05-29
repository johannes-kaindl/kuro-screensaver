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

Extracted from the `kuro-companion` Obsidian plugin into a focused,
browser-hosted engine. The standalone is the primary development line —
the plugin gets changes backported only when needed. Designed for static
hosting (Codeberg Pages) and for embedding on a homepage.

---

## Download — native builds

The same engine ships natively for both platforms — a real screen saver on
Windows, and a fullscreen app on macOS:

| Platform | Download | Run |
|---|---|---|
| **Windows** (`.scr` screen saver) | **[↓ KuroScreensaver-windows.zip](https://codeberg.org/jkaindl/kuro-screensaver/releases/download/v0.1.6/KuroScreensaver-windows.zip)** | Unzip, right-click `KuroScreensaver.scr` → **Install**. Needs the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on current Win10/11). |
| **macOS** (fullscreen `.app`) | **[↓ KuroScreensaver-macos.zip](https://codeberg.org/jkaindl/kuro-screensaver/releases/download/v0.1.6/KuroScreensaver-macos.zip)** | Unzip, then (unsigned → clear the download quarantine once): `xattr -dr com.apple.quarantine KuroScreensaver.app` and double-click it. Move the mouse to reveal the cursor + on-screen controls (switch scene / toggle effects); **Esc** or **⌘Q** exits. |

All versions: **[releases page](https://codeberg.org/jkaindl/kuro-screensaver/releases)**.

> **Why an app on macOS, not a `.saver`?** WebGL doesn't composite inside
> macOS's sandboxed screen-saver process, so a real `.saver` stays blank. A
> normal app window renders the 3D engine correctly. (The `.saver` scaffold is
> kept in `native/macos/` for a possible future native rewrite.)

Builds are **unsigned** — macOS Gatekeeper / Windows SmartScreen will ask you
to confirm on first run.

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

---

## What it does

- **Five seeded procedural 3D scenes** — `TERRAIN · CITY · THE RIFT ·
  TUNNEL · VOID`. Logical-offset chunk tiling for seam-free infinite
  landscapes; a curved Catmull-Rom tunnel spine with banking flight;
  barrel-roll dynamics in The Rift. Same seed → same run.
- **Narrative terminal** — a bottom strip that types itself out: a
  scripted persona working a shift, driven by a realistic typing engine
  (typos, hesitations, abandoned lines) over a phase-modulated script
  bank.
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
- **Color presets** — phosphor palettes in `engine/data/presets.ts`
  (default: Toxic Haze). The renderer recolors the whole material pool in
  one pass on a preset switch.

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
├── host-web/                     Web host — bridges the plugin-shaped engine to the browser
│   ├── mount.ts                  Boots the engine; imports the DOM polyfill first
│   ├── plugin-shim.ts            Fulfils the HostPlugin contract (settings tree + saveData)
│   ├── persistence.ts            Settings in localStorage
│   └── obsidian-dom-polyfill.ts  Polyfills createEl / createDiv / createSpan / empty
└── engine/                       The screensaver engine (no `import` from 'obsidian')
    ├── controller.ts             Overlay lifecycle, hotkeys, fullscreen; declares HostPlugin
    ├── menubar.ts                Embed-pane control bar (unused standalone; kept for backport)
    ├── engine/                   THREE renderer (inner namespace — intentional doubling)
    │   ├── core.ts               Renderer + composer + scene manager + frame loop
    │   ├── color.ts              Color resolver (kuro-preset / custom)
    │   ├── materials.ts          Material pool (recolor / dispose en masse)
    │   ├── rng.ts                Seeded LCG
    │   └── scenes/               terrain · city · rift · tunnel · void (+ scene-base)
    ├── fx/crt-sim.ts             CRT signal-degradation post-pass
    ├── audio/synth.ts            Synthetic Web Audio layer
    ├── terminal/                 Bottom-strip narrative (narrative · persona · typing · script-bank)
    ├── hud/                      DOM overlay (index + boot sequence)
    └── data/                     Static config (defaults · dictionary · presets)
```

Conventions for AI assistants and contributors live in
[`AGENTS.md`](AGENTS.md). Design history is under
[`docs/specs/`](docs/specs/).

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
required or stored.

Codeberg serves any branch named exactly `pages` automatically; the
`deploy-page.sh` snapshot is force-pushed (no history kept on that
branch).

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
