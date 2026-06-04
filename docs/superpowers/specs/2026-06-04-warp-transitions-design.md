# Warp Transitions — Design (Brick B)

- **Date:** 2026-06-04
- **Status:** Approved (design), implementation pending
- **Author:** Johannes + Claude (pair)
- **Scope:** Brick **B** of the "Procedural Film" roadmap. Builds on Brick A
  (`FlightDirector`, `EventBus`, `speedMul`, `ownsCamera`, transient envelopes).

## 1. Why this exists

Today scenes HARD-CUT: web `controller.switchScene()` fades the canvas to black over a
destructive `loadScene()`; native auto-cycle triggers `CrashFx` and `swapScene()`s at the
black point. The film vision needs the flight to *flow* through scenes via real in-3D
transitions. Brick A built the machinery (a `FlightDirector` that can own the camera and
ramp a `speedMul`); Brick B uses it to replace the cut with a **warp transition**, with
the **Terrain→City approach-and-dive** as the hero.

**Decided in earlier brainstorming (do not re-litigate):** the warp/hyperdrive IS the
transition seam — we accelerate, the world swaps *under the warp streak* (never two worlds
on screen, so no expensive double-buffering on Intel/base-M), and we emerge in the next
scene. Bespoke diegetic bridges (the Terrain→City dive) layer on top of this generic warp.

## 2. Scope / Non-goals

**Goals**

- A **warp transition** that replaces the fade-to-black cut on both platforms.
- A **generic warp** profile for any scene pair, plus the **Terrain→City "approach &
  dive"** hero profile (climb → warp → descend into the street canyon).
- The transition is a small **state machine inside `FlightDirector`** (windup → warp →
  swap → emerge) with a stage clock, a `speedMul` ramp, FOV/pose control under
  `ownsCamera`, and a **swap callback** fired at the warp peak.
- **Integration:** web `switchScene` delegates to the director transition (keeping the
  palette rotation); native auto-cycle uses the warp instead of `CrashFx`.
- **calm mode** (`prefers-reduced-motion`): a gentle, short transition — no FOV push / no
  shake / reduced streak — still functional.
- **Determinism:** transitions are scripted (deterministic); any variation seeded.
- **Parity:** web-first, native fast-follow; identical profiles + timings.
- A `?transition=<fromScene>-<toScene>` web harness hook to trigger one transition on
  demand for tuning (mirrors `?event=` / `?threat=`).

**Non-goals (deferred)**

- **Brick C:** the seed-procedural itinerary/grammar (B keeps the existing *linear*
  `cycleScene` order as the trigger) and co-driving the narrative phase from the route.
- Other bespoke transitions (Terrain→Rift dive, pull-up-to-void, etc.) — generic warp
  covers all non-hero pairs for now.
- Double-buffering / two live worlds (explicitly rejected — swap-under-streak instead).
- New scenes or new geometry.
- Combat actors (D), radio narrative (E), per-scene settings UI (F).
- The narrative end-of-shift crash (`playCrash`) — **untouched**; it is a separate
  dramatic beat from a flight transition.

## 3. North-star (the hero): Terrain → City "approach & dive"

| Stage | On screen | Mechanic |
|---|---|---|
| 1 **windup** | nose up, terrain drops away | director owns camera; enqueue a `climb`; `speedMul` begins to ramp |
| 2 **warp** | FOV push, streak, chroma/bloom/trail surge | `speedMul` ramps to warp; FOV push; a transient envelope (bloom/chroma) + trail surge build to a peak |
| 3 **swap** | *unseen* under the peak | `onSwap()` → `loadScene('city')` / `swapScene()`; dispose+rebuild hidden behind the brightest/fastest frame |
| 4 **emerge** | high above the city grid, pitch down → descend into a street canyon | director drives `cam.y` from a high entry altitude down to the scene's natural altitude + recovers FOV, then releases ownership (scene resumes) |

The generic profile is the same four stages with a neutral windup (slight centre + small
nose-up) and a neutral emerge (ease FOV/speed back, no scripted descent).

## 4. Architecture

### 4.1 Transition state machine in `FlightDirector`

