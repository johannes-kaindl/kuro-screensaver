# Flight Director Foundation — Design (Brick A)

- **Date:** 2026-06-04
- **Status:** Approved (design), implementation pending
- **Author:** Johannes + Claude (pair)
- **Scope:** Brick **A** of the "Procedural Film" roadmap. Skeleton + wiring only.

## 1. Why this exists (the film vision, in one breath)

We are evolving the screensaver from a *scene carousel + a narrative that merely polls
the phase* into a **self-regenerating film**: one continuous flight that flows through
scenes via real transitions (Terrain → pull up → warp → descend into a Megacity street
canyon → …), with the terminal story synced to the flight (pursuit, dodging, incoming
fire, CORP support units, radio chatter).

That whole vision is decomposed into bricks **A–F** (see the session notes). This spec
is **only Brick A: the backbone** — the machinery every later brick hangs off:

- `FlightDirector` — sequences manoeuvres + owns a continuous speed/warp scalar.
- `EventBus` — the bidirectional, seeded, platform-neutral event channel.
- A **transient-envelope layer** in `ReactiveWorld` so discrete events can react the
  world *without* corrupting the slow `threat` arc.

Brick A introduces **no new geometry, no new scenes, and no new transition.** It is
proven by re-routing two *existing* behaviours (the rift barrel-roll and the
`onIntrusion → hesitation` kick) through the new machinery with **zero visible change.**

### North-star acceptance test (built in Brick B, but A must make it possible)

The canonical first transition we are building toward — captured here so A's shape is
correct from day one:

> **Terrain → City "approach & dive":** (1) pull up out of the terrain, (2) engage the
> warp boost, (3) swap the world *under the warp streak* (unseen), (4) emerge high above
> a megacity grid, camera pitched down, (5) descend into a street canyon and hand off to
> the City scene.

This is a **sequenced manoeuvre chain with a continuous clock** + a **smooth speed ramp**.
The `FlightDirector` is exactly the engine that runs such a chain. A must therefore
support: queued, chained manoeuvres that do not re-center/re-level between steps, and a
continuous speed scalar that can ramp. The transition geometry itself is **out of scope
for A** (it is Brick B).

## 2. Goals / Non-goals

**Goals**

- A `FlightDirector` object, instantiated by the Engine (web) / Renderer (native),
  running once per frame at the existing camera post-process seam.
- An injectable, chainable **manoeuvre queue** (reusing CameraFly's C1 `sin²` envelope)
  with a single continuous clock — no per-step re-center hiccup.
- A continuous **speed/warp scalar** threaded to scenes via `ctx.speed()`, layered on top
  of the existing 3-step `SPEED_VALUES` enum (enum becomes the *base*).
- A typed, synchronous, **seeded** `EventBus` (`emit`/`subscribe`), platform-neutral.
- A **transient-envelope layer** in `ReactiveWorld`: discrete events produce one-shot
  additive envelopes on top of the threat-derived multipliers — never overwriting fog/bloom.
- **Camera is always event-reactive:** scene-authored baseline + always-on event/manoeuvre
  overlay from the director; full director ownership is reserved for transitions (Brick B).
- **Determinism:** all director/event randomness flows through the seeded rng. Fix the two
  existing `Math.random()` leaks (tunnel boost shake, rift roll gap) as part of this work.
- **Parity:** web-first, native fast-follow; data shapes structurally identical so the
  files diff cleanly.
- A `?event=<kind>` web harness hook (and `--event` native harness) to tune each reaction
  in isolation, mirroring the existing `?threat=` / `--threat` workflow.

**Non-goals (explicitly deferred)**

- B: real transitions / the Terrain→City approach / warp-as-seam / bridge geometry.
- C: the procedural itinerary/grammar + co-driving narrative phase from the route.
- D: combat actors (drone, debris, CORP units, incoming fire).
- E: multi-speaker radio narrative.
- F: granular per-scene settings + UI.
- Any global camera rail spanning *all* scenes (the warp-tunnel-as-seam decision makes it
  unnecessary).
- Any new on-screen settings UI.

## 3. Architecture

### 3.1 The three new units

#### `FlightDirector` — `src/engine/modes/flight-director.ts`

Single purpose: **post-process the camera each frame** according to (a) an active
manoeuvre chain and (b) inbound events, and **own the continuous speed scalar.**

```ts
type ManoeuvreKind = 'bank' | 'dive' | 'climb' | 'kick'  // 'kick' = the generalized hesitation pull
interface Manoeuvre { kind: ManoeuvreKind; dur: number; dir: number; intensity: number }

interface CamPose { x: number; y: number; pitch: number; yaw: number; roll: number }

interface FlightDirector {
  /** advance internal clock, drain queued manoeuvres; called once/frame. */
  update(t: number, dt: number): void
  /** apply additive overlay to the pose the scene just wrote. Pure-ish; never writes fog/bloom. */
  applyToCamera(base: CamPose): CamPose
  /** continuous speed multiplier (rides on top of the SPEED_VALUES enum base). */
  speed(): number
  /** queue a manoeuvre; chains continuously (no clock reset between steps). */
  enqueue(m: Manoeuvre): void
  /** ownership flag — false in A (scene authors); set true only during a transition (B). */
  ownsCamera: boolean
}
```

- Runs at the **same seam** as today's `pulseHesitation` brake: after the scene updater
  writes the camera, before the parallax snapshot is taken. (Exact line confirmed against
  `core.ts` during implementation; the hesitation envelope is the integration model.)
- The manoeuvre envelope is CameraFly's existing C1 `sin²(πp)` — **value and slope zero at
  both ends** — so chained manoeuvres never snap (the documented roll-snap bug).
- A **single continuous director clock** (not per-manoeuvre `t0`) so a chain
  (climb→warp→descend) flows without the per-instance re-center hiccup the readers flagged.
- `applyToCamera` is **additive on the scene's pose** (the proven parallax/hesitation
  pattern) and must respect the parallax restore/snapshot dance — it modifies, never
  accumulates across frames.

