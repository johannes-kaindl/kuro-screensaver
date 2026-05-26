# AGENTS.md

Conventions for AI assistants working in this repo.

## What this is

Standalone Retro-CRT 3D Screensaver engine — extracted from the
`kuro-companion` Obsidian plugin (source lives in `kuro-theme-settings`).
Vite/TypeScript project, runs in any modern browser. Engine is
host-agnostic (`ScreensaverHost` interface in `src/engine/host.ts`);
this repo ships the Web-Host (`src/host-web/`). The plugin imports the
same engine code via `scripts/sync-to-plugin.sh`.

## Workflow conventions

- **Tests:** none yet — visual verification via `npm run dev`.
- **Typecheck:** `npm run typecheck` (must pass before commits touching `src/`).
- **Build:** `npm run build` → `dist/`.
- **Backport to plugin:** `./scripts/sync-to-plugin.sh --apply`, then in
  `kuro-theme-settings/`: `npm run build:all && npm run sync:v1 && npm run sync:v2`.
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

- **Host boundary:** the engine never imports `obsidian` or any
  host-specific module. Adding such an import is a bug. CI-check
  (manual until automated): `! grep -r "from 'obsidian'" src/engine/`.
- **`src/engine/` is byte-identical to** `kuro-theme-settings/src/screensaver/`.
  Plugin pulls changes via the sync script. Excluded from sync:
  `host-obsidian.ts`, `embed-view.ts` (plugin-only).
- **Engine sub-layout** (note the doubled `engine/` is intentional —
  outer `engine/` is the library namespace, inner is the THREE-renderer):
  - `engine/{core,materials,rng,color,scenes/}` — render loop + scenes
  - `fx/crt-sim.ts` — CRT signal-degradation post-pass
  - `audio/synth.ts` — Web Audio synthesizer
  - `terminal/{narrative,persona,typing,script-bank}.ts` — bottom-strip narrative
  - `hud/{index,boot}.ts` — DOM overlay
  - `data/{defaults,dictionary,presets}.ts` — static config
  - `controller.ts` — overlay lifecycle, hotkeys, fullscreen
  - `host.ts` — host interface
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
