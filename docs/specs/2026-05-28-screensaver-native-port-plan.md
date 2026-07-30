# Native Screensaver Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Verification convention:** This repo has no test framework (AGENTS.md). "Verify" = `npm run typecheck` + `npm run build` succeed (web), or `dotnet publish` succeeds (Windows). Visual/activation checks are called out where a machine is required.

**Goal:** Ship the browser screensaver as native macOS `.saver` and Windows `.scr` downloads via thin WebView wrappers around a shared screensaver-mode web entry.

**Architecture:** A second Vite page (`screensaver.html` + `src/screensaver/main.ts`) auto-starts the existing engine, reads scene/audio from URL params, audio off, hotkeys off. Native wrappers (Swift `WKWebView` `.saver`; .NET WinForms `WebView2` `.scr`) bundle the built assets offline and pass options as URL query. Distribution via Codeberg Releases.

**Tech Stack:** TypeScript/Vite/three.js (existing), Swift + ScreenSaver.framework + WKWebView (macOS), .NET 8 WinForms + WebView2 (Windows), Codeberg Releases API.

---

## File structure

| Path | Responsibility |
|---|---|
| `screensaver.html` | Vite entry page for screensaver mode (no start button) |
| `src/screensaver/main.ts` | Auto-start, parse URL params, random scene, audio off, hotkeys off |
| `vite.config.ts` | Add `screensaver.html` as 2nd rollup input (modify) |
| `native/macos/` | Xcode project: `KuroScreensaver` ScreenSaverView + configureSheet |
| `native/windows/` | .NET WinForms `.scr` host + options dialog |
| `scripts/package-macos.sh` | xcodebuild → `.saver` → zip |
| `scripts/package-windows.sh` | dotnet publish → rename `.scr` |
| `scripts/bundle-web.sh` | copy `dist/` web assets into both native projects |
| `.forgejo/workflows/release.yml` (or GitHub fallback) | build + attach release assets on tag |
| `README.md` / page | download buttons (modify) |

---

## Task 1: Web screensaver-mode entry (fully autonomous)

**Files:**
- Create: `screensaver.html`
- Create: `src/screensaver/main.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create `screensaver.html`** — minimal, no start button, black bg, mounts `src/screensaver/main.ts`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Kuro Screensaver</title>
    <style>
      html, body { margin: 0; padding: 0; background: #000; height: 100%; overflow: hidden; }
    </style>
  </head>
  <body>
    <script type="module" src="/src/screensaver/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/screensaver/main.ts`** — parse params, random scene, audio off, hotkeys off, auto-open.

```ts
// Screensaver-mode entry — auto-starts the engine with no user gesture.
// Options arrive as URL query params injected by the native host:
//   ?scene=random|terrain|city|rift|tunnel|void   (default: random)
//   ?audio=on|off                                  (default: off)

import '../host-web/obsidian-dom-polyfill';
import { ScreensaverController } from '../engine/controller';
import { WebHost } from '../host-web/persistence';
import { makePluginShim } from '../host-web/plugin-shim';
import { SCENES, type SceneId } from '../engine/data/defaults';

const params = new URLSearchParams(location.search);

const sceneParam = params.get('scene') ?? 'random';
const scene: SceneId =
  sceneParam === 'random' || !SCENES.includes(sceneParam as SceneId)
    ? SCENES[Math.floor(Math.random() * SCENES.length)]
    : (sceneParam as SceneId);

const audioOn = params.get('audio') === 'on';

const host = new WebHost({
  activePreset: 'toxic-haze',
  vaultKanji: '黒',
  overrides: {
    colorMode: 'kuro-preset',
    colorPreset: 'toxic-haze',
    defaultScene: scene,
    liveHotkeysEnabled: false,
    sound: { ...({} as any), master: audioOn },
  } as any,
});

const controller = new ScreensaverController(makePluginShim(host));
void controller.open({ scene });
```