#### `EventBus` — `src/engine/events/bus.ts`

Typed, synchronous, multi-producer/multi-consumer. **Settled inside the conductor's
`update()` before the scene updater runs**, so events are consistent within a frame
(never landing a frame late).

```ts
type FlightEventKind =
  | 'intrusion'      // migrated from narrative.onIntrusion (the A proof)
  | 'manoeuvre'      // a director manoeuvre fired (climb/dive/bank) — for narrative/world to react
  // B–E will extend: 'enterTunnel' | 'shotHit' | 'dodge' | 'unitArrive' | 'unitCrash' | 'hyperdrive'
interface FlightEvent { kind: FlightEventKind; intensity?: number; dir?: number }

interface EventBus {
  emit(e: FlightEvent): void
  subscribe(kind: FlightEventKind | '*', fn: (e: FlightEvent) => void): () => void
}
```

- **Seeded:** any randomness a handler needs (impact direction, jitter) draws from the
  engine's seeded rng — never `Math.random()`.
- **Respects narrative generation-cancellation:** handlers that touch the terminal must
  snapshot/check `generation` exactly as the beat loops do, or they type into a cleared
  prompt. (Relevant from E onward; A's handlers touch only camera/world.)
- Lives in the `src/engine/events/` placeholder dir (created for exactly this).

#### Transient-envelope layer — extend `src/engine/fx/reactive-world.ts`

Generalize the *single* hesitation envelope into a small list of active one-shot
envelopes the conductor advances each frame. Each envelope:

```ts
interface TransientEnvelope { t0: number; dur: number; shape: (p: number) => number; targets: EnvelopeTargets }
```

- Envelopes produce **additive deltas on the threat-derived multipliers** (e.g. a brief
  bloom bump, a chroma spike, a camera kick) — **strictly separate from `threat`.**
- **Single-writer invariant is sacred:** the conductor still only sets `*ThreatMult` /
  `*Add`; the engine still composes `base × mult` once per frame. Envelopes feed the mult,
  **never** write `fog.density` / `bloom.strength` directly.
- **calm mode (`prefers-reduced-motion`)** gates every motion-heavy envelope exactly as
  `onIntrusion` early-returns today.

### 3.2 Tick order (web `core.ts` & native `Renderer.swift`, mirrored)

```
onFrame(conductor)            // ReactiveWorld.update: threat + DRAIN event queue + advance envelopes
  → restore parallax baseline
  → scene.update(t, dt)       // scene writes the baseline camera pose
  → director.update(t, dt)    // advance clock, drain manoeuvre queue
  → cam = director.applyToCamera(cam)   // additive overlay (replaces the inline hesitation brake)
  → parallax snapshot
  → render
```

The existing inline `pulseHesitation` brake is **subsumed** by the director: `intrusion`
becomes an event → a `kick` manoeuvre → the same `sin²` lateral pull. Net behaviour at the
camera is unchanged; the path is now event-driven.

### 3.3 Speed scalar

- `SPEED_VALUES { slow:0.32, norm:1, fast:2.8 }` stays as the **user base**.
- `FlightDirector.speed()` returns `base × directorMultiplier` (1.0 in A; ramps in B/warp).
- Scenes read `ctx.speed()` (new thunk on `SceneCtx`, sibling to `threat()`/`storm()`)
  **instead of** reading the enum directly. In A the value is identical to today, so no
  visible change.

## 4. Determinism

- One seed lineage: `engine.seed`. The director and all event handlers draw from a seeded
  xorshift derived from it (the pattern `ReactiveWorld` already uses for hesitation jitter).
- **Fix the two existing leaks** (so "the film regenerates reproducibly" holds):
  - tunnel auto-BOOST shake (`tunnel.ts`) → seeded.
  - rift barrel-roll gap timing (`rift.ts`) → seeded.
- Same seed ⇒ same film. This is a hard invariant for every later brick.

## 5. Parity plan

- **Web first**, native fast-follow within the same brick.
- New files mirrored 1:1 in concept: `flight-director.ts ↔ FlightDirector.swift`,
  `bus.ts ↔ EventBus.swift`, the ReactiveWorld envelope layer ↔ `Renderer.updateThreat`
  envelope layer.
- Data shapes (`FlightEventKind`, `Manoeuvre`, `TransientEnvelope`) are **structurally
  identical** across web/native so the files diff cleanly.
- Native specifics honoured:
  - The director's per-frame allocations stay inside the `autoreleasepool` (or are
    pre-allocated) — the multi-GB-leak gotcha.
  - Single-threaded `advance → draw` model preserved; no async, no background mutation.
  - Native camera is a per-scene struct with a `viewOverride` matrix slot — the cleaner
    director→camera seam. We keep euler overlay in A; standardizing on a view-matrix
    override is noted for B.

