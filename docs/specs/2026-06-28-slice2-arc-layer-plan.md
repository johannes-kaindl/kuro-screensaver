# Slice 2 — Arc-Layer (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the web side of the Arc-Template layer — the narrative branches by pacing, routing, mentor presence, tag-filtered beats, and a resolved ending — while staying byte-identical to today when no arc is selected.

**Architecture:** A new pure-logic module `arc.ts` (the TS twin; Swift twin lands later with native 1.3) holds the arc types + `pick`/`pickArc`/`arcAllows`/`selectArc`/`resolveEnding`/`quantizeThreat`. `narrative.ts` gains an optional `ArcState` it consults at the decision moments; every `pick(POOL)` becomes `pickArc(POOL, this.arc)` (inert when arc is undefined). Arc CONTENT (5 templates + 6 ending sets + beat tags) lives in the JSON SSOT. `ReactiveWorld` feeds the quantized threat stage to the runner so the ending can divert.

**Tech Stack:** TypeScript/Vite + vitest. Native (Swift/Metal) is **out of scope here** — Slice-2-native is bundled with native 1.3 in a later on-device session; it reads the same JSON arcs.

**Spec:** `docs/specs/2026-06-28-slice2-arc-layer-design.md` (read first — the 5-arc bible, tag vocabulary, all 6 ending sets, scope). Parent architecture: `docs/specs/2026-06-15-story-arcs-corruption-design.md` §1.

## Global Constraints

