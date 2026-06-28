# Slice 3 — Story Persistence (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the arc layer's memory across sessions — last-3 arcs (anti-repeat), per-ending counts, and a shift counter — so variety and escalation survive a reload instead of resetting each launch.

**Architecture:** A `story` block beside `stats` in `ScreensaverSettings` (forward-safe via the existing `deepMerge` on load). A pure `applyShiftMemory()` in `arc.ts` computes the next memory at each shift boundary; the `NarrativeRunner` seeds its memory from the host, applies it in `silentReset`, and force-flushes (non-debounced save) before the new shift begins. The web host already persists `ScreensaverSettings` to `localStorage`.

**Tech Stack:** TypeScript/Vite + vitest. Native (Swift `StoryMemory` in `UserDefaults`) is **out of scope** — bundled with native 1.3 later, reusing the same shape.

**Spec:** parent design `docs/specs/2026-06-15-story-arcs-corruption-design.md` §4 (ratified). Builds on Slice 2 (`docs/specs/2026-06-28-slice2-arc-layer-*.md`).

## Global Constraints

- **Additive invariant preserved:** all story persistence is gated behind the existing `if (this.arcs.length)` block in `silentReset` (arcs disabled → no story writes, fully inert). `applyShiftMemory` consumes no `Math.random` → narrative output unchanged for a given seed.
- **Forward/back compatible saves:** old saves without `story` load to the default via `deepMerge` (existing `persistence.ts`); a `schema` field is reserved for future migrations. Never crash on a missing/garbage `story`.
- **Force-flush, not debounce:** the shift-boundary save is the immediate `plugin.saveData(plugin.settings)` (mirrors `controller.ts:266`), NOT the 1500ms `saveSettingsDebounced` — a shift end is rare and must not be lost to a reload.
- **Ring buffer N=3** for `arcsCompleted` (anti-repeat within 3 shifts).
- **Per task:** `npm test` + `npm run typecheck` + `npm run build` green before commit; native untouched (`run-native-tests.sh` stays green).

---

## File structure

**Modify**
- `src/engine/terminal/arc.ts` — add `StoryMemory` type, `freshStoryMemory()`, `applyShiftMemory(story, endingId, newArcId)`.
- `src/engine/data/defaults.ts` — `story: StoryMemory` in `ScreensaverSettings` + default in `DEFAULT_SCREENSAVER`.
- `src/engine/terminal/narrative.ts` — replace the in-memory `arcsCompleted` field with a persisted `story`; seed from deps; apply + force-flush in `silentReset`; add `story?`/`persistStory?` to `NarrativeRunnerDeps`.
- `src/engine/controller.ts` — pass `story` + a `persistStory` callback to the runner.
- `src/host-web/persistence.ts` — `export` `deepMerge` so the forward-compat path is unit-testable.
- `tests/arc.test.ts` — `applyShiftMemory` unit tests.
- `tests/persistence.test.ts` (new) — `deepMerge` forward-compat (old save → default story).

---

## Task 1: `StoryMemory` + `applyShiftMemory` in arc.ts

**Files:**
- Modify: `src/engine/terminal/arc.ts`
- Test: `tests/arc.test.ts` (append)

**Interfaces:**
- Produces: `interface StoryMemory { schema: number; layerCounter: number; arcsCompleted: string[]; endingsReached: Partial<Record<EndingId, number>>; }`, `freshStoryMemory(): StoryMemory`, `applyShiftMemory(story: StoryMemory, endingId: EndingId, newArcId: string): StoryMemory`.

- [ ] **Step 1: Append failing tests** to `tests/arc.test.ts`:

```ts
import { applyShiftMemory, freshStoryMemory } from '../src/engine/terminal/arc';

describe('applyShiftMemory', () => {
  it('increments layerCounter, records the ending, appends the new arc', () => {
    const s0 = freshStoryMemory();
    const s1 = applyShiftMemory(s0, 'normal', 'wraith');
    expect(s1.layerCounter).toBe(1);
    expect(s1.endingsReached.normal).toBe(1);
    expect(s1.arcsCompleted).toEqual(['wraith']);
  });
  it('rings arcsCompleted at the last 3', () => {
    let s = freshStoryMemory();
    for (const id of ['a', 'b', 'c', 'd']) s = applyShiftMemory(s, 'normal', id);
    expect(s.arcsCompleted).toEqual(['b', 'c', 'd']);
    expect(s.layerCounter).toBe(4);
    expect(s.endingsReached.normal).toBe(4);
  });
  it('accumulates distinct ending counts and does not mutate the input', () => {
    const s0 = freshStoryMemory();
    const s1 = applyShiftMemory(s0, 'wraith', 'wraith');
    const s2 = applyShiftMemory(s1, 'wraith', 'karsen');
    expect(s2.endingsReached.wraith).toBe(2);
    expect(s0.layerCounter).toBe(0);          // input untouched (pure)
    expect(s0.arcsCompleted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/arc.test.ts` (applyShiftMemory undefined).

