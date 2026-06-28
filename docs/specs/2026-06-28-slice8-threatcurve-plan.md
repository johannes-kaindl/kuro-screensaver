# Slice 8 — Arc-aware threatCurve in ReactiveWorld — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each story arc's per-phase `threatCurve` overrides ReactiveWorld's default threat BAND, so different arcs reach different corruption stages — and therefore different endings (the diverts gate at stage 3) — while the no-arc / no-curve path stays byte-identical to today.

**Architecture:** `threatCurve?: Partial<Record<Phase, [lo, hi]>>` is an absolute drop-in replacement for the static `BAND[phase]` (design doc §"override reactive-world BAND per phase"). One seam line in `reactive-world.update()` reads `narrative.currentArc?.arc.threatCurve?.[phase] ?? BAND[phase]`. The threat path is RNG-free; the existing `quantizeThreat → updateThreatStage → peakStage → resolveEnding` chain (Slice 2) turns a curve into a stage/ending change — fully testable now, independent of the Slice-4 corruption *render*.

**Tech Stack:** TypeScript/Vite, Vitest (`environment: 'node'`).

## Global Constraints

- **Additive invariant:** with `currentArc` undefined, or an arc without `threatCurve`, or a `threatCurve` missing the current phase, the threat output MUST be byte-identical to today via `?? BAND[phase]`. No new RNG on the threat path (golden + determinism hold).
- **Semantics:** `threatCurve[phase] = [lo, hi]` is an **absolute** band, lerped across `phaseProgress` by the existing `smoothstep` — NOT a multiplier/bias/ramp. Same math as `BAND`.
- **Validation:** every declared curve entry must satisfy `0 ≤ lo ≤ hi ≤ 1` (content-test guard; `lo > hi` would invert the ramp).
- **Do NOT change peakStage tracking** (`narrative.updateThreatStage` running-max; `resolveEnding` at SILENCE) — Slice 8 only changes the threat *input*.
- **`forcedThreat` (URL `?threat=`) keeps bypassing curves** (`reactive-world.ts:87-89`) — intentional tuning escape hatch.
- **Web-only this slice.** No native arc/threat-band layer exists yet (native band is an inline switch in `Renderer.swift`); native threatCurve rides with the native-1.3 on-device session. Native untouched → golden stays green.
- Verify after each task: `npm test`, `npm run typecheck`, `npm run build`; native untouched but run `bash scripts/run-native-tests.sh` once at the end.

## Decisions (resolved during understand-phase)

A. Semantics → absolute per-phase BAND replacement (design-doc-backed). B. Seam via `narrative.currentArc` (no deps/constructor change). C. Author curves now (else the slice is inert). D. Validate `0≤lo≤hi≤1` in a content test. E. peakStage tracking unchanged.

## Reference (verified)

- `BAND` (`reactive-world.ts:16-22`): ROUTINE `[0,0.12]`, INTRUSION `[0.12,0.38]`, ALARM `[0.38,0.70]`, PANIC `[0.70,1.00]`, SILENCE `[1,1]`.
- `quantizeThreat` (`arc.ts:38-44`): `calm⇒0`; else `<0.15→0`, `<0.40→1`, `<0.70→2`, else `3`.
- Diverts (all gate at stage 3): harmonized→cold-path, cold-path→captured, karsen→captured; normal & wraith have none (`story-content.json`).
- Seam line: `reactive-world.ts:95` `const [lo, hi] = BAND[phase];`.

---

### Task 1: Arc-aware threat band in ReactiveWorld + seam test

**Files:**
- Modify: `src/engine/fx/reactive-world.ts` (line 95)
- Create: `tests/reactive-world.test.ts`

**Interfaces:**
- Consumes: `NarrativeRunner.currentArc` (`narrative.ts:133`), `ArcState.arc.threatCurve` (`arc.ts:27`), `quantizeThreat`.
- Produces: no API change — `ReactiveWorld.update()` now applies the arc's per-phase band override.

- [ ] **Step 1: Write the failing seam test**

