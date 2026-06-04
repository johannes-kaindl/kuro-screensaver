# Combat Actors — Design (Brick D)

- **Date:** 2026-06-04
- **Status:** Approved (design), implementation pending
- **Author:** Johannes + Claude (pair)
- **Scope:** Brick **D** of the "Procedural Film" roadmap. Builds on A (`EventBus`,
  `FlightDirector` manoeuvres, transient envelopes), B (warp transitions), C (phase-driven
  film + foreshadow lines).

## 1. Why this exists

The film now flies itself and narrates the journey, but the world is empty of agents. Brick
D adds **dynamic combat actors** so the story has stakes: a hostile **compromised entity**
that lurks and fires, and **CORP support units** that arrive then flee or crash — the
operator's screen reacting dramatically to it all.

**User's chosen shape (do not re-litigate):** D covers the **antagonist + CORP support
units** together. The antagonist is a **lurking hunter at the edge of view** (subtle build,
occasional tracers, escalating in PANIC). It is **cinematic, not a game** — no health/damage
model; the screen reacts. Pursuit-mode + debris-dodging are a later brick.

## 2. Scope / Non-goals

**Goals**

- A lightweight, engine/renderer-owned **`ActorSystem`**: actors are meshes/DrawItems with a
  path + lifecycle, in a group that **persists across `loadScene`/`swapScene`** (an actor can
  follow you through a warp). Dead actors are culled + disposed.
- A **`CombatDirector`** (modes/): reads `threat`/phase, seeded-spawns/retires actors, and
  emits combat events on the **EventBus**.
- **Antagonist** (compromised entity): an enemy-coloured drone that weaves at the edge of
  view and fires tracers toward the camera (rate ∝ threat). Appears from ALARM, escalates in
  PANIC, gone at the crash. `infectable`→enemy colour.
- **CORP support units**: accent-coloured drones that arrive, hold briefly, then **flee or
  crash** (seeded). Triggered on a "support call" beat in ALARM/PANIC.
- **Combat events** (`incomingFire`, `unitArrive`, `unitCrash`) → world reaction (camera
  kick + bloom/chroma flash via the A transient layer + a short CRT poke) **and** a light
  terminal line from a `COMBAT_LINES` pool.
- **Determinism** (seeded), **calm mode** (no camera kick / CRT poke / tracers-as-motion),
  **parity** web↔native.

**Non-goals (deferred)**

