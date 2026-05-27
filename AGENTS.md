# AGENTS.md

Conventions for AI assistants working in this repo.

## What this is

Standalone Retro-CRT 3D Screensaver engine — extracted from the
`kuro-companion` Obsidian plugin (source lives in `kuro-theme-settings`).
Vite/TypeScript project, runs in any modern browser.

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

- **Tests:** none yet — visual verification via `npm run dev`.
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
  `~/.claude/projects/-Users-Shared-code-kuro-animation/memory/`
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

## Sibling repos

- `kuro-theme-settings/` — the Obsidian plugin (v1 + v2 unified via
  build defines `__HAS_ASPECTS__`, `__STYLE_TAG_ID__`, `__BODY_CLASS__`).
- `kuro-gamification` (symlink → `/Users/Shared/20_Claude/.../40_src/`) —
  separate Obsidian plugin, deployed in vault X1_v6t2b9.
