# AGENTS.md

Conventions for AI assistants working in this repo.

## What this is

Standalone Retro-CRT 3D Screensaver engine — extracted from the
`kuro-companion` Obsidian plugin (source lives in `kuro-theme-settings`).
Vite/TypeScript project, runs in any modern browser.

**Standalone repo since 2026-06-01** — moved out of the `kuro/` monorepo
subtree (was `/Users/Shared/code/kuro/animation/`) to its own top-level
project at `/Users/Shared/code/kuro-screensaver/`. Git remotes, the GitHub
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

## Memory + logs

- **Memory** (cross-session, outside the repo):
  `~/.claude/projects/-Users-Shared-code-kuro-screensaver/memory/`
  — index in `MEMORY.md`. See `animation-project.md`,
  `kuro-projekte-uebersicht.md`, `code-parent-projekte.md`,
  `user-style.md`.
- **Session logs** (in repo, gitignored):
  `.claude/logs/YYYY-MM-DD-<topic>.md`
- **Design specs** (in repo, committed):
  `docs/specs/YYYY-MM-DD-<topic>-design.md`

## Architecture notes

- **Host boundary:** the engine must not `import` from `obsidian`. The
  Plugin shape it depends on (`HostPlugin` in `controller.ts`) is
  declared locally. CI-check (manual until automated):
  `! grep -r "from 'obsidian'" src/engine/`. DOM helpers Obsidian adds to
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
  (no Xcode) via `scripts/build-native-app.sh`; notarized + uploaded to the release
  locally via `scripts/package-native-app.sh`. Dev tools live alongside Core:
  `harness/` (headless PNG renders), `tests/`, `tools/`.
- **Windows** — a real `.scr` (`native/windows/`, .NET WinForms + WebView2 hosting
  `screensaver.html`). Cross-builds on macOS/Linux via `dotnet publish -r win-x64`.

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
the `.scr` to the Codeberg release. The **notarized macOS app** is built + attached
locally (CI has no Developer ID cert). Cut a release: `bash scripts/bump-version.sh
X.Y.Z` (single source — writes package.json + the app Info.plist together), commit,
then `git tag vX.Y.Z && git push origin main vX.Y.Z` (the Codeberg→GitHub push mirror
forwards the tag to trigger CI). Build + attach the notarized app with
`scripts/package-native-app.sh`. See `docs/specs/2026-05-28-screensaver-native-port-*.md`.

## Related repos

No longer siblings — these stayed in the `kuro/` subtree when this project
moved out to its own top-level dir (2026-06-01):

- `/Users/Shared/code/kuro/kuro-theme-settings/` — the Obsidian plugin (v1 +
  v2 unified via build defines `__HAS_ASPECTS__`, `__STYLE_TAG_ID__`,
  `__BODY_CLASS__`). The `sync-to-plugin.sh` DST already points at this
  absolute path.
- `kuro-gamification` (symlink → `/Users/Shared/20_Claude/.../40_src/`) —
  separate Obsidian plugin, deployed in vault X1_v6t2b9.
