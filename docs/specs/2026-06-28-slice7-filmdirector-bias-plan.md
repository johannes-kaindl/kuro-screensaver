# Slice 7 — Arc-biased FilmDirector scene itinerary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each story arc's per-phase `scenes` weights bias the FilmDirector's scene-itinerary pick (web), so different arcs visit visually-distinct scene sequences — while the arc-less path stays byte-identical to today.

**Architecture:** `sceneAt` gains an optional trailing `arc?: ArcState` param. When the arc declares `scenes[phase]`, the candidate list is the **weight-expanded** array (each scene repeated `weight` times) consumed by the *unchanged* single-RNG-draw index math; otherwise it is the exact `PHASE_CANDIDATES[phase]` array (zero behavioural change, zero extra RNG). The arc reaches the FilmDirector via a new `NarrativeRunner.currentArc` accessor, passed at the two controller call sites.

**Tech Stack:** TypeScript/Vite, Vitest (`environment: 'node'`).

## Global Constraints

- **Additive invariant (load-bearing):** `sceneAt(i, phase, prev, undefined)` — and with an arc whose `scenes` is absent/empty/missing-this-phase — MUST equal the pre-Slice-7 algorithm byte-for-byte (proven by an oracle test). No extra RNG draw on the arc-less path.
- **One RNG draw per call, unchanged:** `mkRng((seed ^ (index * 0x9e3779b1)) >>> 0)()`. Weighting is done by pre-expanding the candidate array, NOT by a second draw or float cumsum (avoids TS↔Swift float divergence later).
- **Web-only this slice.** The native arc layer does NOT exist yet (Slice 2/3 were web-only; native twin is hand-maintained until the bundled native-1.3 session). Native `FilmDirector`/golden are **untouched** → native tests stay trivially green. Native Slice 7 (the `arc` param + fallback) folds into the future native-arc-layer port.
- **Weights:** positive integers; `weight` floored, min 1. Duplicate ids in one phase list sum naturally via expansion.
- **Off-list scenes allowed:** a `scenes[phase]` entry may name any valid `FlightSceneId` (the arc author owns the itinerary); the JSON validation test guards that ids are valid and weights are positive integers.
- **Golden re-pin: NO.** The native golden + FilmDirector determinism asserts are the additive-invariant proof; they must not move.
- Verify after each task: `npm test`, `npm run typecheck`, `npm run build`; native untouched but run `bash scripts/run-native-tests.sh` once at the end to confirm no incidental breakage.

## Decisions (resolved during understand-phase)

1. Native scope → **web-only**; native param/fallback deferred to the native-arc-layer port (no native arc to bias).
2. Weight semantics → **pre-expanded integer-repeat array + existing single draw** (rejected: cumsum-with-extra-draw).
3. Off-list scenes → **allow any valid `FlightSceneId`**, validate in JSON test.
4. Anti-repeat → generalised to "rotate to next slot whose scene differs from `prevScene`"; **byte-identical** to the old `(i+1)%len` rule on the all-distinct `PHASE_CANDIDATES` arrays (proven by oracle test), and honours no-immediate-repeat on weighted arrays.
5. Content → author `scenes` for harmonized/cold-path/karsen/wraith; **normal gets none** (anchors the additive invariant in production content).

---

### Task 1: Arc-biased `sceneAt` + `SceneWeight` + additive-invariant/distribution tests

**Files:**
- Modify: `src/engine/modes/film-director.ts`
- Create: `tests/film-director.test.ts`

