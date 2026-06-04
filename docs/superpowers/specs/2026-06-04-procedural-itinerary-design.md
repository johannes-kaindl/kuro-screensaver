# Procedural Itinerary + Narrative Co-Drive — Design (Brick C)

- **Date:** 2026-06-04
- **Status:** Implemented (Brick C) — web + native, verified (typecheck + native logic
  tests + app compile + a live film run: terrain→city→…→void with matching foreshadow
  lines, e.g. `[HQ→] // CORP station wreckage ahead` arriving at the void scene). Branch
  `feat/procedural-itinerary`.
  - **Deviations:** (1) a monotonic `phaseCounter` replaces `(shiftIndex, phase)` indexing
    — strictly cleaner (foreshadow query == arrival query, no shift bookkeeping), same
    determinism. (2) Web foreshadow lead scales with `durationScale`; native uses a fixed
    6 s (no durationScale natively). (3) The screensaver enables `autoCycle.on` (film mode)
    by default; native's film-mode gate is `autoCycleSec > 0`.
- **Author:** Johannes + Claude (pair)
- **Scope:** Brick **C** of the "Procedural Film" roadmap. Builds on A (`FlightDirector`,
  `EventBus`) and B (warp `switchScene` / `beginTransition`).

## 1. Why this exists

After B, scene changes are real warp transitions, but they still fire on an independent
timer, decoupled from the story. Brick C makes the film **cohere**: the narrative phase
arc is the fixed dramatic backbone, a seeded **FilmDirector** decides *which* scene fills
each act, scene changes happen *at phase boundaries*, and each upcoming scene is
**foreshadowed** in the terminal a few seconds before the warp — so every transition feels
motivated by the story ("aus einem Guss"), not arbitrary.

**User's chosen shape (do not re-litigate):** *"fester Bogen, prozedurale Welt"* — the
emotional arc (ROUTINE→INTRUSION→ALARM→PANIC→SILENCE→crash) is FIXED; which scenes/places
fill it is seed-procedural. Same seed ⇒ same film across all shifts; each shift different.
1 scene per phase (~5 scenes per ~6–9 min shift). `autoCycle.on` becomes the film-mode gate.

## 2. Scope / Non-goals

**Goals**

- A seeded **`FilmDirector`**: maps `(phase, shiftIndex, prevScene) → sceneId` via an
  intensity-tier grammar (phase target tier × scene tier), no immediate repeats, sensible
  adjacency. Deterministic from `engine.seed`; `shiftIndex` advances each shift.
- **Phase-synced scene changes:** the narrative phase machine drives the warp. On entering
  a phase, the film warps (Brick-B `switchScene`/`beginTransition`) to that phase's scene.
  This **replaces** the independent auto-cycle timer.
- **Foreshadowing:** a `SCENE_FORESHADOW` line pool keyed by `sceneId` (script-bank data);
  the terminal emits a hint for the *next* phase's scene ~`foreshadowLead` s before the
  phase boundary, so anticipation precedes the warp payoff.
- `autoCycle.on` = **film mode** (on = the procedural phase-driven journey; off = stay on
  the chosen scene). The interval setting is retired/ignored.
- **Determinism:** all selection from `mkRng(seed)` advanced per `(shiftIndex, phaseIndex)`;
  no `Math.random`. Same seed ⇒ identical film across shifts.
- **Parity:** web-first, native fast-follow; identical grammar tables + foreshadow pools.

**Non-goals (deferred)**

- **D:** combat actors (drone pursuit, debris, CORP units, incoming fire).
- **E:** multi-speaker radio chatter between units (C's foreshadow is single-speaker, the
  operator/HQ register — the richer cross-unit dialogue is E).
- **F:** per-scene settings UI.
- New scenes; the `matrix` fx scene stays out of the flight itinerary (it is screen-space
  rain, force-enabled separately — not a flight).
- Deep scene-specific story arcs beyond the foreshadow hint.

## 3. Architecture

### 3.1 `FilmDirector` — `src/engine/modes/film-director.ts` (+ Swift mirror)

Single purpose: **seeded scene selection for the arc.** No camera/timeline ownership —
the narrative phase machine remains the clock; the FilmDirector is a pure function of
`(seed, shiftIndex, phase, prevScene)`.

```ts
type Tier = 'calm' | 'low' | 'mid' | 'high';
// scene → tier
const SCENE_TIER: Record<FlightSceneId, Tier> = {
  terrain: 'calm', city: 'low', rift: 'mid', tunnel: 'high', void: 'high',
};
// phase → ordered candidate scenes (by intensity); FlightSceneId excludes 'matrix'
const PHASE_CANDIDATES: Record<Phase, FlightSceneId[]> = {
  ROUTINE:   ['terrain', 'city'],
  INTRUSION: ['city', 'rift'],
  ALARM:     ['rift', 'tunnel'],
  PANIC:     ['tunnel', 'void'],
  SILENCE:   ['void'],
};

class FilmDirector {
  constructor(seed: number);
  /** Deterministic scene for this phase of this shift, avoiding an immediate repeat. */
  sceneFor(phase: Phase, shiftIndex: number, prevScene: SceneId | null): FlightSceneId;
}
```

