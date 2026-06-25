# Story Arcs + Corruption (Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a behaviour-additive Arc-Template layer over the 5-phase narrative machine (branching arcs, variable hybrid endings, cross-session variety/escalation memory), threat+reduced-motion-gated terminal corruption, a shared JSON content SSOT, ←/→ scene-change parity + reactive chatter, and native persona-typing parity — web (TS) and native (Swift/Metal) as a twin.

**Architecture:** The phase machine stays the substrate. An optional `ArcState` on the narrative runner gates content (tag-filtered `pickArc`), routing/duration, mentor, scene-bias, threat-curve, and ending. Content moves from hand-mirrored TS+Swift into one `story-content.json`; logic stays a deliberate twin. Corruption derives a stepped 0–3 stage from `threat`, gated off in calm/reduced-motion. The whole thing is **inert when no arc is selected and corruption is off**, enforced by a golden-snapshot test for a fixed seed.

**Tech Stack:** TypeScript/Vite (web) + **vitest** (new, unit/parity tests) + Playwright (existing visual); Swift/Metal compiled Xcode-free via `swiftc`, assert-based tests in `tests/main.swift`.

**Spec:** `docs/specs/2026-06-15-story-arcs-corruption-design.md` (read it first — types, decisions, verified citations).

---

## File structure

**Web — create**
- `src/engine/data/story-content.json` — the single content SSOT (presets, boot, dicts, beats, endings, mentor, film, arcs).
- `src/engine/data/story-content.ts` — typed `StoryContent` interface + `import`ed default export (typed facade over the JSON).
- `src/engine/terminal/arc.ts` — `ArcTemplate`/`ArcState`/`EndingSpec` types, `arcAllows()`, `pickArc()`, `resolveEnding()`, `selectArc()`.
- `tests/narrative-golden.test.ts`, `tests/arc.test.ts`, `tests/corruption.test.ts`, `tests/persistence.test.ts` — vitest.

**Web — modify**
- `src/engine/terminal/script-bank.ts` — becomes a facade re-exporting from `story-content.ts` (same exported names/types).
- `src/engine/terminal/narrative.ts` — `pickArc` at call sites, `arc` field, selection in `silentReset` callback, per-phase `durationScale`, `phaseRouting`, ending resolution.
- `src/engine/data/defaults.ts` — `story` persistence block + defaults.
- `src/engine/fx/reactive-world.ts` — `corruptionStage` output, calm gate, optional arc `threatCurve`.
- `src/engine/hud/index.ts` — per-line `dataset.category` + `cat-*` class, `--ks-corrupt` var, materialization.
- `src/engine/modes/film-director.ts` — `SceneWeight`, arc `scenes` bias.
- `src/engine/core/bus.ts` — `sceneChange` event.
- `src/engine/controller.ts` — arrow hotkeys, `sceneChange` emit, story snapshot + force-flush.
- `src/engine/terminal/chatter-bank.ts` — `sceneChange` pool (web parity for native chatter).
- `package.json` — `"test": "vitest run"`, vitest devDep.

**Native — create**
- `native/macos/KuroNativeSaver/Core/StoryContent.swift` — Codable structs + `StoryContent.load()` (+ embedded fallback).

**Native — modify**
- `Script.swift`, `Palette.swift` — facades over `StoryContent`.
- `Terminal.swift` — foreshadow `durationScale` fix, `arc` state + `pickArc` twin, persona `TraitProfile`/`phaseModulate`, ending resolution.
- `Hud.swift` — `renderOverlay(... corruptionStage:calm:)`, `colorFor(category, stage)`.
- `TextRenderer.swift` — optional `glyphColors` param.
- `FontAtlas.swift` — corruption glyph audit/extra slots.
- `Chatter.swift` — `sceneChange` pool.
- `Renderer.swift` — `cycleScene` bus emit, threat→Hud, arc threat-curve.
- `AppSettings.swift` — `StoryMemory` Codable persistence.
- `scripts/build-native-app.sh` — copy `story-content.json` into Resources.
- `native/macos/KuroNativeSaver/tests/main.swift` — new assert tests.

---

## Slice sequence (each slice = working, testable increment; commit per task)