**Interfaces:**
- Consumes: `ArcState` (`src/engine/terminal/arc.ts:31`), `mkRng` (`src/engine/engine/rng.ts`).
- Produces: `FilmDirector.sceneAt(index: number, phase: Phase, prevScene: SceneId | null, arc?: ArcState): FlightSceneId`; `export interface SceneWeight { scene: FlightSceneId; weight: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/film-director.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FilmDirector } from '../src/engine/modes/film-director';
import { mkRng } from '../src/engine/engine/rng';
import type { ArcState } from '../src/engine/terminal/arc';
import type { Phase } from '../src/engine/terminal/narrative';

// Oracle = the pre-Slice-7 algorithm, verbatim, as the additive-invariant reference.
const PHASE_CANDIDATES: Record<Phase, string[]> = {
  ROUTINE: ['terrain', 'city'],
  INTRUSION: ['city', 'rift'],
  ALARM: ['rift', 'tunnel'],
  PANIC: ['tunnel', 'void', 'wreckage'],
  SILENCE: ['void', 'wreckage'],
};
function oracle(seed: number, index: number, phase: Phase, prev: string | null): string {
  const cands = PHASE_CANDIDATES[phase];
  const r = mkRng((seed ^ (index * 0x9e3779b1)) >>> 0)();
  let i = Math.floor(r * cands.length) % cands.length;
  if (cands[i] === prev && cands.length > 1) i = (i + 1) % cands.length;
  return cands[i];
}
const PHASES: Phase[] = ['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE'];
const ALL = ['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage', null] as const;
function arcWith(scenes: ArcState['arc']['scenes']): ArcState {
  return { arc: { id: 'x', weight: 1, antagonist: '', mentor: null, beatTags: {}, scenes, ending: { default: 'normal' } } as any, threatStage: 0, peakStage: 0 };
}

describe('FilmDirector additive invariant (arc-less ≡ pre-Slice-7 oracle)', () => {
  it('matches the oracle across a sweep with arc=undefined / empty / missing-phase', () => {
    for (const seed of [1, 42, 1337, 0x9e3779b1 | 0]) {
      const fd = new FilmDirector(seed);
      for (let index = 0; index < 60; index++) {
        for (const phase of PHASES) {
          for (const prev of ALL) {
            const want = oracle(seed, index, phase, prev);
            expect(fd.sceneAt(index, phase, prev)).toBe(want);                       // undefined arc
            expect(fd.sceneAt(index, phase, prev, arcWith(undefined))).toBe(want);   // no scenes
            expect(fd.sceneAt(index, phase, prev, arcWith({}))).toBe(want);          // empty scenes
            expect(fd.sceneAt(index, phase, prev, arcWith({ ROUTINE: [] }))).toBe(want); // empty phase list + other phases missing
          }
        }
      }
    }
  });
});

describe('FilmDirector arc bias', () => {
  it('weights the heavy scene roughly proportionally and never picks off-override scenes', () => {
    const fd = new FilmDirector(12345);
    const arc = arcWith({ PANIC: [{ scene: 'wreckage', weight: 3 }, { scene: 'void', weight: 1 }] });
    let wreck = 0, voidc = 0;
    const N = 600;
    for (let index = 0; index < N; index++) {
      const s = fd.sceneAt(index, 'PANIC', null, arc); // prev=null → anti-repeat never fires
      expect(s === 'wreckage' || s === 'void').toBe(true);
      if (s === 'wreckage') wreck++; else voidc++;
    }
    expect(wreck).toBeGreaterThan(voidc);            // heavy scene dominates
    expect(wreck / voidc).toBeGreaterThan(1.8);      // ≈3:1, generous tolerance
    expect(wreck / voidc).toBeLessThan(5.0);
  });

  it('allows an off-list scene the phase candidates do not include', () => {
    const fd = new FilmDirector(7);
    const arc = arcWith({ PANIC: [{ scene: 'terrain', weight: 1 }] });
    for (let index = 0; index < 10; index++) {
      expect(fd.sceneAt(index, 'PANIC', null, arc)).toBe('terrain');
    }
  });

  it('avoids an immediate repeat on a weighted array when an alternative exists', () => {
    const fd = new FilmDirector(99);
    const arc = arcWith({ PANIC: [{ scene: 'wreckage', weight: 3 }, { scene: 'void', weight: 1 }] });
    for (let index = 0; index < 50; index++) {
      expect(fd.sceneAt(index, 'PANIC', 'wreckage', arc)).not.toBe('wreckage');
    }
  });
});
```