Extend the Brick-A `FlightDirector` (do NOT add a 4th cross-platform unit — a transition
is the director's job: "full ownership during transitions", per the A design).

New state:

```ts
type TransitionStage = 'windup' | 'warp' | 'emerge';   // 'swap' = an instant fired at the warp PEAK (mid-warp), maximally hidden
interface TransitionProfile {
  windupDur: number; warpDur: number; emergeDur: number;
  warpSpeed: number;        // peak speedMul (e.g. 6)
  fovPush: number;          // degrees added at peak (e.g. +28)
  windup?: Manoeuvre;       // e.g. climb (hero) or a gentle centre (generic)
  entryAltitude?: number;   // emerge starts here and eases to the scene's natural cam.y (hero descend)
}
interface ActiveTransition { profile: TransitionProfile; stage: TransitionStage; t0: number; swapped: boolean; onSwap: () => void; }
```

New API on `FlightDirector`:

- `beginTransition(profile: TransitionProfile, onSwap: () => void): void` — start the
  sequence, set `ownsCamera = true`, reset the stage clock.
- The per-frame `update(t, dt)` advances the stage clock, ramps `speedMul` (0→peak→0
  across warp via a smooth curve), fires `onSwap()` exactly once at the warp peak (the
  windup→… boundary chosen so the swap lands at maximum cover), and on the final stage end
  sets `ownsCamera = false` (scene resumes).
- During a transition, the camera write becomes an **override** (see 4.2).
- `inTransition: boolean` getter so the controller/engine can branch (e.g. suppress the
  auto-cycle re-trigger, keep the HUD scene-label flash at swap).

`speedMul` (private, fixed 1 in Brick A) is now driven by the ramp during a transition and
returns to 1 after. `ctx.speed()` already threads it to scenes, so the world-scroll
naturally accelerates during the warp with no scene changes.

### 4.2 Camera ownership = override (not just overlay)

Brick A's `apply()` is an **additive overlay** after the scene writes. Brick B adds a
transition path: when `ownsCamera`, the director **sets** the transition-relevant axes
after the scene has written, overriding them for the duration:

- `windup`/`emerge`: pitch (`rotation.x`) for climb/dive; `position.y` eased for the hero
  descend; `position.x` gently centred.
- `warp`: FOV push (`cam.fov` + `updateProjectionMatrix()` web / `camera.fovDegrees`
  native) + a small seeded shake.

This needs the director's transition write to reach the **full camera** (pitch + FOV), not
just the minimal `CameraTarget` from A. The engine/renderer passes the real camera to a
`applyTransition(cam)` (web: `THREE.PerspectiveCamera`; native: `inout Camera`) and calls
`updateProjectionMatrix()` when the director changed FOV. Outside a transition, the
Brick-A additive `apply()` path is unchanged.

### 4.3 Transition profiles (data, mirrored web/native)

A small table keyed by `(toScene)` (and optionally `fromScene`), with a `DEFAULT` generic
profile and a `terrain→city` hero entry. Lives beside the scene data so both engines stay
in lockstep (web `src/engine/modes/transition-profiles.ts`; native a struct table). New
bespoke transitions in later bricks are new rows — no mechanism change.

### 4.4 Integration points

- **Web** `controller.switchScene(id)`: replace the CSS fade-to-black body with
  `engine.director.beginTransition(profileFor(cur, id), () => { engine.loadScene(id); /* HUD: setMode/setTri/flashSceneLabel; fog rebase; stats */ })`. The palette rotation in
  `cycleScene()` stays (applied at `onSwap`, so colour flips under the streak too).
- **Native** `Renderer.advance` auto-cycle (currently `crash.trigger()` →
  `swapScene()`): replace with `director.beginTransition(profileFor(cur, next)) { self.swapScene() }`. The diegetic CRT power-on stays for first boot.
- **Both:** `loadScene`/`swapScene` are called at the warp peak (synchronous rebuild
  hidden under the brightest frame — the existing fade already hides a synchronous
  `loadScene`, so this is not a new hitch risk).

## 5. Stage timeline (initial tuning, harness-adjustable)

Generic: windup 0.6 s · warp 1.4 s (peak at ~0.7 s where the swap fires) · emerge 1.0 s
(~3 s total). Hero Terrain→City: windup 1.2 s (climb) · warp 1.6 s · emerge 2.2 s (the
descent) (~5 s). calm mode: windup 0.2 s · warp 0.5 s (no FOV/shake) · emerge 0.4 s.

## 6. Determinism

Transitions are scripted from the profile; the only randomness is the warp shake, drawn
from the director's seeded rng (added in A). Same seed ⇒ same transition. No `Math.random`.

## 7. Parity

Web-first, native fast-follow within the brick. The state machine, profile table, ramp
curve, and timings are structurally identical across `flight-director.ts ↔
FlightDirector.swift` and the profile tables. Native honours the autoreleasepool /
single-thread rules; `loadScene`↔`swapScene` already mirror.

## 8. Testing & verification

- **Native logic tests** (`run-native-tests.sh`): the stage clock advances and retires
  correctly; the `speedMul` ramp is C1-continuous (value+slope 0 at the ends → no snap
  across the swap); `onSwap` fires exactly once at the warp peak; `ownsCamera` is true
  during and false after.
- **Web** `typecheck` + `verify-crt`: capture a mid-warp frame (streak/FOV-push visible)
  and a post-emerge city frame via the `?transition=terrain-city` harness; confirm no
  black-flash, no roll snap, and the descent lands at the city's normal altitude.
- **calm mode**: confirm the reduced transition still swaps without the motion-heavy warp.
- Host-boundary: `modes/transition-profiles.ts` must not import `obsidian`.

## 9. Risks & invariants (must not regress)

- **Single-writer fog/bloom.** The warp's bloom/chroma surge goes through the Brick-A
  transient-envelope mults — never raw `fog.density`/`bloom.strength`.
- **C1 continuity across the swap.** The `speedMul` ramp and camera pose must be
  value+slope continuous at the warp→emerge boundary AND across `loadScene` (which resets
  FOV + re-seeds rng); the director re-pushes FOV during emerge so the reset is invisible.
- **calm mode.** Motion-heavy warp (FOV push, shake, fast ramp) gated by
  `prefers-reduced-motion`; the gentle path still swaps.
- **Narrative crash untouched.** `playCrash` (end-of-shift terminal reset) remains a
  separate beat; transitions never call it.
- **Parallax during transition.** The director's override runs at the existing post-scene
  seam and must respect the parallax restore/snapshot dance (as A's overlay does).
- **Auto-cycle re-trigger.** While `inTransition`, the auto-cycle/`cycleScene` must not
  fire again (guard on `director.inTransition`).
- **Two hand-mirrored engines.** Every web change mirrored in Swift; no codegen.

## 10. Out of scope → Brick C

The seed-procedural itinerary/grammar (replace the linear `cycleScene` next-pick with an
ordered, seed-deterministic scene→transition→scene graph) and co-driving the narrative
phase from the route. B's profile table + `beginTransition` are exactly what C's itinerary
will call.
