# Warp Transitions Implementation Plan (Brick B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-cut scene change with an in-3D warp transition (windup → warp → swap-under-streak → emerge), with the Terrain→City approach-and-dive as the hero, reusing Brick A's FlightDirector.

**Architecture:** Extend `FlightDirector` with a transition state machine that ramps `speedMul`, pushes FOV, fires a swap callback at the warp peak, and overrides the camera pose during the transition (blending back to the scene's own pose on emerge). A small profile table maps scene pairs to choreography. Web `switchScene` and native auto-cycle delegate to it; `loadScene`/`swapScene` are called at the peak, hidden under the streak.

**Tech Stack:** TypeScript + three.js (web); Swift + Metal (native); native assert harness (`scripts/run-native-tests.sh`); web `npm run typecheck` + `node scripts/verify-crt.mjs`.

**Testing reality:** Canonical logic contracts (stage clock, ramp C1-continuity, swap-fires-once) live in the **native** assert harness (the parity reference). Web is verified by `typecheck` + `verify-crt` visual checks via a `?transition=` harness.

---

## File Structure

**New files**
- `src/engine/modes/transition-profiles.ts` — the profile table (DEFAULT generic + terrain→city hero) + `profileFor(from, to)`.
- `native/macos/KuroNativeSaver/Core/TransitionProfiles.swift` — Swift mirror.

**Modified (web)**
- `src/engine/modes/flight-director.ts` — transition state machine: `beginTransition`, `inTransition`, `speedMul` ramp, `applyTransition`.
- `src/engine/engine/core.ts` — `beginTransition()` wrapper (captures base FOV); tick calls `applyTransition` + `updateProjectionMatrix` when in a transition.
- `src/engine/controller.ts` — `switchScene` delegates to the director transition (swap at peak); guard auto-cycle while `inTransition`.

**Modified (native)**
- `Core/FlightDirector.swift` — mirror the transition state machine.
- `Core/Renderer.swift` — `beginTransition` wrapper; tick applies transition pose + FOV; auto-cycle uses the warp instead of `CrashFx`; decouple `swapScene` from `crash.update`.
- `tests/main.swift` — transition logic tests.

---

## PHASE 1 — Web

### Task 1: Transition profiles (web)

**Files:** Create `src/engine/modes/transition-profiles.ts`

- [ ] **Step 1: Write the module**

```ts
// Transition profiles — the choreography for a warp scene change. A small data table
// so web/native stay in lockstep. Brick B: a generic DEFAULT + the terrain→city hero.
import type { SceneId } from '../data/defaults';

export interface TransitionProfile {
  windupDur: number;   // s — wind-up (climb / centre)
  warpDur: number;     // s — accelerate, streak, swap at the peak (mid-warp)
  emergeDur: number;   // s — ease back, descend, hand to the scene
  warpSpeed: number;   // peak speedMul during the warp
  fovPush: number;     // degrees added to base FOV at the warp peak
  climbPitch?: number; // windup nose-up (radians); hero only
  entryAltitude?: number; // emerge starts cam.y here, eases to the scene's natural y; hero only
}

export const DEFAULT_TRANSITION: TransitionProfile = {
  windupDur: 0.6, warpDur: 1.4, emergeDur: 1.0, warpSpeed: 6, fovPush: 28,
};

const HERO: Partial<Record<`${SceneId}>${SceneId}`, TransitionProfile>> = {
  'terrain>city': {
    windupDur: 1.2, warpDur: 1.6, emergeDur: 2.2, warpSpeed: 7, fovPush: 32,
    climbPitch: 0.28, entryAltitude: 60,
  },
};

/** calm mode: a short, motion-light transition that still swaps. */
export const CALM_TRANSITION: TransitionProfile = {
  windupDur: 0.2, warpDur: 0.5, emergeDur: 0.4, warpSpeed: 1.6, fovPush: 0,
};

export function profileFor(from: SceneId, to: SceneId, calm = false): TransitionProfile {
  if (calm) return CALM_TRANSITION;
  return HERO[`${from}>${to}`] ?? DEFAULT_TRANSITION;
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit `git add src/engine/modes/transition-profiles.ts && git commit -m "feat(engine): warp transition profiles (generic + terrain→city hero)"`

---

### Task 2: FlightDirector transition state machine (web)

**Files:** Modify `src/engine/modes/flight-director.ts`

- [ ] **Step 1: Import the profile type** — add at top:

```ts
import type { TransitionProfile } from './transition-profiles';
```

- [ ] **Step 2: Add the transition camera shape + active-transition state.** After the `CameraTarget` interface add:

```ts
/** Fuller camera the director drives during a transition (adds pitch + FOV). */
export interface TransitionCam {
  position: { x: number; y: number };
  rotation: { x: number; z: number };
  fov: number;
}
```

Inside the class, after `private rng`:

```ts
  private speedMul = 1;          // (already present in Brick A — keep one copy)
  private trans: { p: TransitionProfile; t0: number; swapped: boolean; onSwap: () => void; baseFov: number } | null = null;
  get inTransition(): boolean { return this.trans !== null; }
```
(If `speedMul` is already declared, do NOT redeclare — only add `trans` + the getter.)

- [ ] **Step 3: Add `beginTransition`.**

```ts
  beginTransition(p: TransitionProfile, baseFov: number, onSwap: () => void): void {
    this.trans = { p, t0: this.clock, swapped: false, onSwap, baseFov };
    this.ownsCamera = true;
  }
```

- [ ] **Step 4: Drive the transition in `update()`.** At the end of `update`, after the manoeuvre filtering, add:

```ts
    const tr = this.trans;
    if (tr) {
      const el = this.clock - tr.t0;
      const total = tr.p.windupDur + tr.p.warpDur + tr.p.emergeDur;
      if (el >= tr.p.windupDur && el < tr.p.windupDur + tr.p.warpDur) {
        const pw = (el - tr.p.windupDur) / tr.p.warpDur;
        this.speedMul = 1 + (tr.p.warpSpeed - 1) * envelope(pw);   // sin² hump (C1)
        if (!tr.swapped && pw >= 0.5) { tr.swapped = true; tr.onSwap(); }  // swap at the peak
      } else {
        this.speedMul = 1;
      }
      if (el >= total) { this.trans = null; this.ownsCamera = false; this.speedMul = 1; }
    }
```

- [ ] **Step 5: Add `applyTransition`** (override pose; reads the scene's pose as the emerge blend target):

```ts
  /** Override the scene-written pose during a transition. Returns true if FOV changed. */
  applyTransition(cam: TransitionCam): boolean {
    const tr = this.trans; if (!tr) return false;
    const el = this.clock - tr.t0;
    const { windupDur, warpDur, emergeDur, fovPush, climbPitch, entryAltitude } = tr.p;
    if (el < windupDur) {
      const e = envelope(0.5 + 0.5 * (el / windupDur));      // ramp the climb in, hold near peak
      if (climbPitch) cam.rotation.x += climbPitch * e;
      return false;
    }
    if (el < windupDur + warpDur) {
      const h = envelope((el - windupDur) / warpDur);
      cam.fov = tr.baseFov + fovPush * h;
      cam.position.x += (this.rng() - 0.5) * 0.06 * h;        // seeded warp shake
      cam.position.y += (this.rng() - 0.5) * 0.06 * h;
      return true;
    }
    const pe = Math.min(1, (el - windupDur - warpDur) / emergeDur);
    const k = 1 - (1 - pe) * (1 - pe);                        // easeOut
    if (entryAltitude != null) cam.position.y = entryAltitude + (cam.position.y - entryAltitude) * k;
    cam.fov = tr.baseFov;
    return true;
  }
```

- [ ] **Step 6:** `npm run typecheck` → PASS.
- [ ] **Step 7:** Commit `git add src/engine/modes/flight-director.ts && git commit -m "feat(engine): FlightDirector transition state machine (warp ramp + pose override)"`

---

### Task 3: Engine wrapper + tick integration (web)

**Files:** Modify `src/engine/engine/core.ts`

- [ ] **Step 1: Import the profile type + helper.** Add:

```ts
import type { TransitionProfile } from '../modes/transition-profiles';
```

- [ ] **Step 2: Add a `beginTransition` wrapper** (captures the base FOV). Add a method near `loadScene`:

```ts
  /** Start a warp transition; the director swaps the scene at the peak via onSwap. */
  beginTransition(profile: TransitionProfile, onSwap: () => void): void {
    this.director.beginTransition(profile, this.cam.fov, onSwap);
  }
```

- [ ] **Step 3: Tick — apply the transition pose.** Replace the Brick-A director lines

```ts
      this.director.update(this.clockT, dt);
      this.director.apply(this.cam);
```
with:
```ts
      this.director.update(this.clockT, dt);
      if (this.director.inTransition) {
        if (this.director.applyTransition(this.cam)) this.cam.updateProjectionMatrix();
      } else {
        this.director.apply(this.cam);
      }
```
(`this.cam` is a `THREE.PerspectiveCamera`, which structurally satisfies `TransitionCam`: `position.x/y`, `rotation.x/z`, `fov`.)

- [ ] **Step 4:** `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `git add src/engine/engine/core.ts && git commit -m "feat(engine): drive warp transitions from the tick (pose + FOV)"`

---

### Task 4: Controller delegates switchScene to the warp (web)

**Files:** Modify `src/engine/controller.ts`

- [ ] **Step 1: Import profileFor.** Add:

```ts
import { profileFor } from './modes/transition-profiles';
```

- [ ] **Step 2: Replace the CSS fade in `switchScene`** (lines ~784-801, the `canvas.style.opacity`/`setTimeout` block) with a director transition whose `onSwap` does the load + HUD update that the old `setTimeout` did:

```ts
    const cur = (this.engine.currentScene ?? id) as SceneId;
    const calm = !!this.effectiveSettings()._reducedMotion;  // use the existing reduced-motion flag
    this.engine.beginTransition(profileFor(cur, id, calm), () => {
      if (!this.engine || !this.hud) return;
      this.engine.loadScene(id);
      this.baseFogDensity = (this.engine.scene.fog as any)?.density ?? 0.01;
      this.applyFogMode();
      this.hud.setMode(DICT.MODE_LABELS[id][0]);
      this.hud.setTri(this.engine.getSceneObj()?.triCount || '----');
      this.hud.flashSceneLabel(id);
      this.s.stats.scenesLoaded = (this.s.stats.scenesLoaded || 0) + 1;
      this.s.stats.perScene[id] = (this.s.stats.perScene[id] || 0) + 1;
      this.saveSettingsDebounced();
      this.rebuildBar();
    });
```
Keep `this.audio?.sceneSwitch();` at the top. Remove the `canvas.style.transition/opacity` lines entirely (the warp replaces the DOM fade). If `effectiveSettings()` exposes reduced-motion under a different field, use that field; otherwise read `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.

- [ ] **Step 3: Guard auto-cycle while transitioning.** In `cycleScene()`, at the top after `if (!this.engine) return;` add:

```ts
    if (this.engine.director.inTransition) return;   // don't stack transitions
```

- [ ] **Step 4:** `npm run typecheck` → PASS.
- [ ] **Step 5: Visual check.** `npm run dev`, then `node scripts/verify-crt.mjs "terrain:phosphor"`; manually load `screensaver.html?transition=terrain-city` once Task 7 lands, OR temporarily trigger `cycleScene` — confirm the warp plays (FOV push + streak), the swap is hidden, and city emerges with a descent. No black flash, no snap.
- [ ] **Step 6:** Commit `git add src/engine/controller.ts && git commit -m "feat(engine): switchScene plays a warp transition instead of a fade-cut"`

---

### Task 5 (web harness): `?transition=` trigger

**Files:** Modify `src/screensaver/main.ts`

- [ ] **Step 1:** After `controller.open(...)`, parse `?transition=<from>-<to>`: open on `<from>`, then after a short settle call `controller.switchScene(<to>)`:

```ts
  const tr = params.get('transition');
  if (tr) {
    const [, to] = tr.split('-');
    if (to && SCENES.includes(to as SceneId)) {
      void controller.open({ scene: tr.split('-')[0] as SceneId, storyScale, reactiveThreat })
        .then(() => setTimeout(() => controller.switchScene(to as SceneId), 1500));
    }
  }
```
Place this so it REPLACES the default `controller.open` call when `?transition=` is present (else open twice). Gate cleanly: if `tr` present use this path, else the normal open path.

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `node scripts/verify-crt.mjs` against `screensaver.html?transition=terrain-city` (WAIT_MS so the capture lands mid-warp, ~2500ms) → inspect the PNG for the streak/FOV push.
- [ ] **Step 4:** Commit.

---

## PHASE 2 — Native parity

> Mirror each web change. Read the Swift region first; the web code above is the spec-of-record. Honour autoreleasepool / single-thread / single-writer fog-bloom.

### Task 6: TransitionProfiles.swift

**Files:** Create `native/macos/KuroNativeSaver/Core/TransitionProfiles.swift`

- [ ] **Step 1:** Mirror `transition-profiles.ts`: a `TransitionProfile` struct (same fields, Float/Double), `DEFAULT_TRANSITION`, `CALM_TRANSITION`, a hero dict keyed by `"\(from)>\(to)"`, and `profileFor(from:to:calm:)`. Scene ids are the same strings as `SceneRegistry.ids`.
- [ ] **Step 2:** Build: `bash scripts/run-native-tests.sh` → builds.
- [ ] **Step 3:** Commit.

### Task 7: FlightDirector.swift transition state machine

**Files:** Modify `Core/FlightDirector.swift`

- [ ] **Step 1:** Mirror Task 2: add the `trans` optional state (`profile, t0, swapped, onSwap, baseFov`), `inTransition`, `beginTransition(_ p:, baseFov:, onSwap:)`, the `speedMul` ramp in `update` (sin² hump, swap at pw≥0.5), and `applyTransition(_ cam: inout Camera) -> Bool` overriding pitch (`rotation.x`)/FOV (`fovDegrees`)/`position.y` blend with the same math. `Camera` already has `position`, `rotation`, `fovDegrees`.
- [ ] **Step 2:** Build → compiles.
- [ ] **Step 3:** Commit.

### Task 8: Renderer.swift wiring + auto-cycle uses the warp

**Files:** Modify `Core/Renderer.swift`

- [ ] **Step 1:** Add `beginTransition(_ profile:, onSwap:)` wrapper capturing `scene.camera.fovDegrees`.
- [ ] **Step 2:** Tick — replace the Brick-A `director.update + apply` block with the in-transition branch:

```swift
        director.update(t: t, dt: dt)
        var cam = scene.camera
        if director.inTransition { _ = director.applyTransition(&cam) } else { director.apply(&cam) }
        scene.camera = cam
```
(FOV is on `cam`; the renderer re-derives projection from `scene.camera` each draw, so no explicit updateProjectionMatrix call is needed — verify against `draw`.)

- [ ] **Step 3:** Replace the auto-cycle (lines ~249-254). New:

```swift
        // scene auto-cycle via a warp transition (Brick B; replaces the crash-cut)
        sceneAge += dt
        if autoCycleSec > 0 && sceneAge > autoCycleSec && !director.inTransition {
            sceneAge = 0
            let from = SceneRegistry.ids[sceneIndex]
            let to = SceneRegistry.ids[(sceneIndex + 1) % SceneRegistry.ids.count]
            beginTransition(TransitionProfiles.profileFor(from: from, to: to, calm: settings.reducedMotion)) { [weak self] in self?.swapScene() }
        }
        _ = crash.update(dt: dt)   // power-on / narrative crash visual only — no longer swaps
```
If `settings.reducedMotion` does not exist natively, pass `false` (note the gap for a later a11y pass). Verify `swapScene()` advances `sceneIndex` to match `to` (it does `+1 % count`).

- [ ] **Step 4:** Build + run tests → PASS.
- [ ] **Step 5:** Commit.

---

## PHASE 3 — Tests + verification

### Task 9: Native transition logic tests

**Files:** Modify `native/macos/KuroNativeSaver/tests/main.swift`

- [ ] **Step 1:** Add (before the `failures` check):

```swift
// --- FlightDirector warp transition: stage clock, ramp C1, swap-once -------------
do {
    let d = FlightDirector(seed: 7)
    var swaps = 0
    let p = TransitionProfile(windupDur: 0.5, warpDur: 1.0, emergeDur: 0.5,
                              warpSpeed: 6, fovPush: 30)
    d.beginTransition(p, baseFov: 72) { swaps += 1 }
    check(d.inTransition, "inTransition true after begin")
    var maxSpeed: Float = 0
    // run 2.0s at dt=0.02 (covers windup+warp+emerge = 2.0s)
    for _ in 0..<100 { d.update(t: 0, dt: 0.02); maxSpeed = max(maxSpeed, d.speedMul) }
    check(swaps == 1, "swap fired exactly once")
    check(maxSpeed > 5.5 && maxSpeed <= 6.0, "speedMul ramped to ~warpSpeed")
    check(!d.inTransition, "inTransition false after total duration")
    approx(Double(d.speedMul), 1.0, 1e-6, "speedMul back to 1 after transition")
}
```
(Expose `speedMul` to the test — make it `private(set) var speedMul` if it is fully private.)

- [ ] **Step 2:** `bash scripts/run-native-tests.sh` → all `ok`.
- [ ] **Step 3:** Commit.

### Task 10: Final verification + branch wrap

- [ ] **Step 1:** `npm run typecheck` → PASS.
- [ ] **Step 2:** `bash scripts/run-native-tests.sh` → PASS.
- [ ] **Step 3:** App compile check (Core + KuroMetalApp via swiftc) → exit 0.
- [ ] **Step 4:** `! grep -rn "from 'obsidian'" src/engine/` → clean.
- [ ] **Step 5:** `verify-crt` mid-warp + post-emerge frames via `?transition=terrain-city` → streak visible, city descent lands at normal altitude, no black flash.
- [ ] **Step 6:** Update the spec status to "implemented"; note deviations. Report to the user (no push).

---

## Self-Review

- **Spec coverage:** warp state machine ✓ (T2/T7), profiles incl. hero ✓ (T1/T6), speedMul ramp ✓ (T2), FOV/pose override + emerge blend ✓ (T2/T5 applyTransition), swap-at-peak ✓ (T2 onSwap), web integration ✓ (T3/T4), native integration + auto-cycle ✓ (T8), calm mode ✓ (CALM_TRANSITION + calm arg), narrative crash untouched ✓ (T8 keeps crash.update visual-only, never calls playCrash), `?transition=` harness ✓ (T5), determinism (seeded shake) ✓, tests ✓ (T9), parity ✓ (Phase 2).
- **Placeholders:** the reduced-motion field name is flagged as "verify/fallback" with a concrete fallback (matchMedia web / false native) — not a TODO. Choreography constants are concrete initial values (harness-tuned), not placeholders.
- **Type consistency:** `TransitionProfile {windupDur,warpDur,emergeDur,warpSpeed,fovPush,climbPitch?,entryAltitude?}`, `beginTransition(profile, baseFov, onSwap)` (director) / `beginTransition(profile, onSwap)` (engine/renderer wrapper captures baseFov), `applyTransition(cam)→bool`, `inTransition`, `profileFor(from,to,calm)` — consistent across web tasks and mirrored in native.