Create `tests/reactive-world.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReactiveWorld } from '../src/engine/fx/reactive-world';
import type { ArcState } from '../src/engine/terminal/arc';
import type { Phase } from '../src/engine/terminal/narrative';

// Minimal fakes: ReactiveWorld only touches these members of engine/narrative.
function fakeEngine() {
  return {
    seed: 1, onFrame: null as unknown,
    bus: { emit() {} },
    threat: 0, storm: 0, fogThreatMult: 1,
    setEnemyFraction() {}, setCrtThreat() {}, setBloomThreat() {},
  };
}
function fakeNarrative(phase: Phase, progress: number, arc?: ArcState) {
  const stages: number[] = [];
  return {
    obj: {
      currentPhase: phase,
      phaseProgress: progress,
      currentArc: arc,
      updateThreatStage: (s: number) => stages.push(s),
      d: { onIntrusion: undefined as undefined | (() => void) },
    },
    stages,
  };
}
function arcWith(threatCurve: ArcState['arc']['threatCurve']): ArcState {
  return { arc: { id: 'x', weight: 1, antagonist: '', mentor: null, beatTags: {}, threatCurve, ending: { default: 'normal' } } as any, threatStage: 0, peakStage: 0 };
}

/** Drive update() to steady state at the given phase/progress; return the last stage fed. */
function steadyStage(arc: ArcState | undefined, phase: Phase = 'PANIC', progress = 1): number {
  const eng = fakeEngine();
  const narr = fakeNarrative(phase, progress, arc);
  const rw = new ReactiveWorld({ engine: eng as any, narrative: narr.obj as any, crt: null, settings: {} as any, calm: false });
  for (let i = 0; i < 4000; i++) rw.update(i * 16, 16); // low-pass converges to target
  return narr.stages[narr.stages.length - 1];
}

describe('ReactiveWorld arc threatCurve', () => {
  it('additive invariant: no arc / arc-without-curve / curve-missing-phase all reach the BAND stage', () => {
    const baseline = steadyStage(undefined);                         // BAND PANIC [0.70,1.0] → 3
    expect(baseline).toBe(3);
    expect(steadyStage(arcWith(undefined))).toBe(baseline);          // arc, no curve
    expect(steadyStage(arcWith({})).valueOf()).toBe(baseline);       // empty curve
    expect(steadyStage(arcWith({ ROUTINE: [0, 0.05] }))).toBe(baseline); // curve missing PANIC
  });

  it('a capping curve keeps PANIC below the stage-3 threshold', () => {
    expect(steadyStage(arcWith({ PANIC: [0.0, 0.65] }))).toBe(2); // < 0.70 → stage 2
  });

  it('a full curve still reaches stage 3', () => {
    expect(steadyStage(arcWith({ PANIC: [0.0, 1.0] }))).toBe(3);
  });

  it('an ALARM cap lowers the ALARM-phase stage', () => {
    expect(steadyStage(arcWith({ ALARM: [0.0, 0.30] }), 'ALARM', 1)).toBe(1); // < 0.40 → stage 1
    expect(steadyStage(undefined, 'ALARM', 1)).toBe(2);                       // BAND ALARM hi 0.70 → stage 2
  });
});
```

- [ ] **Step 2: Run the tests — the curve tests must FAIL**

Run: `npx vitest run tests/reactive-world.test.ts`
Expected: the additive-invariant test passes (current code uses BAND), but the capping/full/ALARM-cap tests FAIL (the curve is ignored → still BAND stages).

- [ ] **Step 3: Apply the seam**

In `src/engine/fx/reactive-world.ts`, replace line 95:

```ts
      const [lo, hi] = BAND[phase];
```

with:

```ts
      // Slice 8: an arc may override the per-phase band; absent/partial → BAND (additive).
      const [lo, hi] = this.d.narrative.currentArc?.arc.threatCurve?.[phase] ?? BAND[phase];
```

(`this.d.narrative` is non-null in this `else if` branch at `:90`; `currentArc` is the Slice-7 accessor; no RNG, no deps change.)

- [ ] **Step 4: Run the tests — all PASS; then the full suite**

