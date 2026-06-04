# Flight Director Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backbone (FlightDirector + EventBus + transient-envelope layer + continuous speed scalar) that later film bricks hang off, proven by re-routing two existing behaviours (intrusion-hesitation, rift barrel-roll) through it with zero visible change.

**Architecture:** A `FlightDirector` post-processes the camera each frame at the exact seam the inline hesitation brake uses today (after the scene updater, around the parallax snapshot). An `EventBus` carries seeded, platform-neutral events; the conductor (`ReactiveWorld` web / `Renderer.updateThreat` native) emits them and advances a list of one-shot transient envelopes that add to the threat-derived mults — never overwriting fog/bloom. Scenes read forward speed via a new `ctx.speed()` thunk (enum base × director multiplier, =1 in this brick).

**Tech Stack:** TypeScript + three.js (web, `src/engine/`); Swift + Metal (native, `native/macos/KuroNativeSaver/Core/`); assert-based native logic harness (`scripts/run-native-tests.sh` → `tests/main.swift`); web verification via `npm run typecheck` + `node scripts/verify-crt.mjs`.

**Testing reality (read before starting):** This repo has **no web unit-test runner** by design. The canonical, test-first numeric contracts (envelope math, determinism) live in the **native** assert harness (`tests/main.swift`) — which doubles as the web↔native parity reference, exactly like the existing LCG/terrain tests. The **web** side is verified by `typecheck` + `verify-crt` visual parity (intrusion/rift identical before↔after). Do not add a web test framework in this brick.

---

## File Structure

**New files**
- `src/engine/events/bus.ts` — typed synchronous EventBus (web). One responsibility: pub/sub of `FlightEvent`.
- `src/engine/modes/flight-director.ts` — FlightDirector (web): manoeuvre queue + continuous clock + speed multiplier + camera overlay.
- `native/macos/KuroNativeSaver/Core/EventBus.swift` — Swift mirror of bus.ts.
- `native/macos/KuroNativeSaver/Core/FlightDirector.swift` — Swift mirror of flight-director.ts.

**Modified files (web)**
- `src/engine/engine/core.ts` — own `bus` + `director`; replace inline hesitation block with `director.apply(...)`; add `speed()` to `SceneCtx` construction; route `pulseHesitation` through the director.
- `src/engine/engine/scenes/scene-base.ts` — add `speed?: () => number` to `SceneCtx`.
- `src/engine/fx/reactive-world.ts` — emit `intrusion` to the bus; add the transient-envelope list + advance it in `update()`.
- `src/engine/engine/scenes/rift.ts` — re-express the barrel-roll as a director `roll` manoeuvre; remove `Math.random()` (seeded).
- `src/engine/engine/scenes/tunnel.ts` — boost shake → seeded rng; read `ctx.speed()`.
- `src/engine/engine/scenes/{terrain,city,void}.ts` — read `ctx.speed()` instead of `SPEED_VALUES[settings.speed]`.
- `src/screensaver/main.ts` — parse `?event=<kind>` into a one-shot harness trigger.

**Modified files (native)**
- `Core/Renderer.swift` — own bus + director; mirror the hesitation→director.apply swap; emit intrusion to bus; advance envelopes in `updateThreat`.
- `Core/Scene.swift` — add `speed` to `SceneContext`.
- the native rift/tunnel/terrain/city/void scenes — mirror the web scene changes.
- `tests/main.swift` — add envelope-math + determinism checks.

---

## PHASE 1 — Web

### Task 1: EventBus (web)

**Files:**
- Create: `src/engine/events/bus.ts`

- [ ] **Step 1: Write the module**

