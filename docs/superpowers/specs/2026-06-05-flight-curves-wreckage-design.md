# Flight Curves & Void Wreckage — Design

- **Date:** 2026-06-05
- **Status:** Approved (design), implementation pending
- **Author:** Johannes + Claude (pair)
- **Scope:** Scene-flight enrichment (the roadmap's "D-next" strand). One cohesive feature,
  built + verified incrementally, merged once. Builds on the FlightDirector/film engine.

## 1. Why this exists

The flight is always straight-ahead. Johannes wants the world to **turn**: gentle curves in
the Rift, a sweeping direction-change over Terrain, a real heading change in the Void, a
believable **90° corner** in the City, and a **wreckage field** as a Void variant the film
sometimes flies through. This adds variety + a sense of *navigating* a place.

**Grounding (from the scene-flight analysis):** Terrain/City/Rift use the *scroll-world*
model (geometry streams toward a near-stationary camera) — a **banked sweeping curve** reads
convincingly there, but a *true* heading change needs new geometry. **Void** is the only
scene that *truly translates* the camera through world-static rocks — a **real heading
change** works best there.

## 2. Scope (all of it, one brick)

1. **Rift — gentle curves** (easy): seam-safe periodic wall offset + synced bank → serpentine.
2. **Terrain — sweeping direction-change** (easy): long banked lateral course + held yaw.
3. **Void — true heading change** (medium): vectorise the forward step + reframe spawn/
   recycle/no-spawn-tube into the heading frame.
4. **Void — wreckage field** (medium): a NEW scene id (`wreckage`) reusing Void's flythrough
   engine with debris templates (panels/struts/station fragments); the FilmDirector picks it.
5. **City — true 90° corner** (hard): an intersection chunk (perpendicular street + flanking
   buildings) + heading state + scroll-axis swap (z↔x).

**Non-goals:** combat actors (still gated off), radio (Brick E), per-scene settings UI (F).
No new HUD. calm mode: curves still happen but gentler (no hard banks); the 90° corner still
turns (it's geometry-driven, not motion-heavy) but with reduced over-roll.

## 3. Shared concepts

- **Heading is scene-owned state** (a closure var in `build()`), eased toward a target with a
  sin²/`1-exp(-dt/τ)` curve, fired on a seeded scheduler (mirror CameraFly's event model).
  CameraFly's `f.yaw` is cosmetic (weave-coupled) — the course/heading is added ON TOP:
  `cam.rotation.set(f.pitch, f.yaw + headingYaw, f.roll + bank)`. Never accumulate onto
  `cam.rotation` across frames (the engine restores a baseline each frame) — compute from
  absolute progress and SET.
- **Bank sells the turn.** Every curve adds a roll proportional to the heading *rate*
  (bank into the turn), damped (~τ for inertia). calm mode → smaller bank.
- **Determinism:** turn timing/direction from the scene's seeded `ctx.rng()` — no `Math.random`.
- **Parity:** web-first, native fast-follow; same constants/curves mirrored.

## 4. Per-scene design

### 4.1 Rift — gentle curves (`rift.ts`)
Define a **periodic** horizontal curve sharing the chunk wavenumber so recycled chunks stay
seam-free: `curveX(z) = CURVE_AMP * sin(z * K_BASE)` (`K_BASE = 2π/CHUNK_LEN` already exists).
Each frame, after the scroll/recycle block: `cA.position.x = cB.position.x = curveX(camZ-ish)`
applied to the chunk **groups** (not the per-vertex walls). Offset the camera by the same
`curveX` at the camera's z so it stays centred between the bending walls (clearance is only
±13). Add `bank = -curveSlope * gain` (damped) to `rotation.z` (ADD to the sway+barrel-roll,
don't overwrite) + a small `rotation.y` into the turn. `CURVE_AMP ≈ 4`, gentle serpentine.

### 4.2 Terrain — sweeping direction-change (`terrain.ts`)
Scene-local **course** layered on the weave. A seeded scheduler fires a long one-direction
arc: `courseProgress` ramps 0→1→0 over ~12 s (sin²). After `fly.sample`:
`cam.position.x = f.x + dir*COURSE_AMP*cs` (`COURSE_AMP ≈ 38`), `cam.rotation.set(f.pitch,
f.yaw + dir*0.22*cs, f.roll + dir*0.18*cs)`. Terrain-following clamp still samples
`cam.position.x` so NOE clearance holds through the arc. Keep `COURSE_AMP+weave < ~130`
(WIDTH 280). Optional: extra dust lateral whip during the arc for g-load.

### 4.3 Void — true heading change (`void.ts`)
Replace the scalar forward step with a **vector** along a yawed heading:
```ts
let heading = 0, headTarget = 0, nextTurnT = 18 + rng()*22;
// scheduler: at t>nextTurnT, headTarget += (rng()<0.5?-1:1) * (rng()<0.4 ? π/2 : 0.4..0.9); reschedule
heading += (headTarget - heading) * (1 - Math.exp(-dts/τ));   // τ≈4s → sweeping arc
const fwd = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
camPath.addScaledVector(fwd, spd*14*dts);                      // smoothed path point
```
Apply the weave in the **heading frame** (lateral along `right=(cos h,0,sin h)`); body yaw =
`heading + f.yaw`; bank from heading rate. **Reframe the spawner** (the load-bearing fix):
`ahead = (rock.pos - camPath)·fwd`; recycle when `ahead < BEHIND`; respawn at
`camPath + fwd*(FAR..) + right*(±FIELD_W) + up*beltY`; the no-spawn tube tests against the
**camPath line**, not the world origin. (heading=0 reduces to today's behaviour — safe superset.)

### 4.4 Void — wreckage field (new scene `wreckage`)
Extract Void's flythrough core (spawn/recycle/heading/weave) into a shared builder
parameterised by a **template set** + scene id. `void` uses the rock templates; **`wreckage`**
uses debris:
- **panels**: thin `BoxGeometry(w,h,0.06)`, random aspect, a corner sheared.
- **struts/girders**: long thin `BoxGeometry(0.12,0.12,L)` (or crossed boxes).
- **station fragments**: 2–4 boxes merged at hard angles (`mergeGeometries`) → L/cruciform.
`flatShading` for hard facets; erratic non-uniform tumble; non-uniform `mesh.scale`. Keep the
`infectable` ~30% subset (CORP fragments tint to enemy colour). Register `wreckage` as a
SceneId (union, `SCENES`, `SCENE_LABELS`, `DICT.MODE_LABELS`/`BOOT_HEADERS`, native
`SceneRegistry`/`SceneMeta`) and add it to the FilmDirector PHASE_CANDIDATES (PANIC/SILENCE
tier — debris aftermath). Foreshadow/arrival lines for `wreckage`.

### 4.5 City — true 90° corner (`city.ts`)
The honest version (no fake). Add `heading` state. Author an **intersection chunk** variant
in `buildChunk()`: at one slot, open the turn-side wall + lay a perpendicular street with
flanking buildings (reuse the building loop with x/z swapped). **Heading-aware scroll**:
advance chunks along the current heading vector (not always +z). Gate a **turn event** on the
intersection chunk reaching the camera (`cA.position.z ≈ 0`), then ease `heading` 0→±π/2 over
~3.5 s (sin²) with a banked over-roll, and **swap the scroll axis** z→x so the perpendicular
street becomes the new corridor; the dust-stream + chunk-recycle follow the active axis. Fold
heading into `cam.rotation.set(f.pitch, f.yaw + heading, f.roll)`. Re-map `fly.x` to the new
lateral axis after the swap. Budget the cross-street buildings to appear within fog range.

## 5. Build order (within the one brick)
Rift → Terrain → Void heading → Void wreckage scene → City corner. Verify each visually
(web screenshots) + commit per part; native mirror per part; one merge at the end.

## 6. Testing & verification
- **Native logic tests**: heading easing is C1/monotone toward target; curve offset is
  periodic (seam-safe, `curveX(z)==curveX(z+CHUNK_LEN)`); FilmDirector includes `wreckage`
  in its candidate set; void respawn stays within `±FIELD_W` of the heading path.
- **Web** `typecheck` + `verify-crt`: capture each scene mid-curve (rift serpentine, terrain
  arc, void heading sweep, wreckage field, city corner) — confirm no wall-clipping, no seam
  pop, the camera stays in-corridor (rift/city), the void path stays in the field.
- Host-boundary clean; app compile; `?scene=wreckage` + `?scene=city` reachable for tuning.

## 7. Risks & invariants
- **Seam tiling (rift/city/terrain):** curve offsets must be periodic or chunk-recycle pops.
- **Camera-in-corridor (rift/city):** offset the camera with the curve so it never clips a
  wall (rift ±13, city corridor); these scenes are `cameraLocked` (scene owns the camera).
- **Void spawner reframe is mandatory** for a sustained/90° void turn or rocks stop recycling
  (recycle is z-only today) and spawn off-path (tube is origin-hardcoded).
- **City scroll-axis swap** must carry the recycle + dust + lateral-weave remap, or geometry
  pops / dust flies sideways / weave reads as forward-surge.
- **New scene id `wreckage`** touches the web SceneId union + DICT maps + native SceneRegistry
  + SceneMeta (runtime crash if a map entry is missing — add all).
- **Determinism + parity + calm** as in every feature. No `Math.random` in turn logic.

## 8. Out of scope → later
City beyond a single corner (multi-turn navigation), combat actors redo (D), radio (E),
per-scene settings UI (F).
