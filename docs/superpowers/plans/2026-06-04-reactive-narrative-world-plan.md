# Reactive Narrative World — Implementation Plan

> Executes the design in `docs/superpowers/specs/2026-06-04-reactive-narrative-world-design.md`.
> Web-first. Each stage is independently shippable and leaves the world fully working.
> Verified via forced-phase/threat screenshots (Playwright). Frequent commits.

**Goal:** the 3D world reacts to the narrative phase (subtle build → dramatic payoff, crash = release).

**Tech:** TypeScript + three.js (web); a `ReactiveWorld` conductor reading the narrative phase, pushing per-frame params to the engine.

---

## Stage 1 — Web MVP (signal + conductor + fog/CRT/camera/storm)

### Task 1 — Narrative phase exposure
- Modify `src/engine/terminal/narrative.ts`:
  - store `phaseStartedAt` in `enterPhase()`.
  - `get phase(): Phase`, `get phaseProgress(): number` (clamp `(now-start)/(end-start)`).
  - `forcePhase(p: Phase)` — pin phase + cancel the scheduled transition (for `?phase=` tuning).
  - add `onIntrusion?: () => void` to `NarrativeRunnerDeps`; call it where an intrusion event lands (beatIntrusion 60% branch, beatAlarm intrusion branch, beatPanic rapid-intrusion branch).

### Task 2 — Engine hooks
- Modify `src/engine/engine/core.ts`:
  - public `threat = 0`, `storm = 0`; `onFrame: ((t,dt)=>void) | null = null`.
  - in `tick`, call `this.onFrame?.(this.clockT, dt)` at the TOP (before `currentUpdater`) so threat is ready for scenes.
  - `setFogThreat(mult)`: store a `fogThreatMult`; apply `scene.fog.density = this._fogBase * mult` — but the base is owned by controller/day-night. Simpler: `setFogThreat(densityFinal)` sets density directly as the LAST writer. ReactiveWorld computes `base * (1+threat*K)` from a base it reads via a getter passed in.
  - `setBloomThreat(mult)`: `bloomPass.strength = this._bloomBase * mult` (store base on applyFxSettings).
  - `pulseHesitation(durSec)`: start an envelope (`_hesT0`,`_hesDur`); in `tick` after the scene/parallax step, if active, scale the camera's lateral offset toward centre by `(1 - 0.6*sin²(π*p))` — implement as a yaw/x nudge that decays. (CameraFly untouched.)
  - `SceneCtx` (scene-base.ts): add `threat?: () => number`, `storm?: () => number`; wire in `loadScene` to return `this.threat`/`this.storm`.

### Task 3 — ReactiveWorld conductor
- Create `src/engine/fx/reactive-world.ts`:
  - `new ReactiveWorld({ engine, narrative, crt, baseFog: () => number, settings, forcedThreat?: number })`.
  - `update(t, dt)` (registered as `engine.onFrame`): compute `threatTarget` from phase band + `smoothstep(phaseProgress)`; low-pass to `threat` (τ=2.5 s; τ=0.4 s while relaxing after crash/ROUTINE reset); `storm = smoothstep(0.7,1,threat)`.
  - push: `engine.threat/storm = …`; `engine.setFogThreat(baseFog()*(1+threat*1.6))`; CRT via `crt.setIntensity(clamp(userIntensity+threat*0.7))` + `engine.crtPass.uniforms.halation/ntsc += threat*…` (store user base, add); `engine.setBloomThreat(1+storm*0.4)`.
  - on `narrative.onIntrusion` → `engine.pulseHesitation(1.5 + seededRand()*1.5)`.
  - respects `settings.narrativeReactiveWorld`; reduced-motion "calm mode" caps (fog mult → 1+threat*0.6; no storm/bloom/hesitation/crt-glitch surge).
  - `forcedThreat` (0..1) overrides the computed value when set.

### Task 4 — Particle storm in scenes
- `terrain.ts`: read `ctx.storm?.()`; add lateral `+ storm*12*sin(t*3.1)` to dust + scale point size.
- `void.ts`: read `ctx.storm?.()`; widen `speedPts` spawn spread `*(1+storm*0.5)`.

### Task 5 — Settings + control + forced params
- `data/defaults.ts`: `narrativeReactiveWorld: boolean` (default `true`) in the settings + DEFAULT.
- `controller.ts`: construct `ReactiveWorld` after the narrative block (pass crt + a baseFog getter); FX+ control-bar toggle.
- `src/screensaver/main.ts`: parse `?phase=` (→ `narrative.forcePhase`) and `?threat=` (→ ReactiveWorld.forcedThreat); thread into the controller open path.

### Task 6 — Verify + tune + commit
- Extend `scripts/verify-crt.mjs` to accept `&phase=`/`&threat=` (shot token `scene:preset:p<phase>` or env).
- Screenshot ROUTINE vs PANIC for terrain/void/city; confirm subtle→dramatic; tune the K/τ numbers.
- typecheck + build; commit Stage 1.

---

## Stage 2 — Enemy colour (web)
- `color.ts`: `enemyOf(c)` — HSL hue +160°.
- `core.ts`: `enemyMats` pool + `setEnemyFraction(f)`.
- CITY + VOID: tag an infectable subset; crossfade accent→enemy twin by `enemyFraction = smoothstep(0.25,0.9,threat)`.
- Verify + commit.

## Stage 3 — Native port
- `Terminal.swift`: expose `phase` + progress.
- `ReactiveWorld.swift` mirroring the threat math + fog/CRT/bloom/camera mappings.
- enemy colour via a second accent in `SceneUniforms` (heaviest; may land last).
- PNG-verify via harness (add a `--threat`/`--phase` flag); commit.
