# Procedural Itinerary + Narrative Co-Drive Implementation Plan (Brick C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couple scene changes to the narrative phase arc via a seeded FilmDirector, with each upcoming scene foreshadowed in the terminal before the warp — so the film coheres.

**Architecture:** A pure, seeded `FilmDirector.sceneAt(index, phase, prevScene)` picks scenes from a per-phase candidate list (intensity tiers), avoiding immediate repeats. The narrative phase machine fires `onPhaseEnter(phase)` (→ warp to the film's scene) and `onForeshadow(nextPhase)` ~6s early (→ a foreshadow terminal line). A monotonic phase counter makes the foreshadow query and the arrival query return the same scene. The B-era auto-cycle timer is removed; `autoCycle.on` becomes the film-mode gate.

**Tech Stack:** TypeScript + three.js (web); Swift + Metal (native); native assert harness; `npm run typecheck` + `verify-crt`.

**Testing reality:** FilmDirector determinism contracts live in the native assert harness (parity reference); web verified by typecheck + a fast-shift `verify-crt` sequence.

---

## File Structure

**New:** `src/engine/modes/film-director.ts`, `native/macos/KuroNativeSaver/Core/FilmDirector.swift`

**Modified (web):** `terminal/narrative.ts` (phase/foreshadow callbacks), `terminal/script-bank.ts` (`SCENE_FORESHADOW`), `controller.ts` (own FilmDirector, wire callbacks, remove auto-cycle interval).

**Modified (native):** `Core/Terminal.swift` (callbacks), `Core/Script.swift` (`SCENE_FORESHADOW`), `Core/Renderer.swift` (own FilmDirector + phaseCounter, wire callbacks, remove B `sceneAge` auto-cycle), `tests/main.swift`.

---

## PHASE 1 — Web

### Task 1: FilmDirector (web)

**Files:** Create `src/engine/modes/film-director.ts`

- [ ] **Step 1: Write the module**

```ts
// FilmDirector — seeded scene selection for the narrative arc. Pure: a function of
// (seed, monotonic phase index, phase, prevScene). "Fester Bogen, prozedurale Welt":
// the phase decides the intensity tier (candidate list); the index decides which one.
import { mkRng } from '../engine/rng';
import type { SceneId } from '../data/defaults';
import type { Phase } from '../terminal/narrative';

/** Scenes that are real flights (excludes the screen-space 'matrix' fx scene). */
export type FlightSceneId = Exclude<SceneId, 'matrix'>;

const PHASE_CANDIDATES: Record<Phase, FlightSceneId[]> = {
  ROUTINE:   ['terrain', 'city'],
  INTRUSION: ['city', 'rift'],
  ALARM:     ['rift', 'tunnel'],
  PANIC:     ['tunnel', 'void'],
  SILENCE:   ['void'],
};

export class FilmDirector {
  constructor(private seed: number) {}

  /** Deterministic scene for the given monotonic index + phase, avoiding prevScene. */
  sceneAt(index: number, phase: Phase, prevScene: SceneId | null): FlightSceneId {
    const cands = PHASE_CANDIDATES[phase];
    const r = mkRng((this.seed ^ (index * 0x9e3779b1)) >>> 0)();   // deterministic 0..1 per index
    let i = Math.floor(r * cands.length) % cands.length;
    if (cands[i] === prevScene && cands.length > 1) i = (i + 1) % cands.length;
    return cands[i];
  }
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit `git add src/engine/modes/film-director.ts && git commit -m "feat(engine): seeded FilmDirector — phase→scene itinerary grammar"`

---

### Task 2: Foreshadow line pool (web)

**Files:** Modify `src/engine/terminal/script-bank.ts`

- [ ] **Step 1: Add the pool + picker** (append near the other const pools):

```ts
// Foreshadow hints for an upcoming scene, keyed by sceneId. Emitted ~6s before the
// warp so the transition feels motivated. Same lore register as the rest of the bank.
export const SCENE_FORESHADOW: Record<string, string[]> = {
  terrain: ['// dropping to terrain sweep', '// low-altitude recon vector locked'],
  city:    ['// proximity alert: megacity grid ahead', '// approach vector — CHROME district'],
  rift:    ['// fault line detected — descending', '// the floor opens up ahead'],
  tunnel:  ['// hyperdrive spinning up', '// conduit acquired — punch-through in 3'],
  void:    ['// debris field on the scope', '// CORP station wreckage ahead'],
};

/** Deterministic foreshadow line for a scene (index keeps it varied + reproducible). */
export function foreshadowLine(scene: string, index: number): string | null {
  const lines = SCENE_FORESHADOW[scene];
  return lines && lines.length ? lines[index % lines.length] : null;
}
```

- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit.

---

### Task 3: Narrative phase + foreshadow callbacks (web)

**Files:** Modify `src/engine/terminal/narrative.ts`

- [ ] **Step 1: Add a module-level NEXT_PHASE map** (above the class, after PHASE_DURATION):

```ts
const NEXT_PHASE: Record<Phase, Phase> = {
  ROUTINE: 'INTRUSION', INTRUSION: 'ALARM', ALARM: 'PANIC', PANIC: 'SILENCE', SILENCE: 'ROUTINE',
};
```

- [ ] **Step 2: Add deps.** In `NarrativeRunnerDeps`, after `onIntrusion?: () => void;`:

```ts
  /** Fired when a phase begins — the film warps to this phase's scene. */
  onPhaseEnter?: (phase: Phase) => void;
  /** Resolve a foreshadow line for the NEXT phase's scene (null = none). */
  sceneForeshadow?: (nextPhase: Phase) => string | null;
```

- [ ] **Step 3: Fire onPhaseEnter.** In `enterPhase`, after `this.phase = p;`:

```ts
    this.d.onPhaseEnter?.(p);
```

- [ ] **Step 4: Replace `scheduleTransition`** to use NEXT_PHASE and add the foreshadow timer:

```ts
  private scheduleTransition() {
    const wait = Math.max(2000, this.phaseEndsAt - Date.now());
    const gen = this.generation;
    const lead = 6000;
    if (wait > lead + 1500) {                       // foreshadow the upcoming scene
      this.timers.push(window.setTimeout(() => {
        if (!this.alive || this.generation !== gen) return;
        const line = this.d.sceneForeshadow?.(NEXT_PHASE[this.phase]);
        if (line) void this.d.hud.addLine(line, 'HQ');
      }, wait - lead));
    }
    this.timers.push(window.setTimeout(() => {
      if (!this.alive) return;
      if (NEXT_PHASE[this.phase] === 'ROUTINE') {
        this.silentReset(() => {
          this.persona = makePersona(Math.random);
          this.refreshPrompt();
          this.enterPhase('ROUTINE');
        });
      } else {
        this.enterPhase(NEXT_PHASE[this.phase]);
      }
    }, wait));
  }
```

- [ ] **Step 5:** `npm run typecheck` → PASS (verify `hud.addLine` accepts `'HQ'`; if the category enum differs, use the existing system/HQ category name).
- [ ] **Step 6:** Commit.

---

### Task 4: Controller wiring (web)

**Files:** Modify `src/engine/controller.ts`

- [ ] **Step 1: Import.** Add `import { FilmDirector, type FlightSceneId } from './modes/film-director';` and `import { foreshadowLine } from './terminal/script-bank';` (merge if script-bank already imported).

- [ ] **Step 2: Fields.** Near `autoCycleTimer`:

```ts
  private film: FilmDirector | null = null;
  private phaseCounter = 0;
  private currentFilmScene: import('./engine/core').Engine extends never ? never : import('./data/defaults').SceneId | null = null;
```
(If that conditional-import type is awkward, just declare `private currentFilmScene: SceneId | null = null;` — `SceneId` is already imported in this file.)

- [ ] **Step 3: Construct the film + wire callbacks.** In the narrative construction (line ~277), add the two deps and build the film first:

```ts
      this.film = new FilmDirector(this.engine.seed);
      this.narrative = new NarrativeRunner({
        hud: this.hud,
        promptInputEl: this.hud.promptInputEl,
        promptHandleEl: this.hud.promptHandleEl,
        onShiftEnd: (clearScreen) => this.crt?.playCrash(clearScreen) ?? Promise.resolve(),
        onPhaseEnter: (phase) => this.onFilmPhase(phase),
        sceneForeshadow: (nextPhase) => this.foreshadowFor(nextPhase),
      }, mkRng(freshSeed()), opts.storyScale);
      this.narrative.start();
```

- [ ] **Step 4: Add the handlers** (methods on the controller):

```ts
  /** Phase began: warp to the film's scene for this phase (film mode only). */
  private onFilmPhase(phase: import('./terminal/narrative').Phase) {
    if (!this.engine || !this.s.autoCycle?.on) return;     // autoCycle.on = film mode
    if (this.currentFilmScene === null) {                  // first phase: adopt the opened scene, no warp
      this.currentFilmScene = this.engine.currentScene as SceneId;
      this.phaseCounter++;
      return;
    }
    const next = this.film!.sceneAt(this.phaseCounter, phase, this.currentFilmScene);
    if (next !== this.engine.currentScene) this.switchScene(next);
    this.currentFilmScene = next;
    this.phaseCounter++;
  }

  /** Foreshadow line for the upcoming phase's scene (matches the arrival query). */
  private foreshadowFor(nextPhase: import('./terminal/narrative').Phase): string | null {
    if (!this.engine || !this.s.autoCycle?.on) return null;
    const sc = this.film!.sceneAt(this.phaseCounter, nextPhase, this.currentFilmScene);
    return foreshadowLine(sc, this.phaseCounter);
  }
```

- [ ] **Step 5: Remove the auto-cycle interval.** Replace the block (line ~302-304):

```ts
    // Auto-cycle
    if (s.autoCycle.on && !this.state.embed) {
      this.autoCycleTimer = window.setInterval(() => this.cycleScene(), s.autoCycle.intervalMin * 60_000);
    }
```
with:
```ts
    // Scene changes are now phase-driven (Brick C): the FilmDirector warps at each
    // narrative phase boundary when autoCycle.on (= film mode). No interval timer.
```

- [ ] **Step 6:** `npm run typecheck` → PASS.
- [ ] **Step 7: Visual check.** `npm run dev`; load `screensaver.html?scene=terrain&preset=phosphor&storyScale=0.06` (fast shift) and watch: a foreshadow HQ line, then a warp to the next phase's scene, repeating across phases. Screenshot a couple of beats.
- [ ] **Step 8:** Commit `git add src/engine/controller.ts && git commit -m "feat(engine): phase-driven film itinerary + foreshadowing (web)"`

---

## PHASE 2 — Native parity

### Task 5: FilmDirector.swift + Script foreshadow pool

**Files:** Create `Core/FilmDirector.swift`; modify `Core/Script.swift`

- [ ] **Step 1:** Mirror `film-director.ts`: `PHASE_CANDIDATES: [ShiftPhase: [String]]`, `final class FilmDirector { init(seed: Int32); func sceneAt(_ index: Int, phase: ShiftPhase, prev: String?) -> String }` using `LCG(seed: seed ^ Int32(truncatingIfNeeded: index &* 0x9e3779b1)).next()` for the deterministic pick + the no-repeat rule.
- [ ] **Step 2:** Add `SCENE_FORESHADOW: [String: [String]]` + `foreshadowLine(_ scene:, _ index:) -> String?` to `Script.swift` (same lines as web).
- [ ] **Step 3:** Build → compiles. Commit.

### Task 6: Terminal callbacks + Renderer wiring

**Files:** Modify `Core/Terminal.swift`, `Core/Renderer.swift`

- [ ] **Step 1 (Terminal.swift):** Add `var onPhaseEnter: ((ShiftPhase) -> Void)?` and `var sceneForeshadow: ((ShiftPhase) -> String?)?`. Fire `onPhaseEnter?(p)` inside `enterPhase(_ p:, t:)`. Add a `nextPhase(_:)` map. In `update(t:)`, before advancing, when `phaseEndsAt > 0 && t >= phaseEndsAt - 6 && !foreshadowed`, set `foreshadowed = true` and if `let line = sceneForeshadow?(nextPhase(phase))` push it as an HQ line into the output (mirror how beats add lines); reset `foreshadowed = false` in `enterPhase`.
- [ ] **Step 2 (Renderer.swift):** Own `film = FilmDirector(seed: settings.seed ?? freshSeed())`, `phaseCounter = 0`, `currentFilmScene: String? = nil`. Wire `hud.terminal.onPhaseEnter` (mirror `onFilmPhase`: first phase adopts `SceneRegistry.ids[sceneIndex]`, else `beginTransition(profileFor(cur,next)) { self.pulse(.warp); self.swapSceneTo(next) }`) and `hud.terminal.sceneForeshadow`. Gate on a film-mode flag (native has no `autoCycle.on`; use `autoCycleSec > 0` as the film-mode gate). Add a `swapSceneTo(_ id:)` that sets `sceneIndex` to that id's index and rebuilds (generalize the existing `swapScene`). **Remove** the Brick-B `sceneAge` auto-cycle block (the warp is now phase-driven).
- [ ] **Step 3:** Build + tests → PASS. Commit.

---

## PHASE 3 — Tests + verification

### Task 7: Native FilmDirector logic tests

**Files:** Modify `tests/main.swift`

- [ ] **Step 1:** Add before the failures check:

```swift
// --- FilmDirector: deterministic, tier-matched, no immediate repeat ---------------
do {
    let f = FilmDirector(seed: 99)
    let cands: [ShiftPhase: [String]] = [
        .routine: ["terrain","city"], .intrusion: ["city","rift"], .alarm: ["rift","tunnel"],
        .panic: ["tunnel","void"], .silence: ["void"]]
    // determinism: same seed+index+phase ⇒ same scene
    let a = f.sceneAt(3, phase: .alarm, prev: nil)
    let b = FilmDirector(seed: 99).sceneAt(3, phase: .alarm, prev: nil)
    check(a == b, "FilmDirector deterministic")
    // tier match
    check(cands[.alarm]!.contains(a), "alarm pick in candidates")
    // no immediate repeat (when an alternative exists)
    let prev = f.sceneAt(5, phase: .intrusion, prev: nil)
    let nextPick = f.sceneAt(5, phase: .intrusion, prev: prev)
    check(nextPick != prev, "no immediate repeat when alt exists")
}
```

- [ ] **Step 2:** `bash scripts/run-native-tests.sh` → all `ok`. Commit.

### Task 8: Final verification + wrap

- [ ] `npm run typecheck` → PASS · `bash scripts/run-native-tests.sh` → PASS · app compile → exit 0 · `! grep -rn "from 'obsidian'" src/engine/` → clean.
- [ ] `verify-crt` fast-shift sequence shows foreshadow→warp→new scene across phases.
- [ ] Update the spec status to implemented; note the `phaseCounter` (vs `shiftIndex`) refinement. Report to the user (no push).

---

## Self-Review

- **Spec coverage:** FilmDirector grammar ✓ (T1/T5), phase-synced warps ✓ (T3/T4/T6), foreshadowing ✓ (T2/T3/T4/T5/T6), autoCycle.on = film mode + interval removed ✓ (T4/T6), determinism ✓ (T1/T7), parity ✓ (Phase 2). **Refinement vs spec:** uses a monotonic `phaseCounter` instead of `(shiftIndex, phase)` — strictly cleaner (foreshadow query == arrival query with no shift bookkeeping); same determinism guarantee.
- **Placeholders:** the `currentFilmScene` type note offers a concrete simple form (`SceneId | null`); `hud.addLine` category flagged with a fallback. No TODOs.
- **Type consistency:** `FilmDirector.sceneAt(index, phase, prevScene)`, `FlightSceneId`, `foreshadowLine(scene, index)`, deps `onPhaseEnter`/`sceneForeshadow`, `NEXT_PHASE`, `phaseCounter`/`currentFilmScene` — consistent web↔native.
```
