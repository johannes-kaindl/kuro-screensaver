# AGENTS.md

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, `../_docs` relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain. Offene Punkte fuer
> dieses Repo siehe Abschnitt "Offene Konventions-Punkte".

Conventions for AI assistants working in this repo.

## Offene Konventions-Punkte

- [ ] CORE-META-02 — Badge-Zeile um Release- + CI-Badge ergaenzen, Reihenfolge Lizenz·Release·CI·Plattform·Downloads herstellen.
- [ ] CORE-META-04 — User-Manual nach Diátaxis (Tutorial/How-to/Reference/Explanation) anlegen und aus README verlinken.
- [ ] CORE-META-06 — `CHANGELOG.md` (keep-a-changelog), `CONTRIBUTING.md`, `SECURITY.md` ergaenzen.
- [ ] CORE-META-07 — `LICENSING.md` (Dual-License-Option) + `CLA.md` ergaenzen.
- [ ] CORE-META-08 — `LICENSE-DOCS` (CC BY-SA 4.0) fuer Doku/Texte hinzufuegen.
- [ ] CORE-META-10 — `keywords` in `package.json` setzen und Forge-Topics konsistent pflegen.
- [ ] CORE-AGENT-01 — Abschnitt "## Abweichungen von der Leitkonvention" in dieser Datei ergaenzen.
- [ ] CORE-AGENT-06 — `.editorconfig` (UTF-8, LF, trim-trailing, final-newline; 2-space default, 4-space TOML, Markdown ohne trim) anlegen.
- [ ] PROF-TS-01 — npm-Scripts `test` und `lint` ergaenzen (typecheck/build/dev vorhanden).

## What this is

Standalone Retro-CRT 3D Screensaver engine — extracted from the
`kuro-companion` Obsidian plugin (source lives in `kuro-theme-settings`).
Vite/TypeScript project, runs in any modern browser.

**Standalone repo since 2026-06-01** — moved out of the `kuro/` monorepo
subtree (was `../kuro/animation/`) to its own top-level project directory
in the maintainer's workspace. Git remotes, the GitHub
release CI, and the `sync-to-plugin.sh` DST path were unaffected by the move
(they use absolute paths / the unchanged `kuro-screensaver` repo name).

After the 2026-05-27 rollback (see
`docs/specs/2026-05-27-companion-rollback.md`), the engine is **Plugin-
shaped**: `controller.ts` expects a host object with a settings tree and
`saveData()`. The Plugin-type itself is declared locally in
`controller.ts` (`HostPlugin`), so the engine does NOT import
`obsidian` directly. The standalone Web-Host bridges this via
`src/host-web/plugin-shim.ts` (settings live in localStorage, see
`persistence.ts`). The Obsidian plugin uses its own real `Plugin`
instance — no shim needed there.

## Workflow conventions

- **Tests:** native logic tests via `bash scripts/run-native-tests.sh` (LCG parity,
  terrain/camera/palette sanity — run in CI). Web: typecheck + visual verification
  (`npm run dev`, or `node scripts/verify-crt.mjs` for headless CRT screenshots).
- **Typecheck:** `npm run typecheck` (must pass before commits touching `src/`).
- **Build:** `npm run build` → `dist/`.
- **Backport to plugin:** `./scripts/sync-to-plugin.sh --apply`, then in
  `kuro-theme-settings/`: `npm run build:all && npm run sync:v1 && npm run sync:v2`.
  **NOTE (post-rollback):** the sync script currently refuses to run without
  `--i-know-what-im-doing`, because the plugin still carries the 2026-05-26
  `ScreensaverHost` adapter (`host-obsidian.ts`) which is incompatible with
  the rolled-back engine. Decide a strategy first (see rollback spec).