- [ ] **Step 2: Run the tests — they must FAIL**

Run: `npx vitest run tests/film-director.test.ts`
Expected: FAIL — `sceneAt` does not accept a 4th arg / arc bias not implemented (the bias + off-list tests fail; the invariant test may pass coincidentally on the current code but the arc-arg calls are type/runtime errors).

- [ ] **Step 3: Implement the arc-biased `sceneAt`**

Rewrite `src/engine/modes/film-director.ts`:

```ts
// FilmDirector — seeded scene selection for the narrative arc. Pure: a function of
// (seed, monotonic phase index, phase, prevScene[, arc]). "Fester Bogen, prozedurale Welt":
// the phase decides the intensity tier (candidate list); the index decides which one.
// Slice 7: an arc may bias the per-phase candidates via weighted SceneWeights.
import { mkRng } from '../engine/rng';
import type { SceneId } from '../data/defaults';
import type { Phase } from '../terminal/narrative';
import type { ArcState } from '../terminal/arc';

/** Scenes that are real flights (excludes the screen-space 'matrix' fx scene). */
export type FlightSceneId = Exclude<SceneId, 'matrix'>;

/** A weighted scene candidate for arc-biased itineraries (Slice 7). */
export interface SceneWeight { scene: FlightSceneId; weight: number; }

const PHASE_CANDIDATES: Record<Phase, FlightSceneId[]> = {
  ROUTINE:   ['terrain', 'city'],
  INTRUSION: ['city', 'rift'],
  ALARM:     ['rift', 'tunnel'],
  PANIC:     ['tunnel', 'void', 'wreckage'],
  SILENCE:   ['void', 'wreckage'],
};

/** Candidate list for a phase, optionally biased by the arc's per-phase SceneWeights.
 *  Arc-less / absent / empty override → the exact PHASE_CANDIDATES array (byte-identical
 *  path: same order, same length → the draw + anti-repeat below run as before). */
function candidatesFor(phase: Phase, arc?: ArcState): FlightSceneId[] {
  const override = arc?.arc.scenes?.[phase];
  if (!override || override.length === 0) return PHASE_CANDIDATES[phase];
  const out: FlightSceneId[] = [];
  for (const w of override) {
    const n = Math.max(1, Math.floor(w.weight));
    for (let k = 0; k < n; k++) out.push(w.scene as FlightSceneId);
  }
  return out;
}

export class FilmDirector {
  constructor(private seed: number) {}

  /** Deterministic scene for the given monotonic index + phase, avoiding prevScene.
   *  `arc` (Slice 7) optionally biases the candidate list via weighted repetition. */
  sceneAt(index: number, phase: Phase, prevScene: SceneId | null, arc?: ArcState): FlightSceneId {
    const cands = candidatesFor(phase, arc);
    const r = mkRng((this.seed ^ (index * 0x9e3779b1)) >>> 0)();   // deterministic 0..1 per index
    let i = Math.floor(r * cands.length) % cands.length;
    // anti-repeat: rotate to the next slot whose scene differs from prevScene. On the
    // all-distinct PHASE_CANDIDATES this is the old `(i+1)%len` single step (byte-identical);
    // on a weighted array it skips repeated heavy-scene slots.
    if (cands.length > 1) {
      let guard = 0;
      while (cands[i] === prevScene && guard < cands.length) { i = (i + 1) % cands.length; guard++; }
    }
    return cands[i];
  }
}
```

- [ ] **Step 4: Run the tests — they must PASS; then the full suite**

Run: `npx vitest run tests/film-director.test.ts && npm test && npm run typecheck`
Expected: all green (additive invariant matches oracle; distribution + off-list + anti-repeat pass).

- [ ] **Step 5: Commit**