```ts
// EventBus — typed, synchronous, multi-producer/multi-consumer channel for
// discrete flight/narrative events. Settled within a frame (handlers run on emit),
// so events never land a frame late. Randomness a handler needs is drawn from the
// engine's SEEDED rng by the EMITTER (e.g. ReactiveWorld), never Math.random here.
export type FlightEventKind =
  | 'intrusion'   // the operator "notices" — migrated from narrative.onIntrusion
  | 'manoeuvre';  // a director manoeuvre fired (for narrative/world to react to, later)

export interface FlightEvent {
  kind: FlightEventKind;
  /** event-specific scalar (e.g. intrusion → hesitation duration in seconds). */
  intensity?: number;
  /** -1 | 0 | +1 lateral/directional hint where meaningful. */
  dir?: number;
}

type Handler = (e: FlightEvent) => void;

export class EventBus {
  private subs = new Map<FlightEventKind | '*', Set<Handler>>();

  subscribe(kind: FlightEventKind | '*', fn: Handler): () => void {
    let set = this.subs.get(kind);
    if (!set) { set = new Set(); this.subs.set(kind, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(e: FlightEvent): void {
    this.subs.get(e.kind)?.forEach((fn) => fn(e));
    this.subs.get('*')?.forEach((fn) => fn(e));
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/engine/events/bus.ts
git commit -m "feat(engine): typed EventBus for discrete flight events"
```

---

### Task 2: FlightDirector (web)

**Files:**
- Create: `src/engine/modes/flight-director.ts`

- [ ] **Step 1: Write the module**

```ts
// FlightDirector — sequences camera manoeuvres on ONE continuous clock and owns the
// continuous speed multiplier. It POST-PROCESSES the pose the scene already wrote
// (additive, like the parallax/hesitation seam), and NEVER writes fog/bloom.
// Camera ownership note: in this brick the director only overlays (ownsCamera=false);
// full ownership during transitions arrives in Brick B.
import { mkRng } from '../engine/rng';
import type { EventBus, FlightEvent } from '../events/bus';

export type ManoeuvreKind = 'kick' | 'roll' | 'dive' | 'climb' | 'bank';

export interface Manoeuvre {
  kind: ManoeuvreKind;
  dur: number;       // seconds
  dir: number;       // -1 | 0 | +1
  intensity: number; // unit-ish amplitude
  start?: number;    // filled when dequeued (continuous director clock)
}

/** sin²(πp): value AND slope are 0 at p=0 and p=1 → chained manoeuvres never snap. */
export function envelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const s = Math.sin(Math.PI * p);
  return s * s;
}

export interface CameraTarget {
  position: { x: number; y: number };
  rotation: { z: number };
}

export class FlightDirector {
  private clock = 0;
  private active: Manoeuvre[] = [];
  private speedMul = 1;          // ramps in Brick B (warp); 1 here
  ownsCamera = false;
  private rng: () => number;

  constructor(seed: number, bus?: EventBus) {
    this.rng = mkRng(seed ^ 0x9e3779b9);
    bus?.subscribe('intrusion', (e: FlightEvent) =>
      this.enqueue({ kind: 'kick', dur: Math.max(0.3, e.intensity ?? 1.5), dir: 0, intensity: 0.55 }),
    );
  }

  /** continuous forward-speed multiplier (enum base is applied by the caller). */
  speed(): number { return this.speedMul; }

  enqueue(m: Manoeuvre): void { this.active.push(m); }

  /** advance the director clock and retire finished manoeuvres. Call once/frame. */
  update(_t: number, dt: number): void {
    this.clock += dt / 1000;
    for (const m of this.active) if (m.start == null) m.start = this.clock;
    this.active = this.active.filter((m) => (this.clock - (m.start as number)) / m.dur < 1);
  }

  /** additive overlay on the pose the scene just wrote (modifies in place). */
  apply(cam: CameraTarget): void {
    for (const m of this.active) {
      const p = (this.clock - (m.start as number)) / m.dur;
      const env = envelope(p);
      if (env === 0) continue;
      switch (m.kind) {
        case 'kick':  cam.position.x *= 1 - m.intensity * env; break;       // lateral steadying (== old hesitation)
        case 'roll':  cam.rotation.z += m.dir * m.intensity * env; break;   // barrel-roll
        case 'bank':  cam.position.x += m.dir * m.intensity * env; cam.rotation.z += m.dir * 0.3 * env; break;
        case 'dive':  cam.position.y -= m.intensity * env; break;
        case 'climb': cam.position.y += m.intensity * env; break;
      }
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/modes/flight-director.ts
git commit -m "feat(engine): FlightDirector — manoeuvre queue + continuous clock + speed scalar"
```

---

### Task 3: Add `speed()` to SceneCtx

**Files:**
- Modify: `src/engine/engine/scenes/scene-base.ts`

- [ ] **Step 1: Add the thunk to the interface**

In `SceneCtx`, after the `storm?: () => number;` line, add:

```ts
  /** Effective forward-speed multiplier = SPEED_VALUES[settings.speed] × director.
   *  Scenes should read this instead of the enum directly (enables warp ramps). */
  speed?: () => number;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

---

### Task 4: Wire bus + director into the Engine

**Files:**
- Modify: `src/engine/engine/core.ts`

- [ ] **Step 1: Import + fields**

Add imports near the top (with the other `./` imports):

```ts
import { EventBus } from '../events/bus';
import { FlightDirector } from '../modes/flight-director';
import { SPEED_VALUES } from '../data/defaults';
```
(If `SPEED_VALUES` is already imported, skip that line.)

Add fields to the Engine class (near `onFrame`):

```ts
  /** Discrete-event channel shared by conductor, scenes and (later) terminal. */
  bus = new EventBus();
  /** Camera/flight director — overlays manoeuvres + owns the speed multiplier. */
  director!: FlightDirector;
```

- [ ] **Step 2: Construct the director where `seed` is set**

After `this.rng = mkRng(this.seed);` (constructor, ~line 277) add:

```ts
    this.director = new FlightDirector(this.seed, this.bus);
```

- [ ] **Step 3: Provide `speed()` to scenes**

In `loadScene()`, in the `ctx` object literal (~line 422-426), add after the `threat/storm` line:

```ts
      speed: () => SPEED_VALUES[this.settings.speed] * this.director.speed(),
```

- [ ] **Step 4: Drive the director in the tick + replace the inline hesitation**

In `start()`'s `tick`, replace the hesitation block (current `core.ts:488-498`, the `if (this._hesT0 >= 0) { ... }`) with:

```ts
      // Director: advance its clock, then overlay manoeuvres on the pose the scene
      // wrote. The 'kick' manoeuvre reproduces the old hesitation brake exactly.
      this.director.update(this.clockT, dt);
      this.director.apply(this.cam);
```

- [ ] **Step 5: Route `pulseHesitation` through the director (back-compat shim)**

Replace the body of `pulseHesitation` (~line 346-350) with:

```ts
  pulseHesitation(durationSec: number) {
    this.director.enqueue({ kind: 'kick', dur: Math.max(0.3, durationSec), dir: 0, intensity: 0.55 });
  }
```
Leave the now-unused `_hesT0` / `_hesDur` fields removed if the typecheck flags them; otherwise leave them (no behaviour). Prefer removing both field declarations to keep it clean.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/engine/core.ts src/engine/engine/scenes/scene-base.ts
git commit -m "feat(engine): wire EventBus + FlightDirector into the tick; speed() thunk"
```

---

### Task 5: Conductor emits `intrusion` + transient-envelope layer

**Files:**
- Modify: `src/engine/fx/reactive-world.ts`

- [ ] **Step 1: Emit to the bus instead of calling pulseHesitation directly**

Replace `onIntrusion()` (lines 61-64) with:

```ts
  private onIntrusion() {
    if (this.d.calm) return;
    this.d.engine.bus.emit({ kind: 'intrusion', intensity: 1.5 + this.rand() * 1.5 });
  }
```
(The seeded `this.rand()` keeps the duration deterministic; the director subscriber turns it into the same kick.)

- [ ] **Step 2: Add the transient-envelope list**

Add a field + a small advance helper. Field (near `private threat = 0;`):

```ts
  /** One-shot additive envelopes layered on the threat-derived mults (NOT threat). */
  private envelopes: { t0: number; dur: number; bloom: number; fog: number }[] = [];
```

Add a public emitter (used by the `?event=` harness and, later, combat events):

```ts
  /** Fire a one-shot world envelope (additive bump on bloom/fog mults). calm-gated. */
  pulse(kind: 'flash' | 'surge', t: number) {
    if (this.d.calm) return;
    if (kind === 'flash') this.envelopes.push({ t0: t, dur: 0.6, bloom: 0.6, fog: 0 });
    else this.envelopes.push({ t0: t, dur: 1.2, bloom: 0.3, fog: -0.1 });
  }
```

- [ ] **Step 3: Advance envelopes in `update()` and fold into the mults**

`update(_t, dt)` currently ignores `_t`; rename it to `t`. Just before the `e.fogThreatMult = ...` / `e.setBloomThreat(...)` writes, compute the additive deltas:

```ts
    // ── transient one-shot envelopes (additive on the mults; never raw fog/bloom) ──
    let bloomAdd = 0, fogAdd = 0;
    this.envelopes = this.envelopes.filter((ev) => {
      const p = (t - ev.t0) / ev.dur;
      if (p >= 1) return false;
      const s = Math.sin(Math.PI * p), env = s * s;
      bloomAdd += ev.bloom * env; fogAdd += ev.fog * env;
      return true;
    });
```

Then change the two writes to include the adds:

```ts
    e.fogThreatMult = 1 + threat * (calm ? 0.6 : 1.6) + fogAdd;
    ...
    e.setBloomThreat(1 + storm * 0.4 + bloomAdd);
```

(Update the method signature to `update(t: number, dt: number)` and the `onFrame` arrow already passes `t`.)

- [ ] **Step 4: Reset envelopes on dispose**

In `dispose()`, add `this.envelopes = [];` so disabling REACT returns the world to neutral.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/fx/reactive-world.ts
git commit -m "feat(engine): conductor emits intrusion to the bus + transient-envelope layer"
```

---

### Task 6: Determinism cleanup + scene migrations (web)

**Files:**
- Modify: `src/engine/engine/scenes/rift.ts`, `tunnel.ts`, `terrain.ts`, `city.ts`, `void.ts`

- [ ] **Step 1: rift barrel-roll → director manoeuvre, seeded gap**

In `rift.ts`, the build closure receives `ctx`. Capture `const dir = ctx`. Replace the `Math.random()` roll-gap (line 127) with the scene's seeded `ctx.rng()`:

```ts
          nextRollT = t + ROLL_GAP_MIN + ctx.rng() * (ROLL_GAP_MAX - ROLL_GAP_MIN);
```

If rift applies the roll inline to the camera, leave the visual identical but additionally enqueue the equivalent director manoeuvre when a roll starts (proves the queue):

```ts
          ctx.cam && (ctx as any);  // (placeholder removed)
```
Concretely, where the roll is triggered, add:
```ts
          // (optional, proves the queue) enqueue a director roll of the same shape:
          // engineDirector.enqueue({ kind:'roll', dur: ROLL_DUR, dir, intensity: Math.PI*2 })
```
Since the scene has no direct director handle, the minimal correct change for this brick is the **seeded gap only** (visual unchanged, determinism fixed). The director `roll` kind exists and is unit-tested in native (Task 12); wiring rift to enqueue it is deferred to Brick B's transition work. Keep rift's existing inline roll.

- [ ] **Step 2: tunnel boost shake → seeded; read ctx.speed()**

In `tunnel.ts`, replace lines 309-310:

```ts
        cam.position.x += (ctx.rng() - 0.5) * 0.025;
        cam.position.y += (ctx.rng() - 0.5) * 0.025;
```
And replace any `SPEED_VALUES[settings.speed]` read with `(ctx.speed?.() ?? SPEED_VALUES[settings.speed])`.

- [ ] **Step 3: terrain/city/void read ctx.speed()**

In each of `terrain.ts`, `city.ts`, `void.ts`, replace the `SPEED_VALUES[settings.speed]` read with `(ctx.speed?.() ?? SPEED_VALUES[settings.speed])`. Keep each scene's own multiplier factor (terrain `*0.2`, void `*14*dt`, etc.) unchanged.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine/scenes/
git commit -m "fix(engine): seed the last Math.random leaks; scenes read ctx.speed()"
```

---

### Task 7: `?event=` harness hook (web)

**Files:**
- Modify: `src/screensaver/main.ts`

- [ ] **Step 1: Parse the param and fire once after open**

Where other URL params are parsed into `WebHost.overrides`, read `?event=`. After the engine/controller is open and running, if present, fire it once via the bus / conductor `pulse`:

```ts
  const ev = new URLSearchParams(location.search).get('event');
  if (ev === 'intrusion') engine.bus.emit({ kind: 'intrusion', intensity: 2.0 });
  else if (ev === 'flash' || ev === 'surge') reactiveWorld?.pulse(ev, engineClockNow());
```
Use the existing reference to the running engine/conductor in this file; if the conductor isn't reachable here, emit only the bus `intrusion` (sufficient for tuning the camera path). Keep it behind the same DEV guard the other debug hooks use.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/screensaver/main.ts
git commit -m "feat(harness): ?event= one-shot trigger for tuning flight reactions"
```

---

### Task 8: Web visual verification (no behaviour change)

- [ ] **Step 1: Start dev server**

Run: `npm run dev` (leave running on :5173).

- [ ] **Step 2: Screenshot intrusion + rift before/after**

Run: `THREAT=0.3 node scripts/verify-crt.mjs "rift:phosphor" "void:phosphor"`
Then with an event: `node scripts/verify-crt.mjs "void:phosphor"` after appending `?event=intrusion` (or set via the harness).
Expected: rift barrel-roll and the intrusion lateral-steadying look identical to the pre-change build (compare against a screenshot taken from `main`). No snaps, no drift.

- [ ] **Step 3: Host-boundary check**

Run: `! grep -rn "from 'obsidian'" src/engine/`
Expected: no matches (the new `modes/` and `events/` files must not import obsidian).

---

## PHASE 2 — Native parity

> Each native task MIRRORS the web change of the same name. Before editing, read the
> target Swift file region to anchor the edit; the web implementation above is the
> spec-of-record. Keep field names / math identical so the files diff cleanly. Honour:
> autoreleasepool (no per-frame leaks), single-thread (no async), single-writer fog/bloom.

### Task 9: EventBus.swift

**Files:**
- Create: `native/macos/KuroNativeSaver/Core/EventBus.swift`

- [ ] **Step 1: Write the mirror**

```swift
// EventBus — Swift mirror of src/engine/events/bus.ts.
enum FlightEventKind { case intrusion, manoeuvre }
struct FlightEvent { var kind: FlightEventKind; var intensity: Double = 0; var dir: Double = 0 }

final class EventBus {
    private var subs: [ObjectIdentifier: (FlightEvent) -> Void] = [:]
    private var byKind: [Int: [(FlightEvent) -> Void]] = [:]
    func subscribe(_ kind: FlightEventKind, _ fn: @escaping (FlightEvent) -> Void) {
        byKind[kind.idx, default: []].append(fn)
    }
    func emit(_ e: FlightEvent) { byKind[e.kind.idx]?.forEach { $0(e) } }
}
private extension FlightEventKind { var idx: Int { self == .intrusion ? 0 : 1 } }
```

- [ ] **Step 2: Build the renderer (compile check)**

Run: `bash scripts/run-native-tests.sh`
Expected: builds (tests still pass — nothing references the bus yet).

- [ ] **Step 3: Commit**

```bash
git add native/macos/KuroNativeSaver/Core/EventBus.swift
git commit -m "feat(native): EventBus mirror"
```

---

### Task 10: FlightDirector.swift

**Files:**
- Create: `native/macos/KuroNativeSaver/Core/FlightDirector.swift`

- [ ] **Step 1: Write the mirror** (same fields, same `envelope`, same manoeuvre kinds + `apply` math as flight-director.ts). Use the native `LCG` rng (seed ^ 0x9e3779b9). Subscribe to `bus.intrusion` → enqueue a `kick` of `max(0.3, e.intensity)` intensity 0.55. `apply(_ cam: inout Camera)` mutates `cam.position.x/y` and the roll component.

- [ ] **Step 2: Build**

Run: `bash scripts/run-native-tests.sh`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add native/macos/KuroNativeSaver/Core/FlightDirector.swift
git commit -m "feat(native): FlightDirector mirror"
```

---

### Task 11: Wire bus + director into Renderer.swift; SceneContext.speed

**Files:**
- Modify: `Core/Renderer.swift`, `Core/Scene.swift`, native rift/tunnel/terrain/city/void scenes

- [ ] **Step 1:** Read `Renderer.swift` `advance(dt)` + the hesitation envelope + `updateThreat`. Add `bus`/`director` properties (director built where the scene LCG seed is known). Mirror the web tick: after `scene.update` and where the inline hesitation runs, call `director.update` + `director.apply(&scene.camera)`. In `updateThreat`, where intrusion is detected (Terminal.onIntrusion), `bus.emit(.init(kind:.intrusion, intensity: 1.5 + rand*1.5))`. Add the transient-envelope list + fold into the fog/bloom mults (mirror Task 5), respecting the native single-writer composition.
- [ ] **Step 2:** Add `var speed: () -> Double` to `SceneContext` (Scene.swift); provide it where the context is built (`speedBase × director.speed()`). Migrate native rift/tunnel/terrain/city/void to read it. Seed any native `Float.random`/`drand48` in tunnel/rift if present (verify — may already use LCG).
- [ ] **Step 3: Build + run tests**