## 6. Migration / proof (the A "done" demo)

1. Route `narrative.onIntrusion` → `EventBus.emit({kind:'intrusion'})`; a subscriber turns
   it into a `kick` manoeuvre. The lateral brake is byte-for-byte the same envelope.
2. Re-express the rift barrel-roll as a director manoeuvre (or have rift enqueue it),
   driven by the seeded clock instead of `Math.random()`.
3. **Verify no behaviour change** via screenshots/logic tests.

## 7. Testing & verification

- **Native logic tests** (`bash scripts/run-native-tests.sh`): determinism — same seed ⇒
  same manoeuvre schedule + same event jitter; envelope math (value+slope 0 at ends).
- **Web typecheck** (`npm run typecheck`) must pass.
- **`verify-crt`** (`node scripts/verify-crt.mjs`): screenshot rift-roll and
  intrusion-hesitation before/after — must be visually identical.
- **`?event=<kind>` harness hook** (web) + `--event` (native harness) to fire one event in
  isolation for tuning, mirroring `?threat=` / `--threat`.
- Host-boundary check still holds: `! grep -r "from 'obsidian'" src/engine/` — the new
  `modes/` and `events/` files must not import `obsidian`.

## 8. Risks & invariants (must not regress)

- **Single-writer fog/bloom.** Conductor sets mults only; engine composes `base × mult`
  once/frame; controller owns bases. Envelopes feed the mult — never the raw density/strength.
- **Parallax restore/snapshot dance.** The director overlays between scene-update and
  parallax snapshot; it modifies the pose, never accumulates.
- **C1 continuity.** All camera motion value+slope zero at manoeuvre ends, or the roll snaps.
- **One continuous clock.** Do not reset CameraFly's per-instance clock on a manoeuvre
  hand-off, or the flight re-centers/re-levels visibly.
- **calm mode.** Every motion-heavy envelope/manoeuvre gated by `prefers-reduced-motion`.
- **Native autoreleasepool + single-thread.** No per-frame leaks, no async mutation.
- **Two hand-mirrored schemas.** Anything added on web must be mirrored native; no codegen.

## 9. Out of scope → next bricks

B (transitions / Terrain→City), C (procedural itinerary + narrative co-drive), D (combat
actors), E (radio narrative), F (per-scene settings UI). Each gets its own spec → plan →
implementation cycle, building on this backbone.