- **Additive invariant:** with no arc selected (`arc` undefined), narrative output (beat sequence, timing, threat curve, persona) is identical to today for a given seed. Enforced by: `pickArc(pool, undefined)` consumes RNG and returns identically to `pick(pool)` (unit-tested); all arc-affecting branches are `if (this.arc)`/`?? default` guarded; `arc=undefined` resolves the `normal` ending (= today's pools). The first shift is always arc-undefined (selection happens in `silentReset` for the *next* shift).
- **RNG discipline:** the narrative uses `Math.random()` directly at its pick/branch sites. New code must not consume `Math.random()` on the arc-undefined path beyond what today consumes. `pick` lives in `arc.ts` as the single shared formula `arr[Math.floor(Math.random() * arr.length)]`.
- **Parity guards stay green:** `tests/script-bank-parity.test.ts` and `tests/dict-presets-parity.test.ts`. Adding `tags` to beats changes the tagged-pool hash → re-pin **once** (reviewed); `routineStream` (cmd+resp text) is unaffected by tags. `FAREWELLS`/`LAST_WORDS` keep identical *values* (aliased to `endings.*.normal`) → their hash is unchanged.
- **Verification per task:** `npm test` + `npm run typecheck` + `npm run build` green before commit. Native tests untouched this slice (`bash scripts/run-native-tests.sh` stays green — no native files change).
- **Lean content:** no new antagonist beat prose; variability = routing + pacing + mentor + ending + tag-filtering of existing beats.
- **EndingId set:** `'harmonized' | 'cold-path' | 'karsen' | 'wraith' | 'captured' | 'normal'`.
- **Tag vocabulary:** theme `drift | trace | injection | wraith`; tone `calm | aggressive | technical`.

---

## File structure

**Create**
- `src/engine/terminal/arc.ts` — arc types + pure logic (`pick`, `pickArc`, `arcAllows`, `selectArc`, `resolveEnding`, `quantizeThreat`). One responsibility: arc policy, no I/O, no DOM.
- `tests/arc.test.ts` — unit tests for every `arc.ts` function (the additive-invariant + parity enforcement).

**Modify**
- `src/engine/data/story-content.json` — add `endings` (move `beats.farewells`/`beats.lastWords` → `endings.farewells.normal`/`endings.lastWords.normal`, author 5 new ending sets) + `arcs` (5 `ArcTemplate`); add `tags` to a subset of intrusion/routine beats.
- `src/engine/terminal/script-bank.ts` — facade: `FAREWELLS`/`LAST_WORDS` re-point to `story.endings.*.normal`; add `ENDINGS` + `ARCS` exports; add `tags?: string[]` to `RoutineBeat`/`IntrusionEvent`.
- `src/engine/terminal/narrative.ts` — import from `arc.ts`; remove local `pick`; `arc`/`arcsCompleted`/`endingId` fields + `updateThreatStage`; sweep `pick(...)→pickArc(...)`; arc-aware next-phase routing + per-phase duration; mentor-availability gate; ending resolution + ending-keyed `beatSilence`; arc selection in `silentReset`; accept `arcs` ctor arg.
- `src/engine/fx/reactive-world.ts` — feed `narrative.updateThreatStage(quantizeThreat(threat, calm))` each frame.
- `src/engine/controller.ts` — pass `ARCS` to the `NarrativeRunner` constructor.
- `tests/script-bank-parity.test.ts` — re-pin the plain-pools hash after beats gain `tags` (one reviewed change).

---

## Task 1: `arc.ts` core types + `pick`/`pickArc`/`arcAllows`

**Files:**
- Create: `src/engine/terminal/arc.ts`
- Test: `tests/arc.test.ts`

**Interfaces:**
- Produces: `EndingId`, `EndingSpec`, `ArcTemplate`, `ArcState`, `Stage`, `pick<T>(arr): T`, `pickArc<T>(pool, arc?): T`, `arcAllows(beatTags, arcTags): boolean`.

- [ ] **Step 1: Write the failing test** — `tests/arc.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { pick, pickArc, arcAllows, type ArcState, type ArcTemplate } from '../src/engine/terminal/arc';

afterEach(() => vi.restoreAllMocks());

// A seeded Math.random so pick/pickArc are reproducible (the LCG from rng.ts).
function seedMathRandom(seed: number) {
  let s = (seed | 0) || 1;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  });
}

const ARC = (over: Partial<ArcTemplate> = {}): ArcTemplate => ({
  id: 'x', weight: 1, antagonist: 'a', mentor: null,
  beatTags: {}, ending: { default: 'normal' }, ...over,
});
const STATE = (arc: ArcTemplate): ArcState => ({ arc, threatStage: 0, peakStage: 0 });

describe('arcAllows', () => {
  it('untagged beat is always eligible', () => {
    expect(arcAllows(undefined, { include: ['wraith'] })).toBe(true);
    expect(arcAllows([], { include: ['wraith'] })).toBe(true);
  });
  it('include: tagged beat must share >=1 include tag', () => {
    expect(arcAllows(['wraith'], { include: ['wraith', 'aggressive'] })).toBe(true);
    expect(arcAllows(['drift'], { include: ['wraith', 'aggressive'] })).toBe(false);
  });
  it('exclude: tagged beat sharing an exclude tag is rejected', () => {
    expect(arcAllows(['calm'], { exclude: ['calm'] })).toBe(false);
  });
  it('exclude wins over include on conflict', () => {
    expect(arcAllows(['wraith', 'calm'], { include: ['wraith'], exclude: ['calm'] })).toBe(false);
  });
});

describe('pickArc RNG-neutrality (the additive invariant)', () => {
  it('pickArc(pool, undefined) returns the same sequence as pick(pool)', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    seedMathRandom(2025);
    const viaPick = Array.from({ length: 50 }, () => pick(pool));
    seedMathRandom(2025);
    const viaArc = Array.from({ length: 50 }, () => pickArc(pool, undefined));
    expect(viaArc).toEqual(viaPick);
  });
  it('pickArc filters tagged object pools by the arc tags', () => {
    const pool = [
      { text: 'w', tags: ['wraith'] },
      { text: 'd', tags: ['drift'] },
      { text: 'u' }, // untagged → always eligible
    ];
    const arc = STATE(ARC({ beatTags: { include: ['wraith'] } }));
    seedMathRandom(7);
    const got = Array.from({ length: 40 }, () => pickArc(pool, arc).text);
    expect(got).not.toContain('d');         // drift excluded by include set
    expect(new Set(got)).toEqual(new Set(['w', 'u']));
  });
  it('empty filter result falls back to the full pool (never starves)', () => {
    const pool = [{ text: 'd', tags: ['drift'] }];
    const arc = STATE(ARC({ beatTags: { include: ['wraith'] } }));
    seedMathRandom(1);
    expect(pickArc(pool, arc).text).toBe('d');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/arc.test.ts` → fails (`arc.ts` not found).

- [ ] **Step 3: Implement `src/engine/terminal/arc.ts`:**

```ts
// Arc layer — a thin policy layer over the 5-phase narrative machine. Pure logic (the TS
// twin; the Swift twin in Terminal.swift lands with native 1.3). Arc CONTENT lives in the
// JSON SSOT (story-content.json `arcs`/`endings`). Everything here is INERT when no arc is
// selected: pickArc(pool, undefined) === pick(pool), and the narrative resolves `normal`.
// Design: docs/specs/2026-06-28-slice2-arc-layer-design.md.

import type { Phase } from './narrative';

export type EndingId = 'harmonized' | 'cold-path' | 'karsen' | 'wraith' | 'captured' | 'normal';
export type Stage = 0 | 1 | 2 | 3;

export interface EndingSpec {
  default: EndingId;
  divertOnThreat?: { atStage: 1 | 2 | 3; to: EndingId }[];
}

export interface ArcTemplate {
  id: string;
  weight: number;
  antagonist: string;
  mentor: { name: string; availablePhases: Phase[] } | null;
  phaseRouting?: Partial<Record<Phase, Phase>>;
  durationScale?: Partial<Record<Phase, number>>;
  beatTags: { include?: string[]; exclude?: string[] };
  // Slice 7/8 fields — present for forward-compat, unconsumed in Slice 2:
  scenes?: Partial<Record<Phase, { scene: string; weight: number }[]>>;
  threatCurve?: Partial<Record<Phase, [number, number]>>;
  ending: EndingSpec;
}

export interface ArcState {
  arc: ArcTemplate;
  threatStage: Stage;
  peakStage: Stage;
}

/** Quantize threat (0..1) to a 0–3 stage. calm/reduced-motion forces 0. */
export function quantizeThreat(threat: number, calm: boolean): Stage {
  if (calm) return 0;
  if (threat < 0.15) return 0;
  if (threat < 0.40) return 1;
  if (threat < 0.70) return 2;
  return 3;
}

/** Beat-tag filter. Untagged beats are always eligible; exclude wins over include. */
export function arcAllows(
  beatTags: readonly string[] | undefined,
  arcTags: { include?: string[]; exclude?: string[] },
): boolean {
  if (!beatTags || beatTags.length === 0) return true;
  const { include, exclude } = arcTags;
  if (exclude && exclude.length && beatTags.some((t) => exclude.includes(t))) return false;
  if (include && include.length && !beatTags.some((t) => include.includes(t))) return false;
  return true;
}

/** Uniform pick — the ONE RNG formula the whole narrative shares (twin of native). */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Tag-filtered pick. INERT when arc is undefined: delegates to pick with no extra RNG. */
export function pickArc<T>(pool: readonly T[], arc?: ArcState): T {
  if (!arc) return pick(pool);
  const f = pool.filter((b) => arcAllows((b as { tags?: string[] }).tags, arc.arc.beatTags));
  return pick(f.length ? f : pool);
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/arc.test.ts`.

- [ ] **Step 5: Commit** — `git add src/engine/terminal/arc.ts tests/arc.test.ts && git commit -m "feat(arc): arc types + pickArc/arcAllows (RNG-neutral when inert)"`

---

## Task 2: `selectArc` + `resolveEnding` + `quantizeThreat` tests

**Files:**
- Modify: `src/engine/terminal/arc.ts` (add `selectArc`, `resolveEnding`)
- Test: `tests/arc.test.ts` (append)

**Interfaces:**
- Produces: `selectArc(arcs, completed): ArcTemplate`, `resolveEnding(arc, peakStage): EndingId`, `quantizeThreat(threat, calm): Stage` (already in Task 1).

- [ ] **Step 1: Append failing tests** to `tests/arc.test.ts`:

```ts
import { selectArc, resolveEnding, quantizeThreat } from '../src/engine/terminal/arc';

describe('quantizeThreat', () => {
  it('steps at 0.15 / 0.40 / 0.70', () => {
    expect(quantizeThreat(0.0, false)).toBe(0);
    expect(quantizeThreat(0.14, false)).toBe(0);
    expect(quantizeThreat(0.15, false)).toBe(1);
    expect(quantizeThreat(0.39, false)).toBe(1);
    expect(quantizeThreat(0.40, false)).toBe(2);
    expect(quantizeThreat(0.69, false)).toBe(2);
    expect(quantizeThreat(0.70, false)).toBe(3);
    expect(quantizeThreat(1.0, false)).toBe(3);
  });
  it('calm forces stage 0', () => {
    expect(quantizeThreat(0.99, true)).toBe(0);
  });
});

describe('resolveEnding', () => {
  const arc = ARC({
    ending: { default: 'harmonized', divertOnThreat: [{ atStage: 3, to: 'cold-path' }] },
  });
  it('returns default below the divert stage', () => {
    expect(resolveEnding(arc, 0)).toBe('harmonized');
    expect(resolveEnding(arc, 2)).toBe('harmonized');
  });
  it('diverts at/above the divert stage', () => {
    expect(resolveEnding(arc, 3)).toBe('cold-path');
  });
  it('first matching divert wins; no divert → default', () => {
    const a2 = ARC({ ending: { default: 'wraith' } });
    expect(resolveEnding(a2, 3)).toBe('wraith');
  });
});

describe('selectArc', () => {
  const arcs: ArcTemplate[] = [
    ARC({ id: 'a', weight: 1 }), ARC({ id: 'b', weight: 1 }), ARC({ id: 'c', weight: 1 }),
    ARC({ id: 'd', weight: 1 }),
  ];
  it('never returns an id present in the last-3 completed', () => {
    seedMathRandom(99);
    for (let i = 0; i < 30; i++) {
      const got = selectArc(arcs, ['a', 'b', 'c']);
      expect(got.id).toBe('d');   // only survivor
    }
  });
  it('cold history → weighted over all arcs (deterministic for a fixed seed)', () => {
    seedMathRandom(2025);
    const first = selectArc(arcs, []);
    seedMathRandom(2025);
    expect(selectArc(arcs, []).id).toBe(first.id);  // reproducible
  });
  it('all arcs recently completed → falls back to full set (no starve)', () => {
    seedMathRandom(3);
    const got = selectArc(arcs, ['a', 'b', 'c', 'd']);
    expect(arcs.map((a) => a.id)).toContain(got.id);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/arc.test.ts` (selectArc/resolveEnding undefined).

- [ ] **Step 3: Append to `src/engine/terminal/arc.ts`:**

```ts
/** Weighted arc selection; damp ids in the last-3 completed ring so none repeats within 3. */
export function selectArc(arcs: readonly ArcTemplate[], completed: readonly string[]): ArcTemplate {
  const recent = new Set(completed.slice(-3));
  const survivors = arcs.filter((a) => !recent.has(a.id));
  const pool = survivors.length ? survivors : arcs.slice();
  const total = pool.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * total;
  for (const a of pool) { r -= a.weight; if (r < 0) return a; }
  return pool[pool.length - 1];
}

/** Resolve the ending: first divert whose atStage ≤ peakStage, else default. */
export function resolveEnding(arc: ArcTemplate, peakStage: Stage): EndingId {
  for (const d of arc.ending.divertOnThreat ?? []) {
    if (peakStage >= d.atStage) return d.to;
  }
  return arc.ending.default;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/arc.test.ts`.

- [ ] **Step 5: Commit** — `git add src/engine/terminal/arc.ts tests/arc.test.ts && git commit -m "feat(arc): selectArc + resolveEnding + quantizeThreat (tested)"`

---

## Task 3: JSON content — `endings`, `arcs`, beat `tags` + facade

**Files:**
- Modify: `src/engine/data/story-content.json`, `src/engine/terminal/script-bank.ts`, `tests/script-bank-parity.test.ts`
- Test: `tests/arc-content.test.ts` (new — shape/manifest guard)

- [ ] **Step 1: Edit `story-content.json`.** Remove `beats.farewells` and `beats.lastWords`. Add two new top-level sections. `endings.farewells.normal` / `endings.lastWords.normal` = the exact arrays just removed from `beats`. The other 5 sets are verbatim from the design spec §"Ending content". Add `arcs` = the 5 templates verbatim from the design spec §"The 5 arcs … as ArcTemplate[]". (Copy both blocks from `docs/specs/2026-06-28-slice2-arc-layer-design.md`.)

```jsonc
"endings": {
  "farewells": {
    "normal":     [ /* the 6 strings moved from beats.farewells, verbatim */ ],
    "harmonized": ["> harmonization complete. the strings fold back in.", "> the work is the answer.", "> nothing followed me home tonight.", "> quiet again. the way it should be.", "> [SHIFT CLOSED // NOMINAL]"],
    "cold-path":  ["> you should have used the cold path.", "> channel severed. i'm a ghost now.", "> better cold than traced.", "> they can't read a line that isn't there.", "> [LINK DARK // NO CARRIER]"],
    "karsen":     ["> stay on the line. i've got you. — INSTR-KARSEN", "> module 14. he was right.", "> karsen pulled the plug in time.", "> not alone after all.", "> [GHOSTLINK HELD // OPERATOR RECOVERED]"],
    "wraith":     ["> it answers to my name now.", "> the wraith wears my designation.", "> i was never the operator.", "> whatever types next is not me.", "> [CONTROL TRANSFERRED // SESSION HIJACKED]"],
    "captured":   ["> they came through the door, not the wire.", "> operator did not return from break.", "> [SEAT VACATED // NO SIGNOUT]", "> [SESSION ABANDONED // CHAIR EMPTY]"]
  },
  "lastWords": {
    "normal":     [ /* the lastWords objects moved from beats.lastWords, verbatim */ ],
    "harmonized": [ {"typed":"logging it clean. see you next rota","abandonAt":0}, {"typed":"all folded back. i think we're go","abandonAt":0}, {"typed":"going to sleep well for on","abandonAt":0} ],
    "cold-path":  [ {"typed":"pulling the jack now don't try to recon","abandonAt":0}, {"typed":"going dark. if you're reading this i'm already g","abandonAt":0}, {"typed":"cold path. should have taken it ho","abandonAt":0} ],
    "karsen":     [ {"typed":"karsen are you still th","abandonAt":0}, {"typed":"okay. okay. doing what you sa","abandonAt":0}, {"typed":"tell me it's going to b","abandonAt":0} ],
    "wraith":     [ {"typed":"that's not what i typed who is wri","abandonAt":0}, {"typed":"my hands aren't on the k","abandonAt":0}, {"typed":"it's using my designat","abandonAt":0} ],
    "captured":   [ {"typed":"wait someone's at the do","abandonAt":0}, {"typed":"who are y","abandonAt":0}, {"typed":"no no i didn't","abandonAt":0}, {"typed":"how did you get in h","abandonAt":0} ]
  }
},
"arcs": [ /* the 5 ArcTemplate objects, verbatim from the design spec */ ]
```

- [ ] **Step 2: Add `tags` to a subset of intrusion + routine beats** in `story-content.json` (lean flavour). Concretely: add `"tags"` arrays to entries of `beats.intrusionsQuotes`, `beats.intrusionsFragments`, and a few `beats.routine` beats, using the vocab `drift|trace|injection|wraith` + `calm|aggressive|technical`. Guidance (assign by reading each line's tone):
  - hostile / takeover-flavoured intrusions → `["wraith","aggressive"]`
  - impersonal spec-drift / anomaly lines → `["drift","technical"]` (calmer ones also `"calm"`)
  - tracking / trace lines → `["trace"]`
  - signature / injection ("signed", "module 14") lines → `["injection","technical"]`
  - Leave the majority untagged (universal). Untagged beats stay eligible for every arc.

- [ ] **Step 3: Edit `src/engine/terminal/script-bank.ts`** — re-point farewells/lastWords + add ENDINGS/ARCS + tags on interfaces:

```ts
// add to imports/types
import type { ArcTemplate, EndingId } from './arc';

export interface RoutineBeat {
  cmd: string;
  resp: ReadonlyArray<string | { cat: Cat3; text: string }>;
  tags?: string[];                       // NEW (Slice 2) — arc beat-tag filter
}
export interface IntrusionEvent {
  text: string;
  followup?: string;
  tags?: string[];                       // NEW
}

// re-point the SILENCE pools to the `normal` ending set (values unchanged):
export const FAREWELLS = story.endings.farewells.normal as readonly string[];
export const LAST_WORDS =
  story.endings.lastWords.normal as readonly { typed: string; abandonAt: number }[];

// NEW exports:
export const ENDINGS = story.endings as {
  farewells: Record<EndingId, readonly string[]>;
  lastWords: Record<EndingId, readonly { typed: string; abandonAt: number }[]>;
};
export const ARCS = story.arcs as readonly ArcTemplate[];
```

- [ ] **Step 4: Write the shape guard** `tests/arc-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENDINGS, ARCS } from '../src/engine/terminal/script-bank';

const ENDING_IDS = ['harmonized', 'cold-path', 'karsen', 'wraith', 'captured', 'normal'];

describe('arc content shape', () => {
  it('every EndingId has a farewells and lastWords set', () => {
    for (const id of ENDING_IDS) {
      expect(ENDINGS.farewells[id as keyof typeof ENDINGS.farewells].length).toBeGreaterThan(0);
      expect(ENDINGS.lastWords[id as keyof typeof ENDINGS.lastWords].length).toBeGreaterThan(0);
    }
  });
  it('the 5 selectable arcs are present with valid endings', () => {
    expect(ARCS.map((a) => a.id).sort()).toEqual(
      ['cold-path', 'harmonized', 'karsen', 'normal', 'wraith'],
    );
    for (const a of ARCS) {
      expect(ENDING_IDS).toContain(a.ending.default);
      expect(a.weight).toBeGreaterThan(0);
      for (const d of a.ending.divertOnThreat ?? []) expect(ENDING_IDS).toContain(d.to);
    }
  });
  it('captured is divert-only (not a selectable arc)', () => {
    expect(ARCS.map((a) => a.id)).not.toContain('captured');
  });
});
```

- [ ] **Step 5: Run** `npx vitest run tests/arc-content.test.ts tests/script-bank-parity.test.ts` — Expected: arc-content PASS; `script-bank-parity` **plain-pools test FAILS** (beats gained `tags`). The `routineStream` test stays PASS (tags aren't in cmd/resp text).

- [ ] **Step 6: Re-pin** the plain-pools hash: copy the actual hash from the failure into `tests/script-bank-parity.test.ts` (the `plain pools survive…` expectation). Add a comment noting the re-pin is for the Slice-2 `tags` addition. Run again → PASS. (FAREWELLS/LAST_WORDS values are unchanged, so only the tagged-pool contribution moved.)

- [ ] **Step 7: Run** `npm run typecheck && npm run build` — Expected: PASS (Vite inlines the JSON).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(data): arcs + endings + beat tags in SSOT; facade ENDINGS/ARCS"`

---

## Task 4: `narrative.ts` — inert arc plumbing (no behaviour change when arc undefined)

**Files:**
- Modify: `src/engine/terminal/narrative.ts`

**Interfaces:**
- Consumes: `pick`, `pickArc`, `ArcTemplate`, `ArcState`, `Stage` from `./arc`; `ENDINGS`, `ARCS` from `./script-bank`.
- Produces: `NarrativeRunner` now accepts a 4th ctor arg `arcs: readonly ArcTemplate[] = []`; new public method `updateThreatStage(stage: Stage): void`.

- [ ] **Step 1: Imports + remove local `pick`.** In `narrative.ts`: delete the local `pick` function (lines 535-537). Add `import { pick, pickArc, selectArc, resolveEnding, type ArcState, type ArcTemplate, type Stage } from './arc';` and add `ENDINGS, ARCS` to the existing `./script-bank` import. Remove `FAREWELLS, LAST_WORDS` from that import (now reached via `ENDINGS`).

- [ ] **Step 2: Fields + ctor arg.** Add fields after `usedExchanges` (line 82):

```ts
  /** Selected arc for the current shift (undefined = today's behaviour, inert). */
  private arc: ArcState | undefined;
  /** Recently-selected arc ids (in-memory ring; persistence is Slice 3). */
  private arcsCompleted: string[] = [];
  /** Ending resolved at SILENCE entry; selects the farewells/lastWords set. */
  private endingId: import('./arc').EndingId = 'normal';
```

Change the constructor signature (line 93) to:

```ts
  constructor(public d: NarrativeRunnerDeps, rng: () => number, private durationScale = 1,
              private arcs: readonly ArcTemplate[] = []) {
```

- [ ] **Step 3: `updateThreatStage` + `nextPhaseOf` helpers.** Add public method + private helper (near `currentPhase`):

```ts
  /** Fed each frame by ReactiveWorld; tracks the shift's peak corruption stage. */
  updateThreatStage(stage: Stage): void {
    if (!this.arc) return;
    this.arc.threatStage = stage;
    if (stage > this.arc.peakStage) this.arc.peakStage = stage;
  }

  /** Arc-aware phase routing (falls back to the linear default). */
  private nextPhaseOf(p: Phase): Phase {
    return this.arc?.arc.phaseRouting?.[p] ?? NEXT_PHASE[p];
  }
```

- [ ] **Step 4: Per-phase duration + routing in `enterPhase`/`scheduleTransition`.** In `enterPhase` (line 147), multiply by the arc's per-phase scale:

```ts
    const arcScale = this.arc?.arc.durationScale?.[p] ?? 1;
    this.phaseEndsAt = this.phaseStartedAt + (lo + Math.random() * (hi - lo)) * 1000 * this.durationScale * arcScale;
```

In `scheduleTransition` replace the two `NEXT_PHASE[this.phase]` reads (lines 161, 167, 175) with `this.nextPhaseOf(this.phase)`. (Slice-2 routing is forward-only, so the SILENCE→ROUTINE reset trigger is unchanged.)

- [ ] **Step 5: Sweep `pick(...) → pickArc(..., this.arc)`.** Replace every `pick(` in the beat methods with `pickArc(` adding `, this.arc`. Sites (current line → new call):
  - `:299` `pick(HQ_INBOUND_ROUTINE)` → `pickArc(HQ_INBOUND_ROUTINE, this.arc)`
  - `:302` `pick(HQ_REPLY_ROUTINE)` → `pickArc(HQ_REPLY_ROUTINE, this.arc)`
  - `:308` `pick(ROUTINE_BEATS)` → `pickArc(ROUTINE_BEATS, this.arc)`
  - `:333` `pick([...INTRUSIONS_QUOTES, ...INTRUSIONS_FRAGMENTS])` → `pickArc([...INTRUSIONS_QUOTES, ...INTRUSIONS_FRAGMENTS], this.arc)`
  - `:343` `pick(HESITATIONS)`, `:347` `pick(REACTIONS_FIRST_RESP)`, `:352` `pick(REACTIONS_FIRST)`, `:356` `pick(REACTIONS_FIRST_RESP)`
  - `:377` `pick(HQ_ESCALATION_DRAFTS)`, `:385` `pick(HQ_NON_RESPONSES)`, `:391` `pick(REACTIONS_ALARM)`, `:395` `pick(REACTIONS_ALARM_RESP)`, `:401` `pick(INTRUSIONS_QUOTES)`
  - `:417` `pick(PANIC_DRAFTS)`, `:425` `pick(SYSTEM_FINAL)`, `:429` `pick(REACTIONS_PANIC)`, `:433` `pick(REACTIONS_PANIC_RESP)`, `:441` `pick(INTRUSIONS_QUOTES)`
  - In `beatMentor` (`:258`) the exchange pick uses `Math.floor(Math.random()*pool.length)` directly — leave as is (not a `pick()` call; mentor pool is phase-filtered already).
  - `beatSilence` picks are handled in Task 5.
  (`pickArc(pool, undefined)` is RNG-identical to `pick(pool)` — Task 1 proved it — so with `this.arc` undefined this sweep changes nothing.)

- [ ] **Step 6: Run, expect PASS** — `npm test && npm run typecheck && npm run build`. The existing suite stays green; `arc.test.ts` still green; no behaviour change (arc undefined throughout — selection lands in Task 5). Native untouched.

- [ ] **Step 7: Commit** — `git commit -am "feat(narrative): inert arc plumbing — pickArc sweep, routing/duration hooks, threat stage"`

---

## Task 5: `narrative.ts` — arc activation (selection, mentor gate, ending)

**Files:**
- Modify: `src/engine/terminal/narrative.ts`

- [ ] **Step 1: Mentor-availability gate.** Add helper:

```ts
  private mentorAvailable(phase: Phase): boolean {
    if (!this.arc) return true;                       // no arc → today's behaviour
    const m = this.arc.arc.mentor;
    return !!m && m.availablePhases.includes(phase);
  }
```

Gate each mentor trigger by ANDing it BEFORE the `Math.random()` so the roll is skipped (not consumed) when the mentor is unavailable — preserving today's RNG when arc is undefined (gate is always true → `Math.random()` still rolled):
  - `:293` → `if (this.mentorAvailable('ROUTINE') && Math.random() < 0.12) {`
  - `:327` → `if (this.mentorAvailable('INTRUSION') && Math.random() < 0.22) {`
  - `:370` → `if (this.mentorAvailable('ALARM') && Math.random() < 0.28) {`
  - `:410` → `if (this.mentorAvailable('PANIC') && Math.random() < 0.22) {`

- [ ] **Step 2: Ending resolution at SILENCE entry.** In `enterPhase`, after `this.phase = p;` (line 143), add:

```ts
    if (p === 'SILENCE') {
      this.endingId = this.arc ? resolveEnding(this.arc.arc, this.arc.peakStage) : 'normal';
    }
```

- [ ] **Step 3: Ending-keyed `beatSilence`.** Replace `beatSilence` body to read the resolved set (default to `normal`):

```ts
  private async beatSilence() {
    const farewells = ENDINGS.farewells[this.endingId] ?? ENDINGS.farewells.normal;
    const lastWords = ENDINGS.lastWords[this.endingId] ?? ENDINGS.lastWords.normal;
    if (Math.random() < 0.5) {
      const lw = pick(lastWords);
      await this.typeAtPrompt(lw.typed);
      await this.sleep(3000 + Math.random() * 2000);
    } else {
      const f = pick(farewells);
      await this.d.hud.addLine(f, 'QUOTES');
      await this.sleep(2400 + Math.random() * 1600);
    }
  }
```

(With `endingId='normal'` — the arc-undefined case — this is byte-identical to today: same pools, same RNG.)

- [ ] **Step 4: Arc selection in `silentReset` callback.** Replace the callback (lines 169-172):

```ts
        this.silentReset(() => {
          this.persona = makePersona(Math.random);
          this.refreshPrompt();
          if (this.arcs.length) {
            const tmpl = selectArc(this.arcs, this.arcsCompleted);
            this.arc = { arc: tmpl, threatStage: 0, peakStage: 0 };
            this.arcsCompleted.push(tmpl.id);
            if (this.arcsCompleted.length > 3) this.arcsCompleted.shift();
          }
          this.enterPhase('ROUTINE');
        });
```

(The first shift never reaches this — selection begins from shift 2. When `arcs` is `[]`, this stays inert.)

- [ ] **Step 5: Run, expect PASS** — `npm test && npm run typecheck && npm run build`. All green; native untouched. (No e2e golden — the arc-undefined inertness is proven by Task 1's RNG-neutrality test + these guards; arc-active behaviour is exercised by Task 1/2 unit tests and verified live in Task 7.)

- [ ] **Step 6: Commit** — `git commit -am "feat(narrative): arc selection + mentor gate + ending resolution"`

---

## Task 6: `reactive-world.ts` — feed the threat stage to the runner

**Files:**
- Modify: `src/engine/fx/reactive-world.ts`

- [ ] **Step 1: Import.** Add `import { quantizeThreat } from '../terminal/arc';`

- [ ] **Step 2: Feed the stage.** In `update`, immediately after `const threat = this.threat;` (line 108), add:

```ts
    this.d.narrative?.updateThreatStage(quantizeThreat(threat, calm));
```

(Per-frame, O(1); behaviour-neutral when arc is undefined — `updateThreatStage` early-returns. If ReactiveWorld is disabled the stage stays 0 → only default endings, by design.)

- [ ] **Step 3: Run, expect PASS** — `npm run typecheck && npm run build && npm test`.

- [ ] **Step 4: Commit** — `git commit -am "feat(reactive-world): feed quantized threat stage to narrative"`

---

## Task 7: `controller.ts` — activate arcs + final verification

**Files:**
- Modify: `src/engine/controller.ts`

- [ ] **Step 1: Pass `ARCS`.** Add `import { ARCS } from './terminal/script-bank';` to `controller.ts`. The constructor call (line 296) currently ends `}, mkRng(freshSeed()), opts.storyScale);` — change it to `}, mkRng(freshSeed()), opts.storyScale, ARCS);` (ARCS is the 4th arg; `durationScale` is already passed as `opts.storyScale`).

- [ ] **Step 2: Run the full gate** — `npm test && npm run typecheck && npm run build && bash scripts/run-native-tests.sh` — Expected: all green (native unchanged).

- [ ] **Step 3: Live smoke (visual sanity).** `npm run dev`, open the screensaver, let it run / fast-forward via `?durationScale=` if supported, and confirm: a shift plays, the CRT crash + reset still works, and a *second* shift starts (arc now active) without errors in the console. (Full per-arc visual differentiation is subtle in lean mode; the goal here is "no regression, second shift runs".)

- [ ] **Step 4: Commit** — `git commit -am "feat(controller): activate story arcs in the narrative runner"`

- [ ] **Step 5: Push** — `git push origin feat/story-arcs-corruption`

---

## Self-review (against the spec)

- **Spec coverage:** 5 arcs + captured → Task 3 (`arcs`/`endings`) + Task 5 (selection/resolution). `pickArc`/`arcAllows` → Task 1. `selectArc`/`resolveEnding`/`quantizeThreat` → Task 2. Tag vocab + tagging → Task 3. phaseRouting + per-phase durationScale → Task 4. Mentor override → Task 5. Ending content (6 sets) → Task 3. threat→peakStage plumbing → Task 6. Activation → Task 7. Additive invariant → Task 1 (RNG-neutrality) + inert guards (Task 4/5). Tests subset (§Testing) → Tasks 1–3.
- **Out of scope honoured:** corruption render (Slice 4), `scenes` (7), `threatCurve` (8) — fields present, unconsumed; persistence (3) — ring buffer in-memory; native — deferred with 1.3; false-all-clear backward routing — not used (forward-only).
- **Type consistency:** `EndingId`/`Stage`/`ArcTemplate`/`ArcState` defined in Task 1, consumed identically in Tasks 3–6. `updateThreatStage(stage: Stage)` (Task 4) matches the `quantizeThreat → Stage` caller (Task 6). `pickArc<T>(pool, arc?)` signature stable across Task 1 and the Task-4 sweep. `ENDINGS`/`ARCS` exported (Task 3) and imported (Tasks 4/7) under the same names.
- **No placeholders:** the only "assign by reading" step is the per-beat tag assignment (Task 3 Step 2) — an intentional content-judgement step with an explicit rubric, not a missing implementation; the vocabulary and per-arc include/exclude are fully pinned.
