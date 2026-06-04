# Combat Actors Implementation Plan (Brick D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lurking-hunter antagonist that fires at the camera and CORP support units that arrive then flee/crash, driven by `threat`, reacting through the EventBus into camera/world/terminal.

**Architecture:** An engine-owned persistent `actorsGroup` (survives `loadScene`) holds `Actor`s (mesh + `update(t,dt,cam,threat)→alive` + dispose). A seeded `CombatDirector` spawns/retires the antagonist (threat>0.35) and support units (seeded beats), checking actor `alive`. Actors self-manage motion + fire, emitting `incomingFire`/`unitArrive`/`unitCrash` on the bus; the controller reacts (camera kick + bloom flash + CRT poke + a `COMBAT_LINES` terminal line). Cinematic, no damage model.

**Tech Stack:** TypeScript + three.js (web); Swift + Metal (native); native assert harness; `npm run typecheck` + `verify-crt`.

**Testing reality:** CombatDirector determinism/threshold contracts live in the native assert harness (parity reference); web verified via typecheck + `?threat=0.9` `verify-crt`.

---

## File Structure

**New (web):** `src/engine/modes/actors.ts` (Actor interface + AntagonistDrone + SupportUnit), `src/engine/modes/combat-director.ts` (CombatDirector).
**New (native):** `Core/Actors.swift` (Actor protocol + AntagonistDrone + SupportUnit), `Core/CombatDirector.swift`.
**Modified (web):** `events/bus.ts` (combat event kinds), `engine/core.ts` (actorsGroup + actors + combat + tick), `controller.ts` (combat-event reactions + lines), `terminal/script-bank.ts` (COMBAT_LINES).
**Modified (native):** `Core/Renderer.swift` (actors + combat + draw/advance + reactions), `Core/Script.swift` (combat lines), `tests/main.swift`.

---

## PHASE 1 — Web

### Task 1: Combat event kinds (web)

**Files:** Modify `src/engine/events/bus.ts`

- [ ] **Step 1:** Extend `FlightEventKind`:

```ts
export type FlightEventKind =
  | 'intrusion'
  | 'manoeuvre'
  | 'warp'
  | 'incomingFire'   // antagonist fired a tracer at the camera
  | 'unitArrive'     // a CORP support unit arrived
  | 'unitCrash';     // a support unit went down
```

- [ ] **Step 2:** `npm run typecheck` → PASS. Commit.

### Task 2: Actors — interface + AntagonistDrone + SupportUnit (web)

**Files:** Create `src/engine/modes/actors.ts`

- [ ] **Step 1: Write the module**