| Slice | Goal | Depends on | Acceptance |
|---|---|---|---|
| **0 Prep/de-risk** | Web test runner; native foreshadow latent-bug fix; golden snapshot harnesses (web+native) | — | `npm test` + `run-native-tests.sh` green; foreshadow parity test passes |
| **1 JSON SSOT** | Content → `story-content.json`; facades; native Codable+loader+Bundle de-risk; schema test | 0 | golden tests still green; schema-decode test green; app builds with bundled JSON |
| **2 Arc layer** | `arc.ts` twin + `pickArc` + selection + endings + 5 arcs; native twin | 1 | arc=undefined → golden identical; arc parity test green |
| **3 Persistence** | `story` block + force-flush + record arcs/endings; native `StoryMemory` | 2 | forward-compat + kill-mid-reset tests green |
| **4 Corruption** | stage twin + calm gate; web+native tint; per-glyph (prototype-gated); materialization | 1 | stage parity green; visual sign-off (on-device) |
| **5 ←/→ + chatter** | bus `sceneChange` + web binding + native emit + chatter parity | 1 | chatter fires on ←/→ in active-watch modes |
| **6 Persona-typing** | native `TraitProfile`/`phaseModulate` twin | 1 | persona parity test green |
| **7 FilmDirector bias** | `SceneWeight` + arc `scenes` (web+native) | 2 | arc biases scene itinerary |
| **8 threatCurve** | ReactiveWorld arc-aware (web+native) | 2,4 | arc threat-curve alters corruption stage |

Slices **2–8 are detailed into bite-sized tasks when their prerequisites land** — several depend on outcomes that only exist after earlier slices run (Slice 1's Bundle-loading confirmation; Slice 4's per-glyph perf measurement and katakana-atlas audit). This is deliberate iterative planning per the spec's "prototype FIRST", not placeholdering. Slices 0–1 are fully specified below and executable now.

---

## Slice 0 — Prep / de-risk

### Task 0.1: Native foreshadow `durationScale` parity fix

**Files:**
- Modify: `native/macos/KuroNativeSaver/Core/Terminal.swift:60` (foreshadow), init for `durationScale`
- Test: `native/macos/KuroNativeSaver/tests/main.swift`

