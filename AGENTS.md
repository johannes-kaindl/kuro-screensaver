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
- **Kein CI-Badge in der Badge-Zeile (CORE-META-02).** Die Regel nennt die Reihenfolge
  Lizenz·Release·CI·Plattform·Downloads und sagt "nicht zutreffende weglassen" — der
  CI-Fall ist hier keiner: die Actions laufen auf dem GitHub-Mirror, und **der ist von
  aussen nicht erreichbar**. Gemessen am 2026-08-30: anonym liefern Repo-Seite,
  Badge-URL, `api.github.com/repos/johannes-kaindl/kuro-screensaver` **und das
  Nutzerprofil selbst** je HTTP 404 — auch mit Browser-User-Agent —, waehrend dieselbe
  API mit dem Token des Kontos das Repo als `private: false` mit vier aktiven Workflows
  ausliefert. Nicht die Sichtbarkeit des Repos ist die Ursache, sondern der **Zustand
  des Kontos**; das ist eine Konto-Angelegenheit des Maintainers, nichts, was dieses
  Repo loesen kann. Ein Actions-Badge waere in der oeffentlichen README so oder so ein
  dauerhaft kaputtes Bild. Das Release-Badge liest dagegen die oeffentliche
  Forgejo-Instanz und ist geprueft (zeigt v0.11.1).
  **Folge fuer die CI-Kontrolle:** Laufergebnisse sind seit dieser Beobachtung nicht mehr
  abfragbar (`actions/runs` meldet `total_count: 0`, obwohl um 21:12 desselben Tages noch
  zwei gruene Laeufe gelistet waren). Wer hier CI-Stand behauptet, muss ihn erst wieder
  belegen koennen — bis dahin gilt lokal Gemessenes.
- **Der Linux-Host kopiert den Options-Code des Windows-Hosts, statt ihn zu teilen.**
  Begruendet unter "Native builds": der Windows-Host ist durchgaengig `std::wstring` und
  MSVC-only, lokal nicht baubar; Teilen hiesse, *ausgelieferten* Code umzuschreiben, den
  niemand hier kompilieren kann. Gehalten wird die Kopplung stattdessen ueber das
  gemeinsame Fixture `native/shared/query-contract.txt` — eine Zusage mit Test statt einer
  Zusage mit Kommentar.

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
- **The query contract is one file:** `native/shared/query-contract.txt` holds the query that
  unchanged default settings must produce. Four tests read it — `native/linux/host/tests`,
  `native/windows/host/tests` (both check the WRITE direction), `tests/screensaver-params.test.ts`
  (the READ direction: that query must yield the default settings) and, since 2026-08-30,
  `native/macos/KuroNativeSaver/tests/main.swift` (macOS `AppDefaults` must equal the contract).
  **Changing that line is a contract change** and all four sides plus
  `src/screensaver/params.ts` have to follow it together. Regenerate it, never retype it:
  `./<build>/options_test --print-default-query`.
  The web test documents two deliberate exceptions to "defaults in, defaults out", both
  mechanism: `hudPreset` → `custom` and `fxInheritFromTheme` → false, so query-set values
  survive a later preset/theme pass. There was a third — `autoCycle` defaulted to off on the
  web and on in every native host, contradicting those hosts' own header promise. The fixture
  found it on its first run (unnoticed since v0.10) and it was resolved on 2026-08-30 by
  pulling **all three** native hosts to the web default, macOS included.
  **macOS joined the fixture later the same day** and was the loose end that made autoCycle
  possible: the Metal app reads `UserDefaults` and hung on no parity checkpoint at all, so it
  could drift freely. Its defaults now live in `native/macos/KuroMetalApp/AppDefaults.swift`
  (the macOS counterpart to `data/defaults.ts`) — extracted from `AppSettings` precisely so a
  test can read them without touching a store. The check is exhaustive by construction: every
  contract key is either compared or listed as a **named exception with a reason**, and a key
  that is neither fails the run — a later contract change cannot be adopted by three hosts and
  silently skipped by the fourth. Two more divergences fell out of it at once (`cycleMinutes`
  0.5 vs 5 — a factor of 10 — and `dayNight` off vs on) plus a vocabulary gap: `Settings.Weather`
  knew only `clear/storm/dust`, where native `.clear` was in fact the web's `light-fog` (both the
  no-op scene default) while the web's own `clear` and `heavy-fog` had no native value at all.
  The enum now carries the web vocabulary with the fog factor on the enum (like `Fog.mul`),
  derived from `controller.ts:363`, not guessed.
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

### The Swift twin

The native engine logic is a **hand-maintained, line-for-line twin** of the TS engine
(`Core/Script.swift` ↔ `terminal/script-bank.ts`, FilmDirector, palettes …). Two rules keep
that twin from silently drifting apart:

- **Story CONTENT is authored once**, in `src/engine/data/story-content.json`. The web reads
  it through `data/dictionary.ts`; native decodes the same file via `Core/StoryContent.swift`
  (`Bundle.main` — the build scripts drop the JSON next to every binary, so tests, harness and
  `.app` share one code path). Swift-side literals that duplicate SSOT content should become
  facades over `StoryContent.shared` — `Script.boot` is the first one.
- **Story LOGIC stays a twin** (phases, timing, RNG) — that is deliberate, not debt.

`tests/main.swift` § *Parity* compares the remaining Swift literals section by section against
the JSON. **A mismatch there is a content-parity finding, not a test defect**: fix the content
or move the literal to the SSOT, do not relax the test. Both sides additionally pin a golden
hash (`tests/main.swift`, `tests/dict-presets-parity.test.ts`); when an authored content change
moves them, re-pin *with* a comment saying why — an unexplained re-pin is indistinguishable
from an accident.

Content that names the runtime is a trap: a line reading `WEBGL RENDERER` is true on the web
and a lie in the Metal app. Shared content stays platform-neutral.

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
`scripts/package-native-app.sh`. **The web page is not part of any of this** —
`scripts/deploy-page.sh` (rsync, local SSH deploy key, so CI cannot do it) is a
separate manual step and is therefore the one that gets forgotten: on 2026-08-20 the
live bundle was still two releases behind and did not know the METRO scene. After a
release, deploy it and read the live bundle back. See `docs/specs/2026-05-28-screensaver-native-port-*.md`.

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