```ts
// Combat actors — meshes with a path + lifecycle, owned by the engine's persistent
// actorsGroup (survives scene swaps). Cinematic: they react/emit, no damage model.
import * as THREE from 'three';
import { mkRng } from '../engine/rng';
import type { MaterialPool } from '../engine/materials';

export interface Actor {
  readonly obj: THREE.Object3D;
  alive: boolean;
  /** advance; return false when finished (engine culls + disposes). */
  update(t: number, dt: number, cam: THREE.PerspectiveCamera, threat: number): boolean;
  dispose(): void;
}

const disposeTree = (o: THREE.Object3D) => o.traverse((c: any) => {
  c.geometry?.dispose?.(); ([] as any[]).concat(c.material || []).forEach((m) => m.dispose?.());
});

/** Lurking hunter: weaves at the edge of view, fires tracers toward the camera. */
export class AntagonistDrone implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private rng: () => number;
  private t0 = -1;
  private nextFire = 0;
  private tracer: { mesh: THREE.Mesh; born: number } | null = null;
  private side: number;

  constructor(private mats: MaterialPool, seed: number, private onFire: () => void) {
    this.rng = mkRng((seed ^ 0xbad5eed) >>> 0);
    this.side = this.rng() < 0.5 ? -1 : 1;
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), mats.M());     // wireframe drone
    const fin = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mats.M());
    fin.position.set(0, -0.9, 0);
    this.obj.add(body, fin);
    this.nextFire = 2 + this.rng() * 2;
  }

  update(t: number, _dt: number, cam: THREE.PerspectiveCamera, threat: number): boolean {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;
    if (threat < 0.05) { this.alive = false; return false; }          // exhale at the crash
    // anchor at the edge of view, relative to the camera, weaving; closer as threat rises.
    const near = 1 - threat;                                          // 1 far … 0 close
    const dist = 26 + near * 18;
    const lat = this.side * (10 + Math.sin(lt * 0.5) * 3);
    const vert = 5 + Math.sin(lt * 0.37) * 2.5;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.obj.position.copy(cam.position)
      .addScaledVector(fwd, dist).addScaledVector(right, lat).addScaledVector(up, vert);
    this.obj.lookAt(cam.position);
    this.obj.rotateZ(lt * 0.6);
    // fire cadence shortens with threat
    if (lt > this.nextFire) {
      this.nextFire = lt + (4 - threat * 3) + this.rng() * 1.5;
      this.spawnTracer(cam);
      this.onFire();
    }
    if (this.tracer) {                                               // fade the tracer out
      const age = t - this.tracer.born;
      if (age > 0.3) { this.obj.remove(this.tracer.mesh); this.tracer.mesh.geometry.dispose(); this.tracer = null; }
      else (this.tracer.mesh.material as THREE.Material).opacity = 1 - age / 0.3;
    }
    return true;
  }

  private spawnTracer(cam: THREE.PerspectiveCamera) {
    const toCam = cam.position.clone().sub(this.obj.position);
    const len = toCam.length();
    const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 5);
    const mat = this.mats.M().clone(); mat.transparent = true; mat.opacity = 1;
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(toCam.clone().multiplyScalar(0.5));              // local: midway to camera
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toCam.clone().normalize());
    this.obj.add(m);
    this.tracer = { mesh: m, born: performance.now() / 1000 };
  }

  dispose() { disposeTree(this.obj); }
}

/** CORP support unit: arrive → hold → flee or crash. */
export class SupportUnit implements Actor {
  readonly obj = new THREE.Group();
  alive = true;
  private rng: () => number;
  private t0 = -1;
  private from: THREE.Vector3 | null = null;
  private crashed = false;

  constructor(private mats: MaterialPool, seed: number, private crash: boolean, private onCrash: () => void) {
    this.rng = mkRng((seed ^ 0x600d) >>> 0);
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), mats.M());
    this.obj.add(body);
  }

  update(t: number, dt: number, cam: THREE.PerspectiveCamera, _threat: number): boolean {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const anchor = cam.position.clone().addScaledVector(fwd, 30).addScaledVector(up, 6);
    const arrive = Math.min(1, lt / 2.5);
    const enter = (this.rng() < 0.5 ? -1 : 1) * (30 - 30 * arrive);   // slide in from a side
    this.obj.position.copy(anchor).addScaledVector(right, enter);
    if (lt > 6) {                                                     // depart
      if (this.crash) {
        this.crashed = true;
        this.obj.position.addScaledVector(up, -(lt - 6) * (lt - 6) * 1.2);  // dive
        this.obj.rotateZ(dt * 6);
        if (!this.crashed || lt > 9) { /* fall through to death below */ }
        if (lt > 8.5) { if (!this._crashFired) { this._crashFired = true; this.onCrash(); } this.alive = false; return false; }
      } else {
        this.obj.position.addScaledVector(fwd, (lt - 6) * 14);        // flee forward past camera
        if (lt > 9) { this.alive = false; return false; }
      }
    }
    return true;
  }
  private _crashFired = false;
  dispose() { disposeTree(this.obj); }
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS (adjust `mats.M()` if the MaterialPool wireframe factory has a different name — verify against materials.ts). Commit.

### Task 3: CombatDirector (web)

**Files:** Create `src/engine/modes/combat-director.ts`

- [ ] **Step 1: Write the module**

```ts
// CombatDirector — seeded spawn cadence for combat actors. Reads threat each frame,
// spawns/retires the antagonist + support units, and lets the actors emit events.
import { mkRng } from '../engine/rng';
import type { EventBus } from '../events/bus';
import type { MaterialPool } from '../engine/materials';
import { AntagonistDrone, SupportUnit, type Actor } from './actors';

export interface ActorHost {
  add(a: Actor): void;
  mats: MaterialPool;
  enemyMats: MaterialPool;
}

export class CombatDirector {
  private rng: () => number;
  private antagonist: Actor | null = null;
  private support: Actor[] = [];
  private nextSupportT = 10;

  constructor(private seed: number, private bus: EventBus, private host: ActorHost) {
    this.rng = mkRng((seed ^ 0xc0ffee) >>> 0);
  }

