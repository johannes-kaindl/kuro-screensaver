# Flight Curves & Void Wreckage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, sequenced — the 5 parts share scenes + a heading idiom). Steps use checkbox (`- [ ]`).

**Goal:** Add curves/direction-changes to the flight (Rift, Terrain, Void, City) + a Void wreckage-field scene variant.

**Architecture:** Heading is scene-owned state eased toward a seeded target, added ON TOP of CameraFly's cosmetic yaw, with a bank from the heading rate. Scroll-world scenes (rift/terrain/city) curve via seam-safe geometry offset + bank; Void truly rotates its forward vector + reframes its spawner to the heading. Wreckage is a new SceneId reusing Void's flythrough engine with debris templates.

**Tech Stack:** TS + three.js (web), Swift + Metal (native), native assert harness, `npm run typecheck` + `verify-crt`.

**Build order:** Rift → Terrain → Void heading → Void wreckage → City corner. Verify each (web screenshot) + commit; native mirror per part; one merge at the end.

---

## PART 1 — Rift gentle curves

**Files:** `src/engine/engine/scenes/rift.ts` (+ native `RiftScene.swift`).

- [ ] **1.1 Web:** after the scroll/recycle block (rift.ts:108-110), bend the corridor seam-safe + bank. `K_BASE = 2π/CHUNK_LEN` already exists (rift.ts:36).