- [ ] **Step 3: Append to `src/engine/terminal/arc.ts`:**

```ts
export interface StoryMemory {
  schema: number;
  layerCounter: number;                       // completed shifts → escalation baseline
  arcsCompleted: string[];                     // ring buffer, last 3 → anti-repeat
  endingsReached: Partial<Record<EndingId, number>>;
}

/** A fresh, empty story memory (schema 1). */
export function freshStoryMemory(): StoryMemory {
  return { schema: 1, layerCounter: 0, arcsCompleted: [], endingsReached: {} };
}

/** Pure shift-boundary update: record the ending just reached + the newly-selected arc. */
export function applyShiftMemory(story: StoryMemory, endingId: EndingId, newArcId: string): StoryMemory {
  return {
    schema: story.schema,
    layerCounter: story.layerCounter + 1,
    arcsCompleted: [...story.arcsCompleted, newArcId].slice(-3),
    endingsReached: { ...story.endingsReached, [endingId]: (story.endingsReached[endingId] ?? 0) + 1 },
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/arc.test.ts`.

- [ ] **Step 5: Commit** — `git add src/engine/terminal/arc.ts tests/arc.test.ts && git commit -m "feat(arc): StoryMemory + applyShiftMemory (pure, tested)"`

---

## Task 2: `story` block in settings + `deepMerge` forward-compat test

**Files:**
- Modify: `src/engine/data/defaults.ts`, `src/host-web/persistence.ts`
- Test: `tests/persistence.test.ts` (new)

**Interfaces:**
- Consumes: `StoryMemory` from `../terminal/arc`.
- Produces: `ScreensaverSettings.story: StoryMemory`; `export function deepMerge`.

- [ ] **Step 1: Add the type import + field to `defaults.ts`.** At the top of `src/engine/data/defaults.ts` add `import type { StoryMemory } from '../terminal/arc';`. In the `ScreensaverSettings` interface, after the `stats: { … };` block (ends line 132), add:

```ts
  story: StoryMemory;
```

- [ ] **Step 2: Add the default.** In `DEFAULT_SCREENSAVER`, after `stats: { totalUptimeMs: 0, scenesLoaded: 0, perScene: {} },` (line 213), add:

```ts
  story: { schema: 1, layerCounter: 0, arcsCompleted: [], endingsReached: {} },
```

- [ ] **Step 3: Export `deepMerge`.** In `src/host-web/persistence.ts` change `function deepMerge` to `export function deepMerge`.

- [ ] **Step 4: Write `tests/persistence.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { deepMerge } from '../src/host-web/persistence';
import { DEFAULT_SCREENSAVER } from '../src/engine/data/defaults';

describe('settings forward-compat (deepMerge)', () => {
  it('an old save without `story` gets the default story', () => {
    const oldSave = { speed: 'fast', stats: { totalUptimeMs: 5 } }; // pre-Slice-3 shape
    const merged = deepMerge(structuredClone(DEFAULT_SCREENSAVER), oldSave);
    expect(merged.story).toEqual({ schema: 1, layerCounter: 0, arcsCompleted: [], endingsReached: {} });
    expect(merged.speed).toBe('fast');                    // user override preserved
    expect(merged.stats.scenesLoaded).toBe(0);            // default kept for unset stat
  });
  it('a saved `story` overrides the default', () => {
    const save = { story: { schema: 1, layerCounter: 9, arcsCompleted: ['wraith'], endingsReached: { wraith: 2 } } };
    const merged = deepMerge(structuredClone(DEFAULT_SCREENSAVER), save);
    expect(merged.story.layerCounter).toBe(9);
    expect(merged.story.arcsCompleted).toEqual(['wraith']);
  });
});
```

- [ ] **Step 5: Run** `npx vitest run tests/persistence.test.ts` — Expected: PASS.

- [ ] **Step 6: Run** `npm run typecheck` — Expected: PASS (every `ScreensaverSettings` literal already gets `story` from `DEFAULT_SCREENSAVER`; the interface field is satisfied by the default. If any other hand-built `ScreensaverSettings` literal exists, typecheck will flag it — add `story` there too).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(data): story persistence block + deepMerge forward-compat test"`

---

## Task 3: Wire persistence into `NarrativeRunner`

**Files:**
- Modify: `src/engine/terminal/narrative.ts`

**Interfaces:**
- Consumes: `StoryMemory`, `freshStoryMemory`, `applyShiftMemory` from `./arc`.
- Produces: `NarrativeRunnerDeps` gains `story?: StoryMemory` and `persistStory?: (story: StoryMemory) => void`.

- [ ] **Step 1: Import.** Add `freshStoryMemory, applyShiftMemory, type StoryMemory` to the existing `./arc` import in `narrative.ts`.