Selection: seed a per-call index from `mkRng(seed)` advanced by a stable hash of
`(shiftIndex, phaseIndex)`; pick `candidates[idx % len]`; if it equals `prevScene` and the
list has another option, take the next. Pure + reproducible.

### 3.2 Phase coupling (narrative drives the film)

`NarrativeRunnerDeps` gains:

- `onPhaseEnter?(phase: Phase): void` — fired in `enterPhase()` (after generation bump).
- `onForeshadow?(phase: Phase): void` — fired by a timer at `phaseEndsAt − foreshadowLead`,
  where `phase` is the **next** phase (so the consumer can foreshadow the upcoming scene).

The **controller** owns a `FilmDirector` + `shiftIndex` + `currentFilmScene`, and wires:

- `onPhaseEnter(phase)`: `const next = film.sceneFor(phase, shiftIndex, currentFilmScene);
  if (next !== engine.currentScene) switchScene(next); currentFilmScene = next;`
- the SILENCE→ROUTINE reset path increments `shiftIndex` (new itinerary) — hook the existing
  `silentReset`/reset boundary.
- the auto-cycle interval timer is removed; `autoCycle.on` gates whether `onPhaseEnter`
  drives scene changes (off = stay put).

Native mirror: `Terminal` gains the same two callbacks; the `Renderer` owns the
`FilmDirector` + `shiftIndex` and calls `beginTransition` to the selected scene; the
`sceneAge` auto-cycle from Brick B is removed.

### 3.3 Foreshadowing

`SCENE_FORESHADOW: Record<FlightSceneId, string[]>` in the script-bank (web
`terminal/script-bank.ts`; native `Script.swift`) — short, lore-toned hints, e.g.
`city → "// proximity alert: megacity grid ahead"`. On `onForeshadow(nextPhase)`, the
consumer resolves `film.sceneFor(nextPhase, shiftIndex, currentFilmScene)` and the terminal
types one matching foreshadow line (respecting the generation guard so it never lands in a
cleared prompt). `foreshadowLead ≈ 6 s`. The warp then fires at the phase boundary as the
payoff.

Because the FilmDirector is pure and deterministic, the foreshadow query and the actual
`onPhaseEnter` query return the **same** scene — the hint always matches the arrival.

## 4. Data flow (one shift)

```
enterPhase(P) → onPhaseEnter(P) → film.sceneFor(P) → switchScene (warp)   [arrival]
   … phase plays …
phaseEndsAt(P) − 6s → onForeshadow(nextPhase) → terminal hints next scene  [anticipation]
phaseEndsAt(P) → enterPhase(nextPhase) → warp                              [payoff]
   …
SILENCE→ROUTINE → shiftIndex++ (new itinerary) + crash reset (unchanged)
```

## 5. Determinism

`FilmDirector(engine.seed)`; the per-call index hashes `(shiftIndex, phaseIndex)` through
the seeded rng. Same seed ⇒ identical scene sequence across every shift. The shift loop
advances `shiftIndex` deterministically. No `Math.random` in selection.

## 6. Parity

Web-first, native fast-follow. `SCENE_TIER` / `PHASE_CANDIDATES` / `SCENE_FORESHADOW` are
structurally identical data in both engines. The narrative→film coupling mirrors the
existing `onIntrusion`/`onShiftEnd` callback pattern on both `NarrativeRunner` (web) and
`Terminal` (native).

## 7. Testing & verification

- **Native logic tests** (`run-native-tests.sh`): FilmDirector determinism (same seed ⇒
  same `(shift,phase)→scene` sequence); tier-match (each phase's pick is in its candidate
  list); no immediate repeat across consecutive phases; foreshadow query == phase-enter
  query for the same `(phase, shift)`.
- **Web** `typecheck` + `verify-crt`: drive a fast shift (`?storyScale` small) and confirm
  scene changes land on phase boundaries with a foreshadow line preceding each warp.
- **calm mode**: scene still advances; the warp uses the calm profile; foreshadow lines
  still type.
- Host-boundary: `modes/film-director.ts` must not import `obsidian`.

## 8. Risks & invariants (must not regress)

- **Phase↔scene must not desync.** The FilmDirector is pure; the foreshadow query and the
  enter query must use the SAME `(phase, shiftIndex, prevScene)` inputs so the hint matches
  the arrival. Advance `shiftIndex` only at the shift reset, not mid-shift.
- **Generation guard.** The foreshadow line goes through the narrative typing path and must
  respect the `generation` snapshot (like every beat) or it types into a cleared prompt.
- **Single-writer / B invariants.** Scene changes still go through the Brick-B warp
  (`switchScene`/`beginTransition`); C only changes *when* and *to what*, not the warp.
- **calm mode.** Film still advances (the warp's calm profile handles motion); nothing
  motion-heavy added here.
- **Determinism.** Selection uses the seeded rng only; the regenerating-film property holds.
- **No double-trigger.** With `autoCycle.on` off, `onPhaseEnter` must not switch scenes
  (stay on the user's chosen scene); the old interval timer is fully removed (no leftover).
- **Two hand-mirrored engines.** Grammar tables + foreshadow pools added to both; no codegen.

## 9. Out of scope → next bricks

D (combat actors driven by the same phase/event signals), E (multi-speaker radio chatter
generalizing the single-speaker foreshadow into unit cross-talk), F (per-scene settings UI).