```bash
git add src/engine/modes/film-director.ts tests/film-director.test.ts
git commit -m "feat(film): arc-biased scene itinerary via weighted SceneWeights (additive-invariant)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Author arc `scenes` content + JSON validation test

**Files:**
- Modify: `src/engine/data/story-content.json` (add `scenes` to 4 arcs)
- Create: `tests/arc-scenes.test.ts`

**Interfaces:**
- Consumes: `ARCS` (`src/engine/terminal/script-bank.ts:72`, `story.arcs as readonly ArcTemplate[]`).
- Produces: validated `scenes` on the harmonized/cold-path/karsen/wraith arc objects.

- [ ] **Step 1: Write the failing validation test**

Create `tests/arc-scenes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ARCS } from '../src/engine/terminal/script-bank';

const VALID_SCENES = new Set(['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage']);
const PHASES = new Set(['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE']);

describe('arc scenes content', () => {
  it('every declared scenes entry is a valid FlightSceneId with a positive integer weight', () => {
    for (const arc of ARCS) {
      if (!arc.scenes) continue;
      for (const [phase, list] of Object.entries(arc.scenes)) {
        expect(PHASES.has(phase), `arc ${arc.id} bad phase ${phase}`).toBe(true);
        expect(Array.isArray(list)).toBe(true);
        for (const w of list!) {
          expect(VALID_SCENES.has(w.scene), `arc ${arc.id}/${phase} bad scene ${w.scene}`).toBe(true);
          expect(Number.isInteger(w.weight) && w.weight > 0, `arc ${arc.id}/${phase} bad weight ${w.weight}`).toBe(true);
        }
      }
    }
  });

  it('at least the four flavoured arcs declare scenes; normal stays a pure fallback', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    for (const id of ['harmonized', 'cold-path', 'karsen', 'wraith']) {
      expect(byId[id]?.scenes, `arc ${id} should declare scenes`).toBeTruthy();
    }
    expect(byId['normal']?.scenes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — the second test must FAIL** (no arc declares `scenes` yet)

Run: `npx vitest run tests/arc-scenes.test.ts`
Expected: the "flavoured arcs declare scenes" test FAILS; the validation test passes vacuously.

- [ ] **Step 3: Add `scenes` to the four arcs in `story-content.json`**

For each arc object in the `arcs` array, add a `"scenes"` key (alongside `phaseRouting`/`durationScale`/`beatTags`). Keep biases in-tier except where deliberately expressive. Add to **harmonized**:

```json
      "scenes": {
        "ROUTINE": [{ "scene": "terrain", "weight": 3 }, { "scene": "city", "weight": 1 }],
        "INTRUSION": [{ "scene": "city", "weight": 2 }, { "scene": "rift", "weight": 1 }],
        "SILENCE": [{ "scene": "void", "weight": 3 }, { "scene": "wreckage", "weight": 1 }]
      },
```

**cold-path** (note FilmDirector sees the *routed* phase):

```json
      "scenes": {
        "ROUTINE": [{ "scene": "city", "weight": 2 }, { "scene": "terrain", "weight": 1 }],
        "PANIC": [{ "scene": "tunnel", "weight": 3 }, { "scene": "void", "weight": 1 }, { "scene": "wreckage", "weight": 1 }]
      },
```

**karsen**:

```json
      "scenes": {
        "ALARM": [{ "scene": "rift", "weight": 1 }, { "scene": "tunnel", "weight": 3 }],
        "PANIC": [{ "scene": "tunnel", "weight": 2 }, { "scene": "void", "weight": 2 }, { "scene": "wreckage", "weight": 1 }]
      },
```

**wraith**:

```json
      "scenes": {
        "ROUTINE": [{ "scene": "city", "weight": 2 }, { "scene": "terrain", "weight": 1 }],
        "PANIC": [{ "scene": "wreckage", "weight": 3 }, { "scene": "void", "weight": 2 }, { "scene": "tunnel", "weight": 1 }],
        "SILENCE": [{ "scene": "wreckage", "weight": 3 }, { "scene": "void", "weight": 1 }]
      },
```

(Do NOT add `scenes` to **normal**. Mind JSON commas — `scenes` is a normal object member of each arc.)

- [ ] **Step 4: Run the test — it must PASS; then the full suite**

Run: `npx vitest run tests/arc-scenes.test.ts && npm test && npm run typecheck`
Expected: all green. Verified: no guard hashes the full arcs export (`script-bank-parity` hashes `routineStream()`/`plainPools()`; `arc-content` checks ids/structure only) — so adding `scenes` trips nothing and needs no re-pin.

- [ ] **Step 5: Commit**

```bash
git add src/engine/data/story-content.json tests/arc-scenes.test.ts
git commit -m "feat(content): per-arc scene-itinerary biases + validation guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the arc into `sceneAt` (narrative accessor + controller call sites)

**Files:**
- Modify: `src/engine/terminal/narrative.ts` (add `currentArc` accessor)
- Modify: `src/engine/controller.ts` (pass the arc at both `sceneAt` call sites)

**Interfaces:**
- Consumes: `FilmDirector.sceneAt(..., arc?)` (Task 1), `ArcState`.
- Produces: `NarrativeRunner.currentArc: ArcState | undefined` (getter).

- [ ] **Step 1: Add the accessor to `NarrativeRunner`**

In `src/engine/terminal/narrative.ts`, after `updateThreatStage` (~line 130), add:

```ts
  /** The shift's selected arc (Slice 7: lets the FilmDirector bias its itinerary). */
  get currentArc(): ArcState | undefined { return this.arc; }
```

- [ ] **Step 2: Pass the arc at both controller call sites**

In `src/engine/controller.ts`, line ~858 (`onFilmPhase`):

```ts
    const next = this.film.sceneAt(this.phaseCounter, phase, this.currentFilmScene, this.narrative?.currentArc);
```

Line ~867 (`foreshadowFor`):

```ts
    const sc = this.film.sceneAt(this.phaseCounter, nextPhase, this.currentFilmScene, this.narrative?.currentArc);
```

- [ ] **Step 3: Verify — typecheck, build, full suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck clean (the getter + 4th arg type correctly); build succeeds; all tests green. No new DOM test — the wiring is thin; the biasing logic is covered by Task 1's unit tests, and the accessor is a one-line passthrough.

- [ ] **Step 4: Commit**

```bash
git add src/engine/terminal/narrative.ts src/engine/controller.ts
git commit -m "feat(controller): feed the shift arc into the FilmDirector scene itinerary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full verification gate

**Files:** none.

- [ ] **Step 1: Web gates**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green — `film-director` (invariant + bias), `arc-scenes` (content validation), and the pre-existing suite; typecheck clean; build emits `dist/`.

- [ ] **Step 2: Native untouched — confirm no incidental breakage**

Run: `bash scripts/run-native-tests.sh`
Expected: ALL PASS — FilmDirector determinism + golden hash `15657498981793719251` unchanged (native code not modified this slice).

- [ ] **Step 3: Confirm invariants by inspection**

- `git grep -n "sceneAt(" src/engine` → both controller call sites pass `this.narrative?.currentArc`; `film-director.ts` defines the 4-arg signature.
- The additive-invariant test (`tests/film-director.test.ts`) passing against the inline oracle is the byte-identity proof for the arc-less path.

---

## Self-Review

**Spec coverage:** SceneWeight type + arc `scenes` consumption (Task 1) · per-arc content (Task 2) · wiring (Task 3) · acceptance "arc biases scene itinerary" (Task 1 distribution test + Task 3 live wiring). Native deferral documented (Global Constraints). ✓

**Placeholder scan:** none — every code/JSON/command step concrete.

**Type consistency:** `sceneAt(index, phase, prevScene, arc?)` defined in Task 1, consumed in Task 3; `currentArc` getter defined in Task 3 Step 1, consumed Step 2; `SceneWeight` exported (used by future native port / external readers); `ArcState`/`ArcTemplate.scenes` shapes match `arc.ts:26,31`. FNV/golden untouched (no re-pin). Distribution tolerance bounds (1.8–5.0) and weight semantics (floor, min 1) consistent across plan + tests.
