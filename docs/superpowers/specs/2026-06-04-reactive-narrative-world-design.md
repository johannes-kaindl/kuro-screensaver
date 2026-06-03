# Reactive Narrative World — Design

**Status:** approved design (2026-06-04), pending spec review → implementation plan.

**Goal:** Couple the 3D world to the operator-under-attack narrative so the
environment reacts to the shift's escalation (`ROUTINE → INTRUSION → ALARM → PANIC
→ SILENCE`). Today the terminal story and the 3D world run independently; this makes
them one system.

**North star (chosen):** *subtle build → dramatic payoff.* Early phases are barely
perceptible (felt, not noticed); the world visibly tightens toward PANIC; the
existing CRT **crash** is the release that resets everything for the next shift.

**Platform:** web first (fast visual tuning), native (`KuroNativeSaver`) as a
follow-up port. Both already have the phase machine (web `NarrativeRunner`, native
`Terminal.phase`).

---

## 1. Architecture — a `ReactiveWorld` conductor

A single coordinator owns (a) the continuous **threat** signal and (b) the per-frame
mapping of threat → every subsystem. Chosen over scattering setters through the
controller, or pushing a runtime value into `settings`, because all the tuning lives
in one place (critical for shaping the subtle curve), it is testable in isolation, and
it ports cleanly to native as a mirror `ReactiveWorld.swift`.

**Web placement:** `src/engine/fx/reactive-world.ts`. The controller constructs it in
`open()` with references to `{ engine, narrative, settings }` (the HUD is not needed —
the terminal already renders the story). It is driven by a single frame hook the
engine exposes (one clock, frame-synced).

**Data flow (per frame):**
```
engine.tick(t, dt):
  reactiveWorld.update(t, dt)      // ① compute threat, push fog/CRT/bloom, set engine.threat/storm
  currentUpdater(t, dt)            // ② scenes read engine.threat()/storm() for the particle storm
  parallax post-step
  camera hesitation envelope        // ③ engine applies the active hesitation brake
  composer.render()