- [ ] **Step 1: Write the failing assert** in `tests/main.swift` — a test that constructs a `Terminal` with `durationScale = 0.1`, drives `update(t:)` to just before a scaled boundary, and asserts the foreshadow fires at `phaseEndsAt - 6 * 0.1`, not `phaseEndsAt - 6`. (If `Terminal` foreshadow timing isn't directly observable, assert via a `sceneForeshadow` closure capture: set a flag, advance `t` to `phaseEndsAt - 0.6 + ε`, assert flag set; advance a separate run to `phaseEndsAt - 6 + ε` with scale 0.1, assert flag NOT yet set.)
- [ ] **Step 2: Run** `bash scripts/run-native-tests.sh` — Expected: FAIL (foreshadow fires at the wrong time / flag set too early).
- [ ] **Step 3: Implement** — add `var durationScale: Double = 1` to `Terminal` (settable at init/host), and change `Terminal.swift:60` from `t >= phaseEndsAt - 6` to `t >= phaseEndsAt - 6 * durationScale`. Wire `durationScale` from the host where `Terminal` is constructed (mirror web `narrative.ts:93/157`); default 1 so production is unchanged.
- [ ] **Step 4: Run** `bash scripts/run-native-tests.sh` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(native): foreshadow lead honours durationScale (web parity)"`

### Task 0.2: Add vitest web test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `tests/smoke.test.ts`

- [ ] **Step 1:** `npm i -D vitest` (adds devDep).
- [ ] **Step 2:** Add `"test": "vitest run"` to `package.json` scripts.
- [ ] **Step 3:** Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 4:** Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 5: Run** `npm test` — Expected: 1 passed.
- [ ] **Step 6: Commit** — `git commit -am "test(web): add vitest runner (PROF-TS-01)"`

### Task 0.3: Web narrative golden-snapshot harness (additive-invariant guard)

**Files:**
- Create: `tests/narrative-golden.test.ts`
- Reference: `src/engine/terminal/narrative.ts`, `src/engine/engine/rng.ts`

The point: capture the exact line stream the narrative produces for a fixed seed, so every later change can prove inertness when arc is undefined + corruption off.

- [ ] **Step 1:** Write `tests/narrative-golden.test.ts` that instantiates a `NarrativeRunner` with a **fixed seed** (use the LCG `mkRng(seed)` from `rng.ts`, NOT `Math.random`), a stub `NarrativeRunnerDeps` whose `hud.addLine`/typing callbacks push `{phase, cat, text}` into an array, a small `durationScale` (e.g. 0.02) so a full multi-phase cycle runs fast, and `Math.random` stubbed to the seeded rng for the calls narrative makes via `Math.random` (note `narrative.ts` mixes `rng` and `Math.random` — the test must seed BOTH; the golden test pins the seed for both paths). Run one full shift, collect the stream.
- [ ] **Step 2: Run** `npm test tests/narrative-golden.test.ts` — Expected: it produces a deterministic array (snapshot via `expect(stream).toMatchSnapshot()`).
- [ ] **Step 3:** Commit the generated snapshot. This is the **golden** — Slice 2's "arc=undefined ⇒ identical" assertion reuses it.
- [ ] **Step 4: Commit** — `git commit -am "test(web): golden narrative snapshot (additive-invariant guard)"`

> Note: `narrative.ts` currently calls `Math.random()` directly in several beats (e.g. `:330`). Slice 2 should route arc-affecting randomness through the injected `rng` for determinism; until then the golden test stubs `Math.random`. Record this in the test file's header comment.

### Task 0.4: Native golden-snapshot harness

**Files:**
- Modify: `native/macos/KuroNativeSaver/tests/main.swift`

- [ ] **Step 1:** Add an assert test that drives `Terminal` with a fixed `LCG` seed + small `durationScale`, collects the emitted line stream (phase, category, text) into an array, and asserts it equals a checked-in expected array (hardcode the expected array after first capture — print it once, paste it in).
- [ ] **Step 2: Run** `bash scripts/run-native-tests.sh` — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -am "test(native): golden narrative snapshot (additive-invariant guard)"`

---

## Slice 1 — JSON content SSOT

> **Discovery (2026-06-15, during execution):** This slice is **NOT a verbatim move** on
> the web side. `RoutineBeat.cmd` is `string | ((p: OperatorPersona) => string)`
> (`script-bank.ts:16-18`) — several beats are **functions** that template `{node}/{hq}/…`
> via JS. They cannot serialize to JSON. Native already stores the **token-string** form
> (`Script.swift` + `Terminal.subst()`). Worse, the substitution models are **asymmetric**:
> web resolves cmd tokens via the functions and only `replace('$P', …)` on resp
> (`narrative.ts:309-318`), while native applies `subst()` (all tokens) to **every** line.
> They agree today only because resp strings happen to contain no `{…}` tokens.
>
> **Revised approach:** the JSON stores token strings (native's form). Web gains a
> `subst(persona, str)` twin of `Terminal.subst()` and applies it where it currently calls
> the cmd function / `$P`-replaces (localized to `beatRoutine`, `narrative.ts:308-319`).
> **Parity guard (write FIRST):** for a fixed-seed persona, hash the resolved cmd+resp
> strings of every `ROUTINE_BEATS` entry via the *current* function logic, pin the hash;
> after the token+`subst` migration the hash must be byte-identical. Other pools
> (HQ/INTRUSIONS/REACTIONS/HESITATIONS/DRAFTS/FAREWELLS/MENTOR/SCENE/COMBAT) are plain
> strings — verbatim. `genHash`/`foreshadowLine`/`arrivalLine`/`combatLine` stay code-side.
>
> **Native 1.3 has an on-device dependency:** `Bundle.main` resource loading is unproven
> (zero current resource loads). Step 1 of Task 1.3 is Johannes' on-device confirmation.
>
> **Discovery (2026-06-25, Slice 1b — presets+dict move, 5-lens adversarial review):**
> - `presets` is stored as an **ordered ARRAY of `{ id, ...fields }`** (per design §2),
>   NOT an object-keyed-by-id. This matches the native `Palette.swift` ordered
>   `[ColorPreset]` (id + `presets[3]` default), so 1.3 decodes straight into it; a JSON
>   object would decode to an unordered Swift `[String:ColorPreset]` and scramble the
>   swatch/dropdown order. The web facade strips `id` on rebuild → `PRESETS` byte-identical.
> - **No `story-content.ts` typed facade** was created (Task 1.1/1.2 listed it) — dropped,
>   consistent with shipped 1a: facades `import story from './story-content.json'` + `as`.
> - **1.3 decoder notes:** `commandSessions[].resp` is heterogeneous (`string | {cat,text}`)
>   → needs a custom `Decodable` `RespItem` enum (string-first fallthrough) + an
>   uppercase-`cat`→`Cat` mapper (no uniform-object precedent in `beats`). `boot.headers`
>   is one **string** per scene (not an array) → `[String:String]`. `Palette.swift` only
>   consumes `darkAccent.color`→`accentHex` (UInt32) and drops `lightAccent`/`rgb`.

### Task 1.1: Define `StoryContent` TS types + extract content to JSON

**Files:**
- Create: `src/engine/data/story-content.json`, `src/engine/data/story-content.ts`
- Reference: `src/engine/terminal/script-bank.ts`, `src/engine/data/dictionary.ts`, `src/engine/data/presets.ts`

- [ ] **Step 1:** Write `story-content.ts` declaring the `StoryContent` interface mirroring the JSON schema in the design spec §2 (presets, boot, terminalDicts, beats{routine,intrusionsQuotes,…}, endings, mentor, film, arcs), then `import data from './story-content.json'` and `export default data as StoryContent;`.
- [ ] **Step 2:** Create `story-content.json` by moving the **existing array/object literals verbatim** out of `script-bank.ts`, `dictionary.ts`, `presets.ts` into the namespaced JSON sections. Keep placeholder strings (`${p.node}` → store as `"{node}"` tokens; the substitution stays in code). Add an empty `"arcs": []` and `"endings"` keyed by EndingId (split current `FAREWELLS`/`LAST_WORDS` under a `"normal"` key for now). `schemaVersion: 1`.
- [ ] **Step 3:** Verify `resolveJsonModule` is on (`tsconfig.json:17`) — it is. Run `npm run typecheck` — Expected: PASS (types match the JSON).
- [ ] **Step 4: Commit** — `git commit -am "feat(data): story-content.json SSOT + typed facade"`

### Task 1.2: Make `script-bank.ts` / `presets.ts` / `dictionary.ts` facades

**Files:**
- Modify: `src/engine/terminal/script-bank.ts`, `src/engine/data/presets.ts`, `src/engine/data/dictionary.ts`

- [ ] **Step 1:** Replace the moved literals with re-exports from `story-content.ts`, preserving every exported name and type (e.g. `export const ROUTINE_BEATS = story.beats.routine;`). Keep code-side logic (weighting in `dictionary.ts:204-221`, computed preset math) intact, now reading from the facade.
- [ ] **Step 2: Run** `npm run typecheck` — Expected: PASS (no consumer changes needed).
- [ ] **Step 3: Run** `npm test tests/narrative-golden.test.ts` — Expected: **golden snapshot UNCHANGED** (content move is behaviour-preserving).
- [ ] **Step 4: Run** `npm run build` — Expected: succeeds (Vite inlines the JSON).
- [ ] **Step 5: Commit** — `git commit -am "refactor(terminal): script-bank/presets/dictionary read from SSOT"`

### Task 1.3: Native `StoryContent` Codable + Bundle de-risk + loader + schema test

**Files:**
- Create: `native/macos/KuroNativeSaver/Core/StoryContent.swift`
- Modify: `scripts/build-native-app.sh`, `Script.swift`, `Palette.swift`, `scripts/run-native-tests.sh`, `tests/main.swift`

- [ ] **Step 1 (de-risk FIRST):** Add a tiny debug print in the app startup that logs `Bundle.main.resourcePath` and whether `Bundle.main.url(forResource:"story-content", withExtension:"json")` resolves. Add `mkdir -p "$RES" && cp "$ROOT/src/engine/data/story-content.json" "$RES/"` to `build-native-app.sh` after the Resources mkdir (~line 35). Build via `scripts/build-native-app.sh`, run the `.app`, confirm the path resolves. **If it does not resolve, STOP and report** — the fallback strategy (embedded JSON string) becomes the path. (This is Johannes' on-device confirmation point.)
- [ ] **Step 2:** Write `StoryContent.swift` — Codable structs matching the JSON exactly (`Optional<String>` for nullable `followup`), and `static func load() -> StoryContent` that decodes the Bundle resource, with a `precondition`/fallback on failure.
- [ ] **Step 3 (schema test):** In `tests/main.swift`, add a test that calls `StoryContent.load()` (or decodes a path passed in) and asserts section counts/keys against a manifest of expected counts (read from the same JSON via a tiny manifest). Wire the JSON path into the test build. Run `bash scripts/run-native-tests.sh` — Expected: FAIL first (struct mismatch), then iterate the structs until PASS.
- [ ] **Step 4:** Make `Script.swift`/`Palette.swift` thin facades over `StoryContent.load()` (lazy static). Keep the native golden test (0.4) green.
- [ ] **Step 5: Run** `bash scripts/run-native-tests.sh` — Expected: schema test + golden test PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat(native): StoryContent Codable loader + schema test + bundled JSON"`

---

## Slices 2–8

Detailed into bite-sized TDD tasks at the start of each slice (see *Slice sequence* table for goal/deps/acceptance). Key anchors carried from the design spec so the sequence is unambiguous:

- **Slice 2 (Arc layer):** `arc.ts` (`arcAllows`/`pickArc`/`resolveEnding`/`selectArc`, ring-buffer N=3, peakStage); wire `pickArc` at narrative pick sites (`:308/:331/:399/:415/…`); arc selection inside `silentReset` callback (`:169-172`); `phaseRouting`/per-phase `durationScale`; mentor override; author 5 arcs in `story-content.json`. Native twin. **Gate:** `arc=undefined` ⇒ golden identical (0.3/0.4).
- **Slice 3 (Persistence):** `story` block in `defaults.ts` (`schema/layerCounter/arcsCompleted[≤3]/endingsReached`); force-flush ordering (select arc → record ending → immediate save → `enterPhase('ROUTINE')`); native `StoryMemory` JSON blob in `UserDefaults` (reuse Slice-1 Codable). **Gate:** forward-compat + kill-mid-reset.
- **Slice 4 (Corruption):** `corruptionStage(threat)` twin + calm/reduced-motion → stage 0; web per-category `cat-*` + `--ks-corrupt`; native `renderOverlay(corruptionStage:calm:)` → `colorFor(category,stage)`; **prototype** native `glyphColors` sparse param + measure draw calls before committing; **audit** `FontAtlas` katakana reuse before baking; materialization as its own task with on-device sign-off.
- **Slice 5 (←/→):** `bus.ts` `sceneChange`; bind arrows in `handleLiveHotkey`; emit on web `cycleScene`/native `Renderer.cycleScene`; `sceneChange` chatter pool both sides; calm-gated.
- **Slice 6 (Persona-typing):** port `TraitProfile`/`profileFor`/`phaseModulate` (`persona.ts:52-120`) to Swift; wire at cps compute (`Terminal.swift:177`); parity test (same seed/trait/PANIC ⇒ matching typo/abandon counts).
- **Slice 7 (FilmDirector bias):** `SceneWeight`; arc `scenes` biases `PHASE_CANDIDATES` pick (web `film-director.ts`, native `Renderer` scene pick).
- **Slice 8 (threatCurve):** make `ReactiveWorld` arc-aware (read `arc.threatCurve` per frame) web + native.

---

## Self-review (against the spec)

- **Spec coverage:** §1 Arc-templates → Slice 2/7/8; §2 SSOT → Slice 1; §3 Corruption → Slice 4; §4 Persistence → Slice 3; §5 ←/→ → Slice 5; §6 testing+typing → Slice 0 (foreshadow, harnesses) + Slice 6 + per-slice tests. Latent foreshadow bug → Task 0.1. Reduced-motion gate → Slice 4. All decisions-log items map to a slice.
- **No placeholders:** Slices 0–1 carry exact files, commands, and code; the JSON content move is "verbatim relocation of existing literals" (precise, not vague). Slices 2–8 are intentionally expanded just-in-time (prototype-dependent), with concrete anchors.
- **Type consistency:** `ArcTemplate`/`ArcState`/`EndingSpec`/`EndingId`/`SceneWeight`/`Phase` defined in the spec's shared-types block; `pickArc`/`arcAllows`/`resolveEnding`/`selectArc` named consistently across Slice 2 and the file structure.