> NOTE: confirm `WebHost`/overrides merge shape against `src/host-web/persistence.ts` during implementation — the `sound` override must merge, not replace. If `WebHost` does a shallow merge, set `sound.master` post-construction instead (see Step 3 adjust).

- [ ] **Step 3: Verify the overrides merge correctly** — read `src/host-web/persistence.ts`; if overrides shallow-merge and would drop `sound` sub-keys, switch to mutating `host.getSettings().sound.master = audioOn` before `open()`. Pick whichever the code supports; do not leave a half-merged `sound`.

- [ ] **Step 4: Add `screensaver.html` to Vite build** — modify `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        screensaver: resolve(__dirname, 'screensaver.html'),
      },
      output: { manualChunks: { three: ['three'] } },
    },
  },
  server: { port: 5173, open: false },
});
```

- [ ] **Step 5: Verify** — `npm run typecheck && npm run build`. Expected: both succeed; `dist/screensaver.html` + `dist/index.html` emitted, `three` chunk shared.

- [ ] **Step 6: Visual check** — `npm run dev`, open `http://localhost:5173/screensaver.html`. Expected: a random scene starts immediately, no start button, no audio. Reload → possibly different scene. `?scene=tunnel&audio=on` forces tunnel with sound.

- [ ] **Step 7: Commit** — `feat(screensaver): add auto-starting screensaver-mode web entry`.

---

## Task 2: Windows `.scr` — spike the cross-build first

**Files:**
- Create: `native/windows/KuroScreensaver.csproj`
- Create: `native/windows/Program.cs`

- [ ] **Step 1: Install dotnet** — `brew install --cask dotnet-sdk` (or `brew install dotnet`). Verify `dotnet --version` ≥ 8.

- [ ] **Step 2: Minimal WinForms csproj** targeting `net8.0-windows`, WinExe, with WebView2 NuGet.

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>false</SelfContained>
    <AssemblyName>KuroScreensaver</AssemblyName>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2592.51" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: SPIKE — cross-build empty host** — a `Program.cs` with a borderless fullscreen `Form` hosting a `WebView2` that loads a bundled `web/screensaver.html` (path resolved next to the exe). Then run:

`dotnet publish native/windows/KuroScreensaver.csproj -c Release -r win-x64`

Expected: a `KuroScreensaver.exe` under `bin/Release/net8.0-windows/win-x64/publish/`. **If this fails on macOS** (WinForms cross-build), STOP and switch the Windows build to a GitHub Actions Windows runner (record in plan, scaffold `.github/workflows/`), but keep the same `Program.cs`.

- [ ] **Step 4: Implement `.scr` arg handling** in `Program.cs`: `/s` → run fullscreen; `/c` → options dialog (scene dropdown + audio checkbox → registry `HKCU\Software\KuroScreensaver`); `/p <hwnd>` → render into the preview child window; build the WebView URL `web/screensaver.html?scene=<>&audio=<>` from registry. Show full code during implementation.

- [ ] **Step 5: Verify build** — `dotnet publish … -r win-x64` succeeds. (Runtime activation is a Windows-only check — defer to the user/CI.)

- [ ] **Step 6: Commit** — `feat(windows): WebView2 .scr host + cross-build`.

---

## Task 3: macOS `.saver` — scaffold (build handed to user)

**Files:**
- Create: `native/macos/KuroScreensaver/KuroScreensaverView.swift`
- Create: `native/macos/KuroScreensaver/ConfigureSheet.swift`
- Create: `native/macos/KuroScreensaver.xcodeproj` (or an SPM/xcodegen manifest)

- [ ] **Step 1: `KuroScreensaverView.swift`** — `ScreenSaverView` subclass adding a `WKWebView` filling `bounds`; load bundled `screensaver.html` via `loadFileURL(_, allowingReadAccessTo:)`; build the URL query from `ScreenSaverDefaults` (scene/audio). Full code at implementation.