```
`reactiveWorld.update` runs FIRST so the threat it computes is available to the scene
updater the same frame. Camera hesitation is applied by the engine (where the camera
lives), triggered by `reactiveWorld` on intrusion events.

**Engine API additions (web):**
- `engine.onFrame: ((t, dt) => void) | null` — called at the top of the tick. ReactiveWorld registers here.
- `engine.threat: number` and `engine.storm: number` — public live floats the conductor writes; scenes read them.
- `engine.pulseHesitation(durationSec: number)` — start a lateral-brake envelope the tick applies until it elapses. No-op if one is already active.
- `engine.setFogThreat(mult: number)` — final multiplier applied to `scene.fog.density` AFTER fogMode/day-night (avoids the fog-ordering bug from the audit).
- `engine.setCrtThreat(halationAdd, ntscAdd)` — additive boosts on the user's CRT uniforms.
- `engine.setBloomThreat(mult: number)` — multiplier on the base bloom strength.
- `engine.setEnemyFraction(f: number)` — Stage 2; drives the enemy-colour crossfade.

**SceneCtx additions:** `threat?: () => number` and `storm?: () => number` thunks (read
`engine.threat`/`engine.storm` live, without coupling scenes to the whole engine).

**Narrative API additions (web, `NarrativeRunner`):**
- `get phase(): Phase` — current phase (already internal).
- `get phaseProgress(): number` — 0..1 elapsed within the current phase (from the existing phase timers).
- `onIntrusion?: () => void` — fired when an INTRUSION/attack beat commits (drives the camera hesitation).
- `crashing` / a reset signal already exists via the crash → silentReset path; ReactiveWorld watches for the phase returning to ROUTINE to fast-relax.

---

## 2. The threat signal (`threat`, 0..1)

Continuous, not stepped — the key to "subtle → dramatic".

**Per-phase target band** (lerped across the phase by `smoothstep(phaseProgress)`):

| Phase | band |
|---|---|
| ROUTINE | 0.00 → 0.12 |
| INTRUSION | 0.12 → 0.38 |
| ALARM | 0.38 → 0.70 |
| PANIC | 0.70 → 1.00 |
| SILENCE | hold 1.00 |

- `threatTarget = lerp(lo, hi, smoothstep(0,1, phaseProgress))`.
- **Low-pass smoothing:** `threat += (threatTarget − threat) · (1 − exp(−dt/τ))`, `τ = 2.5 s`. Even a phase boundary is crossed gradually.
- **Derived payoff scalar:** `storm = smoothstep(0.70, 1.00, threat)` — 0 below ALARM, 1 at PANIC. Gates the dramatic, motion-heavy reactions.
- **Crash = reset:** on the crash / phase→ROUTINE transition, switch to a fast relax (`τ = 0.4 s`) so the world visibly exhales back to calm as the new shift boots.
- **Intrusion events:** each INTRUSION beat → `engine.pulseHesitation(rand 1.5..3.0 s)` (deterministic from the session seed, not `Math.random`).

---

## 3. The four reactions (threat → params)

All compose ADDITIVELY/MULTIPLICATIVELY on top of the user's settings — never overwrite
a base value. Numbers below are starting points, tuned via forced-phase screenshots (§6).

| Reaction | Mapping | Compose rule |
|---|---|---|
| **Fog tightens** | `fog.density = base × (1 + threat·1.6)` (≈2.6× at PANIC) | applied LAST in the fog chain via `setFogThreat` |
| **CRT degrades** | `crtSim.intensity = clamp(userIntensity + threat·0.7, 0,1)`; `halation += threat·0.35`; `ntsc += threat·0.45` | additive on user CRT settings |
| **Camera hesitation** | on intrusion: lateral velocity × `(1 − 0.6·env)`, `env = sin²(π·p)` over the pulse | engine post-step; CameraFly untouched |
| **Enemy colour + storm** | `enemyFraction = smoothstep(0.25, 0.90, threat)` (creeps in at INTRUSION); at high threat: `bloom × (1 + storm·0.4)` + scene particle storm | enemy is Stage 2; storm/bloom are MVP |

**Particle storm (scene-side, reads `ctx.storm()`):**
- TERRAIN: `dust` lateral amplitude `+ storm·12·sin(t·3.1)`; point size `0.06 → 0.18·storm`.
- VOID: `speedPts` spawn spread `× (1 + storm·0.5)`; recycle rate feel scaled by storm.
- Other scenes: bloom surge only (no bespoke particles) for the MVP.

---

## 4. Enemy colour (Stage 2 — the heaviest piece)

- **Enemy hue:** the accent's HSL hue rotated ~160° (near-complementary), same lightness/sat — computed once in `color.ts` (`enemyOf(resolvedColor)`), so e.g. phosphor-green → crimson, spectre-purple → acid-green.
- **Second pool:** `engine.enemyMats` (a parallel `MaterialPool` with the enemy hex).
- **Infectable subset (opt-in per scene, MVP set = CITY + VOID):**
  - CITY: a fraction of the window `blinks` meshes (they already hold per-mesh refs).
  - VOID: a fraction of the asteroid pool.
  - Each infectable element gets an enemy-coloured twin (same geometry/position) at opacity 0; `setEnemyFraction(f)` raises that twin's opacity while lowering the accent twin's — a crossfade — for `f`'s share of the tagged elements (deterministic which ones, seeded).
- Recedes automatically as `threat` falls after the crash.
- Scoping risk: per-mesh material instances (not the shared pool material) for the crossfaded subset — a modest count cap (e.g. ≤ 40 elements) keeps it cheap.

---

## 5. Settings + accessibility

- New setting `narrativeReactiveWorld: boolean` (in `defaults.ts`, **default `true`**). When off, ReactiveWorld is not constructed (zero overhead, world behaves as today). Exposed as a control-bar toggle (FX+ section).
- **`prefers-reduced-motion`** (already wired in `open()`): when set, the conductor runs in a **calm mode** — KEEP the gentle, non-motion reactions (fog tighten capped at `1 + threat·0.6`; enemy-colour crossfade — it is slow colour, not motion); DROP the motion/flicker reactions (camera hesitation, particle storm, bloom surge, the CRT glitch surge — `crtSim.intensity` stays at the user value). The story still subtly colours the world without vestibular triggers.

---

## 6. Verification

- **Forced-phase URL params** (screensaver host, DEV + standalone): `?phase=routine|intrusion|alarm|panic|silence` pins `NarrativeRunner` to a phase; `?threat=<0..1>` pins the threat scalar directly. Both bypass the 6–9 min real cycle so each escalation state is screenshot-able on demand.
- **Playwright** (`scripts/verify-crt.mjs`, extended): capture each phase for a scene/preset and eyeball the subtle-build curve (ROUTINE ≈ baseline, PANIC visibly closed-in + degraded + infected). This is the tuning loop.

---

## 7. Sequencing (web-first)

1. **MVP** — `ReactiveWorld` + threat signal + narrative phase exposure + forced-phase params + reactions: fog, CRT, camera hesitation, particle storm + bloom surge. Setting + a11y. (All "just numbers" → fast to tune.)
2. **Stage 2** — enemy colour (`enemyMats`, `enemyOf`, infectable CITY + VOID subsets, crossfade).
3. **Stage 3** — native port: `ReactiveWorld.swift` driven by `Renderer` (expose `Terminal.phase` + progress; mirror the threat math + the fog/CRT/bloom/camera mappings; enemy colour via a second accent in `SceneUniforms`).

Each stage is independently shippable and leaves the world fully working.

---

## 8. Risks / open decisions

- **Fog ordering:** the conductor MUST run after fogMode/day-night each frame, or the multiplier gets stomped (the audit found exactly this class of bug). `setFogThreat` is the single final write.
- **Enemy-colour cost:** per-mesh materials for the crossfade — capped element count; verify no GC churn.
- **Native phase exposure:** `Terminal.phase` is `private` — needs a getter + a progress accessor. Native enemy colour needs a second-colour path in `SceneUniforms` (currently one accent) — the heaviest part of the native port; may land after the other three reactions.
- **Tuning is empirical:** the band numbers + multipliers in §2–3 are starting points; the screenshot loop (§6) finalizes them.

## 9. Out of scope (for now)

- Synth/audio modulation of threat (audio is off by default → low reach; revisit later).
- Ghostlink text bleeding into 3D space (a separate, larger idea).
- New scenes/landscapes (tracked separately).