Run: `npx vitest run tests/reactive-world.test.ts && npm test && npm run typecheck`
Expected: all green (curve shifts stages; additive invariant holds; pre-existing suite + arc/quantize tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/engine/fx/reactive-world.ts tests/reactive-world.test.ts
git commit -m "feat(reactive-world): arc threatCurve overrides per-phase threat band (additive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Author per-arc `threatCurve` content + validation test

**Files:**
- Modify: `src/engine/data/story-content.json` (add `threatCurve` to harmonized/cold-path/karsen/wraith)
- Create: `tests/arc-threatcurve.test.ts`

**Interfaces:**
- Consumes: `ARCS` (`script-bank.ts:72`).
- Produces: validated `threatCurve` on four arcs; an ending-divergence assertion proving curves matter.

- [ ] **Step 1: Write the failing validation + divergence test**

Create `tests/arc-threatcurve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ARCS } from '../src/engine/terminal/script-bank';
import { resolveEnding, quantizeThreat } from '../src/engine/terminal/arc';

const PHASES = new Set(['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE']);

describe('arc threatCurve content', () => {
  it('every declared threatCurve entry is a valid [lo,hi] with 0 ≤ lo ≤ hi ≤ 1', () => {
    for (const arc of ARCS) {
      if (!arc.threatCurve) continue;
      for (const [phase, band] of Object.entries(arc.threatCurve)) {
        expect(PHASES.has(phase), `arc ${arc.id} bad phase ${phase}`).toBe(true);
        expect(Array.isArray(band) && band!.length === 2, `arc ${arc.id}/${phase} not a pair`).toBe(true);
        const [lo, hi] = band!;
        expect(lo >= 0 && lo <= hi && hi <= 1, `arc ${arc.id}/${phase} bad band [${lo},${hi}]`).toBe(true);
      }
    }
  });

  it('the flavoured arcs declare threatCurve; normal stays pure', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    for (const id of ['harmonized', 'cold-path', 'karsen', 'wraith']) {
      expect(byId[id]?.threatCurve, `arc ${id} should declare threatCurve`).toBeTruthy();
    }
    expect(byId['normal']?.threatCurve).toBeUndefined();
  });

  it('curves drive divergent endings: harmonized stays shallow, cold-path/karsen reach captured', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    // harmonized PANIC band caps below 0.70 → peakStage 2 → no divert → 'harmonized'
    const hPanic = byId['harmonized'].threatCurve!.PANIC!;
    expect(quantizeThreat(hPanic[1], false)).toBeLessThan(3);
    expect(resolveEnding(byId['harmonized'], quantizeThreat(hPanic[1], false))).toBe('harmonized');
    // cold-path PANIC band reaches stage 3 → divert → 'captured'
    const cPanic = byId['cold-path'].threatCurve!.PANIC!;
    expect(quantizeThreat(cPanic[1], false)).toBe(3);
    expect(resolveEnding(byId['cold-path'], 3)).toBe('captured');
    // karsen likewise
    expect(resolveEnding(byId['karsen'], quantizeThreat(byId['karsen'].threatCurve!.PANIC![1], false))).toBe('captured');
  });
});
```

- [ ] **Step 2: Run it — the flavoured/divergence tests must FAIL** (no arc declares threatCurve yet)

Run: `npx vitest run tests/arc-threatcurve.test.ts`
Expected: the "declare threatCurve" + "divergent endings" tests FAIL; the validation test passes vacuously.

- [ ] **Step 3: Add `threatCurve` to the four arcs in `story-content.json`**

Add a `"threatCurve"` key to each arc object (alongside `scenes`/`beatTags`). **harmonized** (stays shallow — caps PANIC below 0.70):

```json
      "threatCurve": {
        "ALARM": [0.30, 0.55],
        "PANIC": [0.55, 0.62]
      },
```

**cold-path** (front-loads, reliably hits stage 3):

```json
      "threatCurve": {
        "INTRUSION": [0.12, 0.55],
        "PANIC": [0.80, 1.00]
      },
```

**karsen** (sustained high peak):

```json
      "threatCurve": {
        "ALARM": [0.45, 0.72],
        "PANIC": [0.85, 1.00]
      },
```

**wraith** (hardest/earliest peak; no divert so ending stays `wraith`, but the steeper curve feeds Slice-4 render later):

```json
      "threatCurve": {
        "ROUTINE": [0.00, 0.05],
        "PANIC": [0.90, 1.00]
      },
```

(Do NOT add to **normal**. Insert each `threatCurve` after that arc's `scenes` block and before `ending`; mind JSON commas.)

- [ ] **Step 4: Run the test — all PASS; then the full suite**

Run: `npx vitest run tests/arc-threatcurve.test.ts && npm test && npm run typecheck`
Expected: all green. No parity guard hashes the full arcs (verified in Slice 7) → no re-pin.

- [ ] **Step 5: Commit**

```bash
git add src/engine/data/story-content.json tests/arc-threatcurve.test.ts
git commit -m "feat(content): per-arc threatCurve bands → divergent corruption stages/endings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full verification gate

**Files:** none.

- [ ] **Step 1: Web gates** — `npm test && npm run typecheck && npm run build` → all green (reactive-world + arc-threatcurve + pre-existing suite; build emits `dist/`).
- [ ] **Step 2: Native untouched** — `bash scripts/run-native-tests.sh` → ALL PASS, golden hash `15657498981793719251` unchanged.
- [ ] **Step 3: Inspect** — `git grep -n "threatCurve" src/engine` → only the seam in `reactive-world.ts` consumes it; `arc.ts:27` declares it. Confirm `forcedThreat` bypass (`reactive-world.ts:87-89`) is intact.

---

## Self-Review

**Spec coverage:** threatCurve consumption (Task 1) · per-arc content (Task 2) · acceptance "arc threat-curve alters corruption stage" (Task 1 stage tests + Task 2 ending-divergence). Native deferral + Slice-4 independence documented. ✓
**Placeholder scan:** none.
**Type consistency:** seam reads `currentArc?.arc.threatCurve?.[phase] ?? BAND[phase]` matching `arc.ts:27` shape; `steadyStage` fakes match the exact members `ReactiveWorld` touches (`reactive-world.ts:51-138`); band guard `0≤lo≤hi≤1` consistent with `smoothstep`; golden untouched (no re-pin). ✓