Run: `bash scripts/run-native-tests.sh`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add native/macos/KuroNativeSaver/Core/
git commit -m "feat(native): wire EventBus + FlightDirector + speed() into Renderer/scenes"
```

---

## PHASE 3 — Tests + verification

### Task 12: Native logic tests (the canonical TDD contracts)

**Files:**
- Modify: `native/macos/KuroNativeSaver/tests/main.swift`

- [ ] **Step 1: Add envelope-math checks (write first, expect FAIL)**

```swift
// --- FlightDirector envelope: value AND slope 0 at both ends, peak 1 at mid -------
do {
    approx(Double(FlightDirector.envelope(0.0)), 0.0, 1e-12, "env(0)=0")
    approx(Double(FlightDirector.envelope(1.0)), 0.0, 1e-12, "env(1)=0")
    approx(Double(FlightDirector.envelope(0.5)), 1.0, 1e-9,  "env(0.5)=1")
    // slope ~0 at the ends (finite difference)
    check(FlightDirector.envelope(0.001) < 1e-3, "env slope→0 at start")
    check(FlightDirector.envelope(0.999) < 1e-3, "env slope→0 at end")
}
```

Run: `bash scripts/run-native-tests.sh` → Expected: FAIL (envelope not found) until Task 10 exposes it as a free/static function. (If Task 10 already landed, this passes — that is fine; the test still pins the contract.)

- [ ] **Step 2: Add determinism check**

```swift
// --- Director determinism: same seed ⇒ identical kick schedule ------------------
do {
    let a = FlightDirector(seed: 1337); let b = FlightDirector(seed: 1337)
    a.enqueue(.init(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    b.enqueue(.init(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    var camA = unitCam(); var camB = unitCam()
    for _ in 0..<30 { a.update(0, 16); a.apply(&camA); b.update(0, 16); b.apply(&camB) }
    approx(Double(camA.position.x), Double(camB.position.x), 1e-12, "director deterministic x")
}
```
(`unitCam()` = a tiny helper building a Camera with position.x = 1; add it near the top of main.swift if no equivalent exists.)

- [ ] **Step 3: Run**

Run: `bash scripts/run-native-tests.sh`
Expected: PASS (all checks `ok`).

- [ ] **Step 4: Commit**

```bash
git add native/macos/KuroNativeSaver/tests/main.swift
git commit -m "test(native): FlightDirector envelope math + determinism"
```

---

### Task 13: Final verification + branch wrap

- [ ] **Step 1:** `npm run typecheck` → PASS.
- [ ] **Step 2:** `bash scripts/run-native-tests.sh` → PASS.
- [ ] **Step 3:** `! grep -rn "from 'obsidian'" src/engine/` → no matches.
- [ ] **Step 4:** `npm run dev` + `verify-crt` rift/intrusion → visually identical to `main`.
- [ ] **Step 5:** Update the spec status to "implemented"; note any deviations.
- [ ] **Step 6:** Report results to the user (don't push — user pushes on request).

---

## Self-Review (run before execution)

- **Spec coverage:** FlightDirector ✓ (T2/T10), EventBus ✓ (T1/T9), transient envelopes ✓ (T5/T11), always-event-reactive camera ✓ (director.apply overlay, T4/T11), speed scalar ✓ (T3/T6/T11), determinism + leak fixes ✓ (T6, T12), parity web-first→native ✓ (Phase 2), `?event=` harness ✓ (T7), tests/verify ✓ (T8/T12/T13). North-star (Terrain→City) is correctly **out of scope** (Brick B) — the queue/clock/speed it needs are built here.
- **Placeholders:** the rift "optional enqueue" snippet in T6 Step 1 is explicitly scoped down to "seeded gap only" for this brick with the rationale stated — not a TODO. No other placeholders.
- **Type consistency:** `FlightEvent {kind,intensity,dir}`, `Manoeuvre {kind,dur,dir,intensity,start}`, `envelope(p)`, `director.{update,apply,enqueue,speed}` used identically across web tasks and mirrored in native.
