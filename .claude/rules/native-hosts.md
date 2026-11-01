---
paths:
  - "native/**"
  - "scripts/build-native-app.sh"
  - "scripts/run-native-tests.sh"
---

# Native Hosts — macOS, Windows, Linux

Aufbau und Stand der nativen Hosts unter `native/`, dazu die Abweichung zum Linux-Options-Code und die Stilllegung der `.saver`-Pfade. Lädt, sobald unter `native/` gearbeitet wird. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert).

## Abweichung: Linux kopiert den Options-Code

- **Der Linux-Host kopiert den Options-Code des Windows-Hosts, statt ihn zu teilen.**
  Begruendet unter "Native builds": der Windows-Host ist durchgaengig `std::wstring` und
  MSVC-only, lokal nicht baubar; Teilen hiesse, *ausgelieferten* Code umzuschreiben, den
  niemand hier kompilieren kann. Gehalten wird die Kopplung stattdessen ueber das
  gemeinsame Fixture `native/shared/query-contract.txt` — eine Zusage mit Test statt einer
  Zusage mit Kommentar.

## Native builds (`native/`)

- **macOS** — a standalone fullscreen **Metal app** (`native/macos/KuroMetalApp/`
  + the shared engine in `native/macos/KuroNativeSaver/Core/`). The whole engine
  runs live on the GPU (no WebView, no pre-rendered video). Built with `swiftc`
  (no Xcode) via `scripts/build-native-app.sh` (deployment floor **macOS 14** — the render loop uses `NSView.displayLink`/CADisplayLink); notarized + uploaded to the release
  locally via `scripts/package-native-app.sh`. Dev tools live alongside Core:
  `harness/` (headless PNG renders), `tests/`, `tools/`.
- **Windows** — a real `.scr` (`native/windows/host/`, C++/Win32 + WebView2
  hosting `screensaver.html`; the `/c` dialog hosts `settings.html`). MSVC-only:
  built via CMake in CI (`windows-host.yml` on push for the dev loop,
  `release.yml` for releases) — there is no local macOS build. Package is
  `KuroScreensaver.scr` + `web/` (<5 MB; the .NET WinForms host and its
  self-contained runtime were removed in v0.9.0). Optional Inno Setup installer
  (`native/windows/installer/KuroScreensaver.iss`) compiles on the Windows CI
  runner. Persistent settings (scene/colour/speed/FX/HUD) live in
  `HKCU\Software\KuroScreensaver` and are bridged web↔.scr via query params
  (`src/screensaver/params.ts`; dialog: `src/settings/`). Requires the WebView2
  runtime (inbox on Windows 11; the host shows a download link if missing).
  Install steps: `docs/WINDOWS-INSTALL.md`.
- **Linux** — *in progress, one task of nine done.* A GTK3/WebKitGTK-4.1 host in C++
  (`native/linux/host/`), a deliberate twin of the Windows host down to the file names: one
  binary, four modes (`--wallpaper`, `--fullscreen`, `--window-id`, `--config`), shipped as a
  `.deb`. First target is Linux Mint 22.3 Xfce/X11 — chosen because that is the machine
  available for acceptance; Wayland is deferred. Settings live in
  `$XDG_CONFIG_HOME/kuro-screensaver/settings.ini`, whose keys are the **registry names of the
  Windows host** — one vocabulary, two backends.
  **What exists today:** `src/options.{h,cpp}` — the pure half (INI + the pinned query
  contract) — and `src/render_policy.{h,cpp}`, the visibility/power decision table. Neither
  carries GTK/X11, so both build and test anywhere, which is why they were written before the
  window work; `ci.yml`'s `linux-host` job builds and runs them on every push. The windowing,
  WebKit and dialog halves need the real machine and are not written. The policy's *signals*
  (VisibilityNotify, DPMS, upower) are part of that unwritten half — what exists is the table
  they will feed.
  **The policy table is the third port**, after Windows and `Core/RenderPolicy.swift`, and it
  follows those two rather than the plan: both shipped hosts treat *occluded* as **Hidden**
  (zero wakeups), while the plan's draft had it as Frozen. On a desktop, occluded is the normal
  case — any maximised window — so a held frame nobody can see would have been exactly the cost
  the policy exists to avoid, and the plan's test pinned it. It carries one input neither twin
  has, `hadFirstFrame`, ordered *before* the invisibility check: freezing or hiding with nothing
  painted yet leaves an opaque rectangle over the desktop picture, which is the macOS v0.11.0
  bug one storey down.
  **Why the options code is copied from Windows rather than shared:** that host is
  `std::wstring` throughout, and sharing would force a rewrite of the *released*, MSVC-only
  host that cannot be built locally. The contract is held by a shared fixture instead.

**Deprecated 2026-06-03 (v0.5.0):** all macOS `.saver` paths were removed — the
WebGL `.saver`/`.app` scaffold (`KuroScreensaverApp`/`KuroScreensaver`), the live
native `.saver` host (`KuroNativeSaver/Host`), and the 13 pre-rendered video
`.saver`s (`KuroVideoSaver`). macOS Tahoe's sandboxed `legacyScreenSaver` process
broke live GPU compositing; the notarized native app replaces all of them. The
xcodegen `project.yml` + the `package-macos.sh`/`build-native-saver.sh`/
`build-video-savers.sh`/`upload-video-assets.sh`/`render-saver-videos.mjs` scripts
are gone too.