- Pursuit-mode (camera actively chases a drone) + debris-dodging — a later brick (D-next).
- Multi-speaker radio cross-talk between units — **Brick E** (D's combat lines are
  single-speaker hints, like C's foreshadow).
- A health/damage/score model — purely cinematic.
- New scenes; per-scene settings UI (F).

## 3. Architecture

### 3.1 `ActorSystem` (engine/renderer-owned, persistent)

The engine clears the scene `world` group on `loadScene`; actors must NOT be in it. Add a
separate **persistent actors group** the engine owns and updates.

```ts
// web
export interface Actor {
  obj: THREE.Object3D;                                   // lives in engine.actorsGroup
  update(t: number, dt: number, cam: THREE.PerspectiveCamera): boolean;  // false ⇒ dead
  dispose(): void;
}
```
- Engine: `actorsGroup = new THREE.Group()` added to `this.scene` once (NOT cleared by
  loadScene); `actors: Actor[]`. Each frame after the scene updater: `actors = actors.filter(a => { const alive = a.update(...); if (!alive) { a.obj.parent?.remove(a.obj); a.dispose(); } return alive; })`.
- Native: `Renderer.actors: [Actor]` (protocol `Actor { var items: [DrawItem] {get}; func update(t,dt,cam) -> Bool }`); the draw loop iterates `scene.items` + `actors.flatMap{$0.items}`; `advance` updates + culls. DrawItems use `storageModeShared` if they stream (per the autorelease/single-writer rules).

### 3.2 `CombatDirector` (`src/engine/modes/combat-director.ts` + Swift mirror)

Owns the ActorSystem and the spawn cadence. Pure-ish logic + seeded rng.

```ts
class CombatDirector {
  constructor(seed: number, bus: EventBus, actors: ActorHandle);
  /** called each frame with the live signals. */
  update(t: number, dt: number, threat: number, phase: Phase, cam: THREE.PerspectiveCamera): void;
}
```
- **Antagonist:** spawn when `threat > 0.35` (≈ALARM) and none alive; despawn when
  `threat < 0.05` (the crash exhale). While alive, fire a tracer every `lerp(4s, 1s, threat)`
  (seeded jitter) → `bus.emit({kind:'incomingFire', intensity: threat})`.
- **CORP support:** on a seeded "support call" (low-probability per second during
  ALARM/PANIC, max 1–2 concurrent), spawn a support unit → `bus.emit({kind:'unitArrive'})`;
  after a hold, seeded flee-or-crash; crash → `bus.emit({kind:'unitCrash'})`.
- Actor motion is the actor's own `update` (weave/arrive/flee/crash paths); the
  CombatDirector only spawns/retires + emits events.

### 3.3 Actors

- **AntagonistDrone:** a small enemy-coloured mesh (icosahedron + a couple of fins) anchored
  at an edge-of-view offset relative to the camera (lateral + slightly behind/ahead),
  weaving (multi-freq sin, like CameraFly). On a fire beat it spawns a **tracer**: a brief
  bright elongated segment from the drone toward the camera, fading over ~0.3 s. Uses the
  `enemyMats` pool so `setEnemyFraction` tints it.
- **SupportUnit:** an accent-coloured drone; lifecycle `arrive` (eased fly-in from a side) →
  `hold` (brief, may emit a friendly tracer toward the antagonist) → `flee` (accelerate off)
  or `crash` (downward spiral + spin, then dead + `unitCrash`).

### 3.4 Event reactions (conductor + terminal)

Extend `FlightEventKind` with `incomingFire | unitArrive | unitCrash`. The conductor
(`ReactiveWorld` / `Renderer`) subscribes:

- `incomingFire`: `engine.director.enqueue(kick)` (camera flinch) + a bloom/chroma transient
  envelope (`pulse`) + a short CRT chroma/tear poke (reuse the existing CRT machinery; a
  small additive `setCrtThreat` blip or a glitch nudge). calm mode → skip the motion/CRT,
  keep it line-only.
- `unitArrive` / `unitCrash`: a brief bloom flash (`pulse`); crash slightly stronger.

The **terminal** emits a combat line: a `COMBAT_LINES: Record<eventKind, string[]>` pool
(script-bank / Script.swift), e.g. `incomingFire → "// taking fire"`, `unitArrive → "//
CORP-7 inbound"`, `unitCrash → "// unit down — no chute"`. Emitted via `hud.addLine('HQ' or
'WARNING')`, respecting the generation guard. (Full unit-to-unit dialogue = E.)

## 4. Data flow

```
each frame: CombatDirector.update(threat, phase, cam)
  → spawn/retire antagonist + support units (seeded)
  → antagonist fire beat → bus.emit(incomingFire)
                              → conductor: kick + flash + CRT poke
                              → terminal: COMBAT_LINES line
  → support lifecycle → bus.emit(unitArrive/unitCrash) → flash + line
ActorSystem updates + culls all actors (persist across warp transitions)
crash (threat→0) → antagonist despawns
```

## 5. Determinism / calm / parity

- All spawn timing, fire cadence, flee-vs-crash, jitter from the seeded rng (engine seed). No
  `Math.random`. Same seed ⇒ same combat.
- calm mode: no camera kick, no CRT poke, no tracer streaks; combat lines still type; actors
  may still appear but move gently (or are suppressed — gate motion-heavy bits on `calm`).
- Web-first, native fast-follow. Actor/event/spawn logic is the cheap-to-parity layer; the
  drone/tracer geometry is the twice-written part (web THREE meshes ↔ native DrawItems).

## 6. Testing & verification

- **Native logic tests**: CombatDirector determinism (same seed ⇒ same spawn/fire schedule);
  antagonist spawns above the threat threshold and despawns below it; fire cadence shortens
  as threat rises; support flee-vs-crash is seeded-stable.
- **Web** `typecheck` + `verify-crt`: drive `?threat=0.9` and confirm the antagonist + a
  tracer render; drive a fast shift and confirm a support unit arrives + a combat line.
- Host-boundary: `modes/combat-director.ts` must not import `obsidian`.

## 7. Risks & invariants (must not regress)

- **Actors persist across scene swaps:** they live in the engine's actors group, NOT the
  scene `world` (which loadScene disposes). Their geometry must be disposed on cull (no leak)
  and stay inside the native autoreleasepool.
- **Single-writer fog/bloom:** combat flashes go through the A transient-envelope mults /
  `pulse`, never raw fog/bloom.
- **Camera reactions are post-scene modifiers** (the A director seam), never accumulators.
- **Determinism + calm + two hand-mirrored engines** as in every brick.
- **Perf:** a few actors + short-lived tracers only; cap concurrent actors (1 antagonist +
  ≤2 support). Tracers are cheap fading segments, not persistent geometry. Respect the native
  adaptive-quality budget; if it trips, the CombatDirector can thin tracers.

## 8. Out of scope → next bricks

D-next (pursuit-mode + debris-dodging), E (multi-speaker radio cross-talk between the units),
F (per-scene settings UI).