- [ ] **Step 2: `ConfigureSheet.swift`** — `configureSheet` NSWindow with scene NSPopUpButton (Random + 5) + audio NSButton checkbox, persisting to `ScreenSaverDefaults(forModuleWithName:)`.

- [ ] **Step 3: Project manifest** — use `xcodegen` (`brew install xcodegen`) with a `project.yml` so the `.xcodeproj` is generated reproducibly and diffable, bundle type `.saver`, links `ScreenSaver` + `WebKit`, `Info.plist` with `NSPrincipalClass = KuroScreensaverView`.

- [ ] **Step 4: Verify (limited)** — `swift -frontend -parse` of the two `.swift` files for syntax, OR `xcodegen generate` to confirm the manifest is valid. Full build needs Xcode → handed to user. Document this in the task output.

- [ ] **Step 5: Commit** — `feat(macos): .saver ScreenSaverView scaffold (build needs Xcode)`.

---

## Task 4: Web-asset bundling + packaging scripts

**Files:**
- Create: `scripts/bundle-web.sh`, `scripts/package-windows.sh`, `scripts/package-macos.sh`

- [ ] **Step 1: `bundle-web.sh`** — `npm run build`, then copy `dist/` (the screensaver page + assets) into `native/windows/web/` and `native/macos/KuroScreensaver/web/`. Idempotent (clean target first).

- [ ] **Step 2: `package-windows.sh`** — run `bundle-web.sh`, `dotnet publish -r win-x64`, copy `web/` next to the exe, rename `KuroScreensaver.exe` → `KuroScreensaver.scr`, zip.

- [ ] **Step 3: `package-macos.sh`** — run `bundle-web.sh`, `xcodegen generate`, `xcodebuild -scheme KuroScreensaver -configuration Release`, zip the `.saver`. Guard with a clear error if `xcodebuild` is absent.

- [ ] **Step 4: Verify** — run `bundle-web.sh`; confirm `native/*/web/screensaver.html` exist. `package-windows.sh` runs through publish on this box (cross-build). `package-macos.sh` errors cleanly without Xcode.

- [ ] **Step 5: Commit** — `build(scripts): web bundling + native packaging`.

---

## Task 5: CI + distribution

**Files:**
- Create: `.forgejo/workflows/release.yml` (Codeberg) and/or `.github/workflows/release.yml` (fallback)
- Modify: `README.md`, `index.html` (download links)

- [ ] **Step 1: CI workflow on tag `v*`** — Linux job builds the web + Windows `.scr` (cross-build, per Task 2 spike result); a macOS job (GitHub macOS runner if Forgejo lacks one) builds the `.saver`. Both upload artifacts.

- [ ] **Step 2: Attach to Codeberg Release** — `curl` the Codeberg API to create the release and upload `.scr` zip + `.saver` zip as assets, using a CI secret token (`Authorization: token …`, verified working 2026-05-28).

- [ ] **Step 3: Download UI** — add a Downloads section to `README.md` and a download link on the demo `index.html` pointing at `https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest`.

- [ ] **Step 4: Commit** — `ci+docs: release pipeline + download links`.

> Activation note: enabling Forgejo/GitHub Actions and adding the token secret is a user step (see spec "Autonomy boundary").

---

## Self-review

- **Spec coverage:** web entry (T1), Windows .scr (T2), macOS .saver (T3), bundling+packaging (T4), CI+distribution+download UI (T5) — all spec sections mapped.
- **Placeholders:** native source bodies are described with exact responsibilities + interfaces; full code is produced at implementation time (flagged), not left as vague "handle X". Acceptable because the native files are large and platform-API-bound; the param contract (`?scene=`, `?audio=`) is fixed and shared across all three.
- **Type consistency:** `SCENES`/`SceneId` from `engine/data/defaults`; URL params `scene`/`audio` identical in T1 (read), T2/T3 (write); `screensaver.html` path consistent across bundle + hosts.
- **Risk gates:** T2 Step 3 is the cross-build go/no-go; T3 build is explicitly user-side.