- **Commit style:** Conventional Commits. AI-pair commits get a
  `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer.

## Memory

- **SDD artifacts (since 2026-07-16): Cockpit, not repo** — specs/plans/task reports live in
  the maintainer's coding cockpit (`$VAULT/25_Coding/kuro-screensaver/_SDD/`, CORE-META-14,
  maintainer-local). They carry working context (vault paths, sister-repo internals) that is
  of no use to anyone in a public repo. The repo keeps the design essence in this file +
  `CHANGELOG.md`.
- **Legacy stock:** `docs/specs/` and `docs/superpowers/{specs,plans}/` are frozen — do not
  add anything new there. Existing historical spec files stay where they are.
- **Never in the repo:** absolute paths outside the repo (`/Users/…`, vault paths) — use
  placeholders (`$VAULT/…`, `~/…`, repo-relative). Provenance as repo name + `file:line`
  is welcome, though.
  Gate: `scripts/check-no-abs-paths.mjs` (part of `npm test`).
- **Memory** (cross-session, outside the repo):
  `~/.claude/projects/-Users-Shared-code-kuro-screensaver/memory/`
  — index in `MEMORY.md`. See `animation-project.md`,
  `kuro-projekte-uebersicht.md`, `code-parent-projekte.md`,
  `user-style.md`.
- **Session logs** (in repo, gitignored):
  `.claude/logs/YYYY-MM-DD-<topic>.md`

## Architecture notes

- **Host boundary:** the engine must not `import` from `obsidian`. The
  Plugin shape it depends on (`HostPlugin` in `controller.ts`) is
  declared locally. CI-check (manual until automated):
  `! grep -rn "^import .*from 'obsidian'" src/engine/` — note the anchor: a
  bare `grep -r "from 'obsidian'"` always matches, because `controller.ts:7`
  says in a comment that the file stays free of it. DOM helpers Obsidian adds to
  `HTMLElement` (`createEl`/`createDiv`/`createSpan`/`empty`) are
  polyfilled in the Web-Host (`src/host-web/obsidian-dom-polyfill.ts`).
- **`src/engine/` diverges from `kuro-theme-settings/src/screensaver/`**
  after the 2026-05-27 rollback. The plugin side has not yet caught up.
  Sync is paused until the plugin's `host-obsidian.ts` is reconciled
  with the rolled-back engine — see rollback spec for options A/B/C.
  Excluded from sync (when re-enabled): `host-obsidian.ts`,
  `embed-view.ts`, `host.ts` (plugin-only or unused-in-plugin).
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
- **Presets:** `src/engine/data/presets.ts` holds the color presets that
  used to live in `kuro-theme-settings/src/legacy.ts`. Both repos now
  import from the engine path.
- **Plugin variants (v1 vs v2):** lives in the `kuro-theme-settings`
  repo. Engine code is variant-agnostic — same engine bundle in both
  plugin builds.

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

**Deprecated 2026-06-03 (v0.5.0):** all macOS `.saver` paths were removed — the
WebGL `.saver`/`.app` scaffold (`KuroScreensaverApp`/`KuroScreensaver`), the live
native `.saver` host (`KuroNativeSaver/Host`), and the 13 pre-rendered video
`.saver`s (`KuroVideoSaver`). macOS Tahoe's sandboxed `legacyScreenSaver` process
broke live GPU compositing; the notarized native app replaces all of them. The
xcodegen `project.yml` + the `package-macos.sh`/`build-native-saver.sh`/
`build-video-savers.sh`/`upload-video-assets.sh`/`render-saver-videos.mjs` scripts
are gone too.

Releases: GitHub Actions (`johannes-kaindl/kuro-screensaver`) typechecks + runs the
native tests, compile-checks the macOS app, builds the Windows `.scr`, and attaches
the `.scr` to the release. The **notarized macOS app** is built + attached
locally (CI has no Developer ID cert). Cut a release: `bash scripts/bump-version.sh
X.Y.Z` (single source — writes package.json + the app Info.plist together), commit,
then `git tag vX.Y.Z && git push origin main vX.Y.Z` (the Forgejo→GitHub push mirror
forwards the tag to trigger CI). Build + attach the notarized app with
`scripts/package-native-app.sh`. See `docs/specs/2026-05-28-screensaver-native-port-*.md`.

## Related repos

No longer siblings — these stayed in the `kuro/` subtree when this project
moved out to its own top-level dir (2026-06-01):

- `../kuro/kuro-theme-settings/` — the Obsidian plugin (v1 +
  v2 unified via build defines `__HAS_ASPECTS__`, `__STYLE_TAG_ID__`,
  `__BODY_CLASS__`). The `sync-to-plugin.sh` DST already points at this
  directory (absolute path inside the script).
- `kuro-gamification` (maintainer-local symlink in the `kuro/` subtree,
  pointing at that plugin's `40_src/` source dir outside the workspace) —
  separate Obsidian plugin, deployed in vault 10_Pallas.
