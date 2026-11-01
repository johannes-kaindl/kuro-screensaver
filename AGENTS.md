# AGENTS.md

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, `../_docs` relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain. Offene Punkte fuer
> dieses Repo siehe Abschnitt "Offene Konventions-Punkte".

Conventions for AI assistants working in this repo.

## Offene Konventions-Punkte

Stand 2026-08-30 — sieben der neun Punkte sind geschlossen; was bleibt, bleibt
mit Grund.

- [ ] CORE-META-04 — User-Manual nach Diátaxis (Tutorial/How-to/Reference/Explanation)
      anlegen und aus README verlinken. Nicht am 30.08. mitgemacht: die README traegt
      heute Tutorial- und Reference-Stoff gemischt, `docs/WINDOWS-INSTALL.md` ist eine
      How-to. Eine Diátaxis-Aufteilung ist ein Umbau der Nutzerdoku, kein Anlegen von
      Dateien — und der Zuschnitt (was bleibt in der README, was zieht um) gehoert
      entschieden, nicht nebenbei gemacht.
- [ ] PROF-TS-01 — npm-Script `lint`. Das Projekt hat **keinen** Linter: eslint einzufuehren
      heisst Werkzeugwahl, Konfiguration und ein Bestand von Befunden, die zuerst jemand
      ansehen muss. Ein `lint`, das die CI sofort rot faerbt oder mit abgeschalteten Regeln
      startet, waere schlechter als keins. `test`/`typecheck`/`build`/`dev` sind vorhanden.

Geschlossen am 2026-08-30: CORE-META-02 (Badge-Reihenfolge Lizenz·Release·CI·Plattform),
CORE-META-06 (`CHANGELOG.md` aus der Tag-Historie, `CONTRIBUTING.md`, `SECURITY.md`),
CORE-META-07 (`LICENSING.md` + `CLA.md`), CORE-META-08 (`LICENSE-DOCS`),
CORE-META-10 (`keywords` + `license` im Manifest, Forge-Topics),
CORE-AGENT-01 (Abschnitt unten), CORE-AGENT-06 (`.editorconfig`).

## Abweichungen von der Leitkonvention

Comply-or-explain: was hier bewusst anders laeuft als in `_docs/CONVENTIONS.md`.

- **Commit-Sprache Deutsch, Repo-Sprache Englisch.** README, `AGENTS.md`, Code-Kommentare
  und die Meta-Dateien sind englisch — das Repo ist oeffentlich und die Zielgruppe nicht
  deutschsprachig. Commit-Messages und Session-Artefakte sind deutsch, weil sie an den
  Maintainer gerichtet sind. Die Leitkonvention regelt das nicht; die Trennlinie ist
  "wer liest das".
- **`docs/specs/` und `docs/superpowers/` bleiben im Repo liegen.** CORE-META-14 will
  SDD-Artefakte im Cockpit; die Regel gilt ausdruecklich vorwaerts und erzwingt keine
  Rueckmigration. Der Altbestand ist eingefroren — nichts Neues kommt dazu —, und
  `check-no-abs-paths.mjs` haelt in `npm test` die Pfad-Zusage.

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

- **CI on every push:** `ci.yml` runs, on ubuntu for every push on every branch, two jobs —
  `web` (typecheck + `npm test` + the production build) and `linux-host` (CMake build + the
  Linux host's `options_test`); `native-macos.yml` runs the Swift logic tests,
  paths-filtered to what can break them (`native/macos/KuroNativeSaver/**`, the two
  `src/engine/data/*.json` the test script copies, the script itself). Both are the dev
  loop — `release.yml` keeps the expensive whole-app compile checks at tag time. Before
  2026-08-30 nothing but a `v*` tag ran the tests, which is how v0.7.0 and v0.10.1 each
  shipped a break that had been in the tree for weeks.
- **Tests:** native logic tests via `bash scripts/run-native-tests.sh` (LCG parity,
  terrain/camera/palette sanity — run in CI). Web: typecheck + visual verification
  (`npm run dev`, or `node scripts/verify-crt.mjs` for headless CRT screenshots).
- **README images:** `node scripts/render-motion-gif.mjs` re-records `docs/images/motion.gif`
  from the live engine (needs the dev server + ffmpeg). Its capture params are pinned on
  purpose — the reactive world drifts with the narrative threat level, and at full bloom
  the phosphor blows out into a flat sheet with no wireframe left. Sizes are checked by
  the workspace README linter (`_docs/readme`, maintainer-local): embeds need a **pixel**
  width, `width="100%"` does not count.
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

## Context index

- Bevor du die README oder etwas unter `.github/` änderst oder wissen willst, warum kein CI-Badge in der README steht und warum Actions stehen: `.claude/rules/github-konto-flag.md` (geflaggtes GitHub-Konto, Messung mit Kontrollprobe).
- Bevor du den Query-Vertrag (`native/shared/query-contract.txt`), `src/screensaver/params.ts` oder die Defaults eines Hosts änderst: `.claude/rules/query-vertrag.md`.
- Bevor du unter `native/` arbeitest (macOS-Metal-App, Windows-`.scr`, Linux-Host, Abweichung zum Options-Code): `.claude/rules/native-hosts.md`.
- Bevor du macOS-Swift-Code oder die Story-Quelle (`story-content.json`) änderst: `.claude/rules/swift-zwilling.md`.
- Bevor du unter `src/engine/` oder `src/host-web/` Dateien anlegst, verschiebst oder `src/engine/data/osm-district.json` anfasst: `.claude/rules/engine-layout.md` (Engine-Unterlayout, gebackene OSM-Daten, kein Runtime-Fetch).
- Bevor du ein Release schneidest oder die Web-Seite deployst: `.claude/rules/release.md`.

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
- **Presets:** `src/engine/data/presets.ts` holds the color presets that
  used to live in `kuro-theme-settings/src/legacy.ts`. Both repos now
  import from the engine path.
- **Plugin variants (v1 vs v2):** lives in the `kuro-theme-settings`
  repo. Engine code is variant-agnostic — same engine bundle in both
  plugin builds.

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