- [ ] **Step 2: Deps.** In `NarrativeRunnerDeps`, after `sceneForeshadow?…`, add:

```ts
  /** Persisted story memory to seed this runner (Slice 3). Omit → fresh. */
  story?: StoryMemory;
  /** Force-flush the updated story memory at each shift boundary (non-debounced). */
  persistStory?: (story: StoryMemory) => void;
```

- [ ] **Step 3: Replace the field.** Remove `private arcsCompleted: string[] = [];` and add (next to the other arc fields):

```ts
  /** Persisted across sessions (Slice 3): ring of recent arcs + ending counts + shift count. */
  private story: StoryMemory;
```

Initialise it in the constructor body (after `this.refreshPrompt();`):

```ts
    this.story = d.story ?? freshStoryMemory();
```

- [ ] **Step 4: Use persisted ring + apply + force-flush.** Replace the Slice-2 selection block in the `silentReset` callback:

```ts
          if (this.arcs.length) {
            const tmpl = selectArc(this.arcs, this.arcsCompleted);
            this.arc = { arc: tmpl, threatStage: 0, peakStage: 0 };
            this.arcsCompleted.push(tmpl.id);
            if (this.arcsCompleted.length > 3) this.arcsCompleted.shift();
          }
```

with:

```ts
          if (this.arcs.length) {
            const tmpl = selectArc(this.arcs, this.story.arcsCompleted);
            this.arc = { arc: tmpl, threatStage: 0, peakStage: 0 };
            // Record the ending just reached + the new arc, then force-flush (rare event).
            this.story = applyShiftMemory(this.story, this.endingId, tmpl.id);
            this.d.persistStory?.(this.story);
          }
```

- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run build` — Expected: all green (no consumer passes `story`/`persistStory` yet → seeds fresh, persists into the void; behaviour unchanged). Native untouched.

- [ ] **Step 6: Commit** — `git commit -am "feat(narrative): seed + force-flush persisted story memory"`

---

## Task 4: Wire the host (controller) + final verification

**Files:**
- Modify: `src/engine/controller.ts`

- [ ] **Step 1: Pass story + persistStory.** In the `new NarrativeRunner({ … })` deps object (around line 295, after `sceneForeshadow:`), add:

```ts
        story: this.s.story,
        persistStory: (story) => { this.s.story = story; void this.plugin.saveData(this.plugin.settings); },
```

(`this.s` is the live `plugin.settings.screensaver` getter — assigning `this.s.story` mutates the persisted object; `plugin.saveData` is the immediate force-flush, mirroring `controller.ts:266`.)

- [ ] **Step 2: Full gate** — `npm test && npm run typecheck && npm run build && bash scripts/run-native-tests.sh` — Expected: all green.

- [ ] **Step 3: Manual persistence smoke (optional, recommend Johannes).** In `npm run dev`, let two shifts complete, reload, and confirm via DevTools that `localStorage['kuro-screensaver:settings']` contains a `story` with non-zero `layerCounter` and a populated `arcsCompleted`. (Long — two shifts — so optional; the logic is unit-covered.)

- [ ] **Step 4: Commit + push** — `git commit -am "feat(controller): persist story memory across sessions" && git push origin feat/story-arcs-corruption`

---

## Self-review (against the spec)

- **Spec §4 coverage:** `story` block w/ `schema`/`layerCounter`/`arcsCompleted`/`endingsReached` → Task 1 (type) + Task 2 (settings). `deepMerge` forward-safe → Task 2 (test). Force-flush ordering (select arc → record ending → immediate save → enterPhase) → Task 3 Step 4 (save happens inside the callback before `this.enterPhase('ROUTINE')` which follows it). Per-device silo → uses the existing localStorage host; native silo is the deferred native task. Quantized stage stored — n/a here (peakStage is in-memory per shift; only the ending *id* + counts persist, which is the §4 shape).
- **Deviation (documented):** the §4 "also force-flush on `narrative.stop()`" is omitted — `story` only mutates at a shift boundary (already force-flushed there), so a mid-shift `stop()` has nothing new to persist. Reserved fields `antagonistHistory`/`mentalStateScore` stay out (inert per §4).
- **Additive invariant:** all writes gated behind `if (this.arcs.length)`; `applyShiftMemory` is pure (no `Math.random`); seeding from `freshStoryMemory()` when absent. Narrative output for a given seed is unchanged.
- **Type consistency:** `StoryMemory`/`freshStoryMemory`/`applyShiftMemory` defined in Task 1, consumed in Tasks 2–4 under the same names; `persistStory: (story: StoryMemory) => void` matches the controller callback; `this.s.story` typed by the Task-2 interface field.
- **No placeholders:** every step has concrete code + commands. Task 2 Step 6 notes the (unlikely) case of another hand-built settings literal needing `story` — handled by typecheck, not left vague.