```ts
      // Gentle seam-safe serpentine: offset wall groups by a curve sharing the chunk
      // period (so recycled chunks land on the same phase → no seam pop). Camera rides
      // the bend (clearance is only ±13) + banks into it.
      const CURVE_AMP = 4;
      const curveX = (z: number) => CURVE_AMP * Math.sin(z * K_BASE);
      cA.position.x = curveX(cA.position.z);
      cB.position.x = curveX(cB.position.z);
      const camCurve = curveX(0);                 // curve at the camera's z (~0)
      const slope = CURVE_AMP * K_BASE * Math.cos(0 * K_BASE); // dCurveX/dz at camera
```
Then where the camera pose is set (rift.ts:112-116 drift + :137 rotation.z), offset `cam.position.x` by `camCurve` and ADD a damped bank. Concretely change the cam.x line to `cam.position.x = camCurve + Math.sin(t * 0.08) * 2.4;` and add the bank to the existing rotation.z and a small yaw to rotation.y (ADD, don't overwrite the barrel-roll): introduce `let curveBank = 0;` in build scope, then `curveBank += (-slope * 1.2 - curveBank) * 0.04;` and include `+ curveBank` in the rotation.z assignment and `+ (-slope * 0.5)` into rotation.y. (calm: halve CURVE_AMP/bank if `ctx.settings`-reduced — optional.)

- [ ] **1.2 Web verify:** `npm run typecheck`; `node verify-crt` `?scene=rift` → walls visibly bend left/right, camera stays centred, no seam pop. Commit.
- [ ] **1.3 Native:** mirror in `RiftScene.swift` (same `curveX`, group x-offset, camera offset + bank). Build + tests. Commit.

---

## PART 2 — Terrain sweeping direction-change

**Files:** `src/engine/engine/scenes/terrain.ts` (+ native `TerrainScene.swift`).

- [ ] **2.1 Web:** add a seeded course scheduler in build scope + apply after `fly.sample` (terrain.ts:98), before the terrain-follow clamp.

```ts
      // Sweeping banked course-change layered on the weave (open terrain hides that the
      // ground still scrolls from -Z). Seeded one-direction arc, eased in/out.
      // build-scope state: let courseT0 = 8 + rng()*10, courseDir = 1, courseDur = 12;
      let cs = 0;
      const el = t - courseT0;
      if (el >= 0 && el < courseDur) { const p = el / courseDur; const s = Math.sin(Math.PI * p); cs = s * s; }
      else if (el >= courseDur) { courseT0 = t + 10 + rng() * 14; courseDir = rng() < 0.5 ? -1 : 1; }
      const COURSE_AMP = 38;
      cam.position.x = f.x + courseDir * COURSE_AMP * cs;
      cam.rotation.set(f.pitch, f.yaw + courseDir * 0.22 * cs, f.roll + courseDir * 0.18 * cs);
```
(Replace the existing `cam.position.x = f.x; cam.rotation.set(...)` lines with these; keep the terrain-follow clamp after — it samples cam.position.x so NOE holds.)

- [ ] **2.2 Web verify:** `?scene=terrain` over ~20s → a clear sweeping banked arc; terrain-follow still clears ridges; camera stays on the streamed strip. Commit.
- [ ] **2.3 Native:** mirror in `TerrainScene.swift`. Build + tests. Commit.

---

## PART 3 — Void true heading change

**Files:** `src/engine/engine/scenes/void.ts` (+ native `VoidScene.swift`).

- [ ] **3.1 Web — heading + vector forward + heading-frame weave.** Add build-scope state (`let heading=0, headTarget=0, nextTurnT=18+rng()*22; const camPath = new THREE.Vector3();`). In the updater, ease heading toward target, schedule turns (seeded), translate `camPath` along `fwd`, apply weave along `right`, body yaw = heading + f.yaw, bank from heading rate (see spec §4.3). Replace void.ts:147 (scalar -z step) + :151-152 (cam.x/y + rotation.set).

- [ ] **3.2 Web — reframe spawner (mandatory).** Rewrite `inFlightTube`/`respawn`/recycle (void.ts:64-94,155-172) into the heading frame: `ahead = rock.pos.clone().sub(camPath).dot(fwd)`; recycle when `ahead < -BEHIND`; respawn `camPath + fwd*(FAR..FAR+FAR_VAR) + right*((rng-0.5)*2*FIELD_W) + up*beltY`; tube tested against the camPath line. (heading=0 ⇒ today's behaviour.)

- [ ] **3.3 Web verify:** `?scene=void` over ~25s → the field sweeps as the heading arcs; rocks keep recycling (no thinning); path stays in the field; no rock on the path. Commit.
- [ ] **3.4 Native:** mirror in `VoidScene.swift`. Build + tests (respawn within ±FIELD_W of the path). Commit.

---

## PART 4 — Void wreckage field (new scene `wreckage`)

**Files:** new `src/engine/engine/scenes/wreckage.ts` (or a parameterised void), `data/defaults.ts` (SceneId), `data/dictionary.ts` (MODE_LABELS/BOOT_HEADERS), `modes/film-director.ts` (candidates), `terminal/script-bank.ts` (foreshadow/arrival), `engine/core.ts` (SCENE_REGISTRY); native `SceneRegistry.swift`, `Hud.swift` (SceneMeta), `WreckageScene.swift`, `FilmDirector.swift`, `Script.swift`.

- [ ] **4.1 Extract Void's flythrough core** into a shared builder `buildFlythrough(ctx, templates, fogDensity)` so `void` + `wreckage` share spawn/recycle/heading/weave; `void` passes rock templates, `wreckage` passes debris templates.
- [ ] **4.2 Debris templates:** panels (`BoxGeometry(w,h,0.06)`, sheared corner), struts (`BoxGeometry(0.12,0.12,L)`), station fragments (`mergeGeometries` of 2-4 boxes at hard angles). `flatShading`; erratic non-uniform tumble; non-uniform `mesh.scale`. Keep the ~30% `infectable` subset.
- [ ] **4.3 Register `wreckage`:** SceneId union + `SCENES` + `SCENE_LABELS` (defaults.ts), `DICT.MODE_LABELS['wreckage']` + `BOOT_HEADERS['wreckage']` (dictionary.ts), `SCENE_REGISTRY.wreckage` (core.ts), FilmDirector PHASE_CANDIDATES (PANIC/SILENCE), `SCENE_FORESHADOW`/`SCENE_ARRIVAL` entries.
- [ ] **4.4 Web verify:** `?scene=wreckage` → a debris field (panels/struts/fragments tumbling, CORP-tinted subset). Commit.
- [ ] **4.5 Native:** mirror (`WreckageScene.swift`, SceneRegistry.ids, SceneMeta, FilmDirector candidates, Script pools). Build + tests (scene-id parity). Commit.

---

## PART 5 — City true 90° corner

**Files:** `src/engine/engine/scenes/city.ts` (+ native `CityScene.swift`).

- [ ] **5.1 Heading state + heading-aware scroll:** add `let heading=0` + advance chunks along the heading vector instead of always +z (city.ts:196). Fold heading into yaw (city.ts:211): `cam.rotation.set(f.pitch, f.yaw + heading, f.roll + turnRoll)`.
- [ ] **5.2 Intersection chunk:** a `buildChunk` variant that opens the turn-side wall + lays a perpendicular street with flanking buildings (reuse the building loop with x/z swapped). Make it a distinct seeded chunk that recurs deterministically.
- [ ] **5.3 Turn event + scroll-axis swap:** gate the turn on the intersection chunk reaching the camera (`cA.position.z ≈ 0`); ease `heading` 0→±π/2 over ~3.5s (sin²) with a banked over-roll; swap the scroll/recycle/dust axis z→x; re-map `fly.x` to the new lateral axis.
- [ ] **5.4 Web verify:** `?scene=city` over ~30s → fly to an intersection, bank + turn 90° down the cross-street with buildings lining the new direction; no clip, no pop, dust follows. Commit.
- [ ] **5.5 Native:** mirror in `CityScene.swift`. Build + tests. Commit.

---

## PART 6 — Final

- [ ] Native logic tests: heading easing monotone toward target; rift `curveX` periodic; FilmDirector candidate set includes `wreckage`; void respawn within ±FIELD_W of the path.
- [ ] `npm run typecheck` · `run-native-tests.sh` · app compile · obsidian boundary clean.
- [ ] `verify-crt` all five scenes mid-curve. Update spec status. Merge the branch. Report (no push).

---

## Self-Review
- **Spec coverage:** Rift §4.1 (P1), Terrain §4.2 (P2), Void heading §4.3 (P3), Wreckage §4.4 (P4), City corner §4.5 (P5); shared heading idiom §3 used in every part; tests §6 (P6). All covered.
- **Placeholders:** per-part code shows the novel seams concretely; the heavier parts (void reframe, city corner) reference the spec's exact algorithm + the workflow's key lines rather than pre-coding every line — acceptable for an inline executor reading scene code at impl time, not vague TODOs.
- **Consistency:** `heading`/`headTarget`/`curveX`/`COURSE_AMP`/`camPath` idioms consistent; `wreckage` SceneId used identically across registration sites.
