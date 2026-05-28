# Native Screensaver Port — Design

**Date:** 2026-05-28
**Status:** Approved (design), implementation in progress
**Topic:** Port the standalone browser screensaver to native macOS (`.saver`)
and Windows (`.scr`) screensavers, offered as downloads.

---

## Goal

Ship the existing Retro-CRT 3D screensaver as **real OS screensavers** for
macOS and Windows, downloadable from the project's Codeberg presence. The
WebGL render engine is reused unchanged — only a thin native WebView host per
platform plus a dedicated "screensaver mode" web entry are added.

## Decisions (ratified with user, 2026-05-28)

| Topic | Decision |
|---|---|
| Format | Real OS screensavers: macOS `.saver` + Windows `.scr` |
| Granularity | **One artifact per platform**, scene selectable in OS options |
| Default behavior | **Random scene per activation** (override to fixed scene or auto-cycle in options) |
| Audio | **Off by default**, enableable in options |
| Signing | **Unsigned for v1** (users dismiss a Gatekeeper/SmartScreen warning); signing later |
| Windows build | **CI runner** (no Windows machine) |
| Download delivery | **Codeberg Releases** assets + download buttons on the Pages site / README |
| Content loading | **Bundled offline** (assets shipped inside the wrapper), not a live URL |

## Approach (chosen)

**Shared web "screensaver mode" + thin native WebView wrappers.** The built
web app is embedded *inside* each native screensaver and loaded from a local
file (offline). The native shell loads `screensaver.html`, passes options
(scene/audio) as URL query params, and does nothing else. Rejected
alternative: live-URL wrappers (need network while idle, phone home, fail
offline).

---

## Architecture

### 1. Web — screensaver-mode entry (fully buildable locally)

A second Vite page, separate from the existing demo landing page:

- `screensaver.html` — minimal page, no start button.
- `src/screensaver/main.ts` — auto-starts the controller:
  - Reads `URLSearchParams`: `scene` (`random`|`terrain`|`city`|`rift`|`tunnel`|`void`), `audio` (`on`|`off`).
  - `scene=random` (default) → pick from `SCENES[]`.
  - `audio` default `off` → `sound.master=false`.
  - `liveHotkeysEnabled=false` (the OS exits on any input anyway).
  - Calls `mountScreensaver({ overrides, … })` then `controller.open({ scene })` immediately (no click gesture).
- `vite.config.ts` — add `screensaver.html` as a second `rollupOptions.input`. `index.html` stays the demo page.

**The engine itself (`controller.ts`, `engine/`) is not modified** — it already
supports `open({ scene })`, `autoCycle`, `sound.master`, and even has
WKWebView/iOS audio-unlock logic (`controller.ts:191`).

### 2. macOS `.saver` (requires Xcode — handed to user for the build)

- Swift `ScreenSaverView` subclass hosting a `WKWebView` that fills `bounds`.
- Loads bundled `screensaver.html` via `loadFileURL(_, allowingReadAccessTo:)`.
- `configureSheet` options panel: scene dropdown (Random + 5 scenes) + audio toggle, persisted via `ScreenSaverDefaults`, passed to the WebView as URL query.
- Built with **Xcode** (`xcodebuild`). The dev box has only CommandLineTools — `ScreenSaver.framework` is absent, so this build runs on the user's machine after installing Xcode, or on a macOS CI runner. Codeberg hosted CI is Linux-only and cannot build it.

### 3. Windows `.scr` (cross-buildable; spike first)

- .NET WinForms app (borderless fullscreen form) hosting the **WebView2** control, loading the same bundled `screensaver.html`.
- Standard `.scr` arg handling: `/s` (run fullscreen), `/c` (config dialog), `/p <hwnd>` (preview).
- Options dialog → registry → URL query. WebView2 Evergreen Runtime ships on current Win10/11; note a bootstrapper in the download text for old installs.
- **Build:** `dotnet publish -r win-x64`, then rename the produced `.exe` to `.scr`. Target validation: cross-build on macOS/Linux (no Windows). `dotnet` installable via `brew`.

### 4. Config flow

```
OS options panel → persisted defaults → URL query (?scene=…&audio=…)
  → src/screensaver/main.ts reads URLSearchParams → overrides
  → mountScreensaver → controller.open()
```

### 5. Build, CI & distribution

- `npm run build` emits `dist/screensaver.html` (+ shared chunks) alongside the demo page.
- Packaging scripts:
  - `scripts/package-macos.sh` — `xcodebuild` → `KuroScreensaver.saver` → zip (runs where Xcode exists).
  - `scripts/package-windows.sh` — `dotnet publish -r win-x64` → rename `.scr`.
- CI on git tag:
  - Windows `.scr`: built in CI (Linux cross-build if it holds, else GitHub Windows runner).
  - macOS `.saver`: built locally / on a macOS runner and uploaded.
  - Both attached as **Codeberg Release assets** via the API (token in `Authorization` header — verified working from this environment 2026-05-28).
- Page/README: download buttons pointing at the latest release.

---

## Toolchain reality (dev box, 2026-05-28)

| Tool | Status | Consequence |
|---|---|---|
| node v24 | present | Web entry builds + typechecks fully autonomously |
| dotnet | absent (brew-installable) | Windows cross-build spike can be verified here |
| Xcode / `xcodebuild` | absent (only CommandLineTools; no `ScreenSaver.framework`) | macOS `.saver` build handed to user (install Xcode) |
| brew | present | used to install dotnet |

## Autonomy boundary (what needs the user)

1. **macOS `.saver` build** — install Xcode, run `scripts/package-macos.sh`. Code is scaffolded autonomously; only the build needs Xcode.
2. **CI activation + secrets** — enable Codeberg/Forgejo Actions (or set up the GitHub-mirror fallback) and add the release token secret.
3. **Release creation** — tag + publish; asset upload uses the verified token API.

Everything else (web screensaver entry, Windows project + verified cross-build, packaging scripts, CI YAML, download UI) is done autonomously.

## Risks / validate first

1. **WinForms `dotnet publish -r win-x64` cross-build on non-Windows** — spike before building the full host; fallback = GitHub Windows runner.
2. **WKWebView + WebGL2 inside the sandboxed `legacyScreenSaver` process** (modern macOS) — test on real activation, not just the System Settings preview.
3. **WebView2 runtime absence** on old Windows — document a bootstrapper in the download notes.

## Out of scope (v1)

- Code signing / notarization (deferred).
- Multi-monitor independent scenes on Windows (v1: primary display).
- Linux screensaver formats.
- Per-scene separate artifacts (one file with selection chosen instead).