  update(t: number, _dt: number, threat: number): void {
    // antagonist: lives while threat is up; the actor self-retires at threat<0.05.
    if (threat > 0.35 && (!this.antagonist || !this.antagonist.alive)) {
      const a = new AntagonistDrone(this.host.enemyMats, this.seed,
        () => this.bus.emit({ kind: 'incomingFire', intensity: threat }));
      this.antagonist = a; this.host.add(a);
    }
    // support: seeded beats during high threat, ≤2 concurrent.
    this.support = this.support.filter((s) => s.alive);
    if (threat > 0.4 && this.support.length < 2 && t > this.nextSupportT) {
      this.nextSupportT = t + 9 + this.rng() * 13;
      if (this.rng() < 0.6) {
        const crash = this.rng() < 0.5;
        const s = new SupportUnit(this.host.mats, this.seed + Math.floor(t),
          crash, () => this.bus.emit({ kind: 'unitCrash' }));
        this.support.push(s); this.host.add(s);
        this.bus.emit({ kind: 'unitArrive' });
      }
    }
  }
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS. Commit.

### Task 4: Engine wiring (web)

**Files:** Modify `src/engine/engine/core.ts`

- [ ] **Step 1: Imports + fields.** Add imports:

```ts
import { CombatDirector } from '../modes/combat-director';
import type { Actor } from '../modes/actors';
```
Fields (near `director`):
```ts
  private actorsGroup = new THREE.Group();
  private actors: Actor[] = [];
  combat!: CombatDirector;
```

- [ ] **Step 2: Add the group to the scene + build the combat director.** After `this.world = new THREE.Group(); this.scene.add(this.world);` (line 225) add `this.scene.add(this.actorsGroup);`. After the director is constructed (the FlightDirector line in the constructor) add:

```ts
    this.combat = new CombatDirector(this.seed, this.bus, {
      add: (a) => { this.actors.push(a); this.actorsGroup.add(a.obj); },
      mats: this.mats, enemyMats: this.enemyMats,
    });
```

- [ ] **Step 3: Run + cull in the tick.** Right after the director block (`this.director.update`/`apply`, line ~503-508) add:

```ts
      // Combat actors: spawn/retire from threat, update + cull. Persist across scenes.
      this.combat.update(this.clockT, dt, this.threat);
      for (let i = this.actors.length - 1; i >= 0; i--) {
        if (!this.actors[i].update(this.clockT, dt, this.cam, this.threat)) {
          const a = this.actors[i]; a.obj.parent?.remove(a.obj); a.dispose();
          this.actors.splice(i, 1);
        }
      }
```

- [ ] **Step 4:** `npm run typecheck` → PASS. Commit.

### Task 5: COMBAT_LINES + controller reactions (web)

**Files:** Modify `src/engine/terminal/script-bank.ts`, `src/engine/controller.ts`

- [ ] **Step 1 (script-bank):** Add:

```ts
// Combat terminal lines keyed by event kind (Brick D). Single-speaker; full unit
// cross-talk is Brick E. Lore register.
export const COMBAT_LINES: Record<string, string[]> = {
  incomingFire: ['// taking fire', '// evasive — rounds inbound', '// hostile lock detected'],
  unitArrive:   ['// CORP-7 inbound', '// support on station'],
  unitCrash:    ['// unit down — no chute', '// we lost CORP-7'],
};
export function combatLine(kind: string, index: number): string | null {
  const lines = COMBAT_LINES[kind];
  return lines && lines.length ? lines[index % lines.length] : null;
}
```

- [ ] **Step 2 (controller):** Import `combatLine`. In `open()`, after `reactiveWorld` is constructed, subscribe to the engine bus for combat events:

```ts
    if (this.engine) {
      let combatLineIdx = 0;
      this.engine.bus.subscribe('*', (e) => {
        if (e.kind === 'incomingFire') {
          this.engine!.director.enqueue({ kind: 'kick', dur: 0.6, dir: 0, intensity: 0.5 });
          this.reactiveWorld?.pulse('flash');
        } else if (e.kind === 'unitCrash') {
          this.reactiveWorld?.pulse('flash');
        }
        if (e.kind === 'incomingFire' || e.kind === 'unitArrive' || e.kind === 'unitCrash') {
          const line = combatLine(e.kind, combatLineIdx++);
          if (line) void this.hud?.addLine(line, e.kind === 'unitCrash' ? 'WARNING' : 'HQ');
        }
      });
    }
```
(Verify `'WARNING'` is a valid LineCategory; else use `'HQ'`. Camera kick + flash are gated by the conductor's calm logic inside `pulse`; the kick itself is small — acceptable in calm, or guard with `if (!reduceMotion)`.)

- [ ] **Step 3:** `npm run typecheck` → PASS.
- [ ] **Step 4: Visual check.** `npm run dev`; `screensaver.html?scene=void&preset=phosphor&threat=0.9` → the antagonist drone + tracers render at the edge; combat lines appear. Screenshot. Drive a fast shift to see a support unit arrive/crash.
- [ ] **Step 5:** Commit.

---

## PHASE 2 — Native parity

### Task 6: Actors.swift + CombatDirector.swift

- [ ] Mirror `actors.ts`: a `protocol Actor { var items: [DrawItem] {get}; var alive: Bool {get}; func update(t:dt:cam:threat:) -> Bool }` + `AntagonistDrone` + `SupportUnit` building DrawItems via `Geo` (icosahedron/octahedron + a tracer line built each fire). Mirror `combat-director.ts` as `CombatDirector` (note: distinct from FlightDirector/FilmDirector) using `LCG`. Camera-relative math via the native `Camera` (position + rotation → basis vectors; reuse `Mathx`). Commit after build.

### Task 7: Renderer wiring (native)

- [ ] `Renderer`: own `actors: [Actor]` + `combat: CombatDirector` (seeded). In `advance`, after the director block: `combat.update(t: t, threat: threat)`; then update + cull actors (`actors.removeAll { !$0.update(t:t, dt:dt, cam: scene.camera, threat: threat) }`). In `draw`'s scene pass, iterate `scene.items` **and** `actors.flatMap { $0.items }` (same SceneUniforms path; antagonist items `infectable=true`). Subscribe combat events: wire the bus (or call directly) → camera kick (`director.enqueue`) + `pulse(.flash)` + a combat line into `hud.terminal` (append HQ/warning line) via a small accessor. Add `Script.combatLine`. Respect autoreleasepool (tracer geometry built per fire must be released/pre-pooled). Commit after build + tests.

### Task 8: Script.swift combat lines — add `combatLines` dict + `combatLine(_:_:)` mirroring web. Commit.

---

## PHASE 3 — Tests + verification

### Task 9: Native CombatDirector logic tests

**Files:** `tests/main.swift`

- [ ] Add: antagonist spawns when threat>0.35 and not before; same seed ⇒ same support-spawn schedule; support count capped at 2. (Drive `combat.update` over a synthetic threat ramp with a stub ActorHost that counts spawns.)
- [ ] `bash scripts/run-native-tests.sh` → PASS. Commit.

### Task 10: Final verification + wrap

- [ ] `npm run typecheck` → PASS · native tests → PASS · app compile → exit 0 · obsidian boundary clean.
- [ ] `verify-crt` `?threat=0.9` shows the antagonist + tracers; a fast shift shows a support unit + combat lines.
- [ ] Update spec status to implemented; note deviations. Report (no push).

---

## Self-Review

- **Spec coverage:** ActorSystem (persistent group + cull) ✓ (T4/T7), CombatDirector ✓ (T3/T6), antagonist lurking+fire ✓ (T2/T6), CORP support arrive/flee/crash ✓ (T2/T6), combat events ✓ (T1), conductor+terminal reactions ✓ (T5/T7), determinism+calm ✓, parity ✓ (Phase 2), tests ✓ (T9).
- **Placeholders:** `mats.M()` / `'WARNING'` category / native tracer pooling are flagged with verify-or-fallback instructions, not TODOs. Antagonist/support motion constants are concrete tuning values.
- **Type consistency:** `Actor {obj,alive,update(t,dt,cam,threat),dispose}`, `CombatDirector.update(t,dt,threat)`, `ActorHost {add,mats,enemyMats}`, event kinds `incomingFire|unitArrive|unitCrash`, `combatLine(kind,index)` — consistent web↔native.
- **Note:** `performance.now()` is used for the tracer fade clock in actors.ts (web-only, fine); native uses the passed `t`. Not a determinism input (cosmetic fade).
```
