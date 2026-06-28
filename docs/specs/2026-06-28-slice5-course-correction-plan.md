# Slice 5 — ←/→ course-correction chatter + CHATTER→SSOT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user-initiated scene change (←/→ or 1-9) emits a `sceneChange` bus event that fires phase-aware, calm-gated, cooldown'd operator chatter — and the existing CHATTER bank moves into the JSON SSOT (byte-true) on the way.

**Architecture:** Web reads chatter from `story-content.json` via a facade (like `presets.ts`); the risky runtime logic (calm gate + 1.2 s cooldown + phase-key + base fallback) lives in a new stateful, node-pure `ChatterDirector.fireSceneChange()` so it is unit-testable without a DOM. The controller is thin wiring: bind ←/→, gate the emit to user-initiated scene changes only, route `sceneChange` to `fireSceneChange`. The native Swift twin mirrors all of it by hand.

**Tech Stack:** TypeScript/Vite (web), Vitest (`environment: 'node'`), Swift/Metal (macOS native).

## Global Constraints

- **Spec scope is chatter-only.** ←/→ must NOT touch arc selection, `threat`, `peakStage`, endings, or persisted `StoryMemory`. No `recklessness` machinery.
- **Emit only on user-initiated scene changes.** Automatic film-mode phase warps and the startup transition must NOT emit `sceneChange` (protects the fixed-seed narrative stream / native golden).
- **←/→ binding must `preventDefault()` + `stopPropagation()` + `return true`** or the key closes the saver.
- **Byte-true move:** the FNV-1a guard hash is pinned from the *pre-move* literal (`3913490057233810303n`) and hashes only the 7 migrated pools; never re-derive it from the migrated value.
- **Calm gate is explicit:** `sceneChange` chatter is suppressed entirely under `prefers-reduced-motion` — not via a threat threshold.
- **`dir`:** left = −1, right = +1, direct-pick = 0. Carried on the event; does NOT change content this slice. Sign convention identical in both twins.
- **Native parity is hand-mirrored** (no automated cross-language guard until Slice 1.3). Add the `sceneChange:*` pools identically in `chatter-bank` (via JSON) and `Chatter.swift`.
- **Bus type path:** `src/engine/events/bus.ts` (NOT `core/bus.ts`).
- Verify gates after each task where noted: `npm test`, `npm run typecheck`, `npm run build`; native: `bash scripts/run-native-tests.sh`.

---

### Task 1: Migrate CHATTER into the JSON SSOT (byte-true) + move-fidelity guard

**Files:**
- Create: `tests/chatter-parity.test.ts`
- Modify: `src/engine/data/story-content.json` (add top-level `chatter` object)
- Modify: `src/engine/terminal/chatter-bank.ts` (literal → facade)

**Interfaces:**
- Consumes: `story-content.json` import (existing pattern from `presets.ts`).
- Produces: `CHATTER: Record<string, ChatterLine[][]>` (unchanged export shape) now sourced from `story.chatter`; `ChatterLine` interface unchanged.

- [ ] **Step 1: Write the move-fidelity guard (pins the pre-move hash over the 7 migrated pools)**

Create `tests/chatter-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHATTER } from '../src/engine/terminal/chatter-bank';

// Byte-true-move guard for the CHATTER → story-content.json migration (Slice 5),
// same method as tests/dict-presets-parity.test.ts. The pinned hash was captured from
// the PRE-migration chatter-bank.ts literal and covers ONLY the 7 pools that existed
// then — so later additive content (the sceneChange:* pools) never disturbs this proof.
// Web-internal move fidelity only; web↔native chatter parity is Slice 1.3's job.
function fnv1a(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const enc = new TextEncoder().encode(s);
  for (const b of enc) { h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}

const MIGRATED_KEYS = [
  'incomingFire', 'unitArrive', 'unitCrash',
  'phase:INTRUSION', 'phase:ALARM', 'phase:PANIC', 'phase:SILENCE',
] as const;

describe('CHATTER SSOT migration parity', () => {
  it('the 7 pre-migration pools survive the move into story-content.json unchanged', () => {
    const migrated = Object.fromEntries(MIGRATED_KEYS.map((k) => [k, CHATTER[k]]));
    expect(fnv1a(JSON.stringify(migrated))).toBe(3913490057233810303n);
  });
});
```

- [ ] **Step 2: Run the guard against the current literal — it must PASS**

Run: `npx vitest run tests/chatter-parity.test.ts`
Expected: PASS (the pin matches the current literal — this validates the pin before the move).

- [ ] **Step 3: Add the `chatter` section to `story-content.json`**

Add a new top-level key `"chatter"` (placement anywhere among the top-level keys; after `"arcs"` is fine). The object's keys MUST be in this exact order and each line object's keys MUST be `speaker, category, text` in that order (so the facade's `JSON.stringify` is byte-identical to the old literal):

```json
  "chatter": {
    "incomingFire": [
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "EVASIVE — ROUNDS INBOUND" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "reacquired. hold still." }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "CONTACT — WEAPONS HOT" },
       { "speaker": "UNIT-A", "category": "HQ", "text": "BREAKING — STAY ON MY WING" }],
      [{ "speaker": "WRAITH", "category": "GHOSTLINK", "text": "i see every move before you make it." },
       { "speaker": "UNIT-A", "category": "HQ", "text": "JINK! GET OFF THE LINE!" }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "TRACERS — HIGH AND RIGHT" },
       { "speaker": "RADIO", "category": "HQ", "text": "HOLD COURSE. RELIEF IS CLOSE." }]
    ],
    "unitArrive": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "CORP-7 ON STATION — FORMING UP" },
       { "speaker": "UNIT-A", "category": "HQ", "text": "EYES ON. WE HAVE YOUR SIX." }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "INBOUND TO ASSIST — TEN SECONDS" },
       { "speaker": "RADIO", "category": "HQ", "text": "RELIEF FLIGHT CLEARED HOT" }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "REINFORCEMENT VECTOR CONFIRMED" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "more of you. it changes nothing." }]
    ],
    "unitCrash": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "UNIT DOWN — TRANSPONDER DARK" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "one less." }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "MAYDAY — I'M HIT, GOING IN—" },
       { "speaker": "RADIO", "category": "HQ", "text": "BEACON LOGGED. KEEP MOVING." }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "LOST CORP-7. NO CHUTE." },
       { "speaker": "UNIT-A", "category": "HQ", "text": "damn it. press on." }]
    ],
    "phase:INTRUSION": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "ANOMALY ON THE NET — STAND BY" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "knock knock." }]
    ],
    "phase:ALARM": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "NET-WIDE ALERT — HOSTILE SIGNATURE" },
       { "speaker": "UNIT-A", "category": "HQ", "text": "WEAPONS FREE. WATCH THE FLANKS." }],
      [{ "speaker": "WRAITH", "category": "GHOSTLINK", "text": "i'm already inside." },
       { "speaker": "RADIO", "category": "HQ", "text": "LOCK DOWN SECONDARY CHANNELS" }]
    ],
    "phase:PANIC": [
      [{ "speaker": "WRAITH", "category": "GHOSTLINK", "text": "your net is mine now." },
       { "speaker": "RADIO", "category": "HQ", "text": "CHANNELS COMPROMISED — GO DARK" }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "I CAN'T RAISE COMMAND—" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "no one is coming." }]
    ],
    "phase:SILENCE": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "...is anyone still receiving?" }]
    ]
  }
```

(Mind the trailing comma rules: if `chatter` is not the last top-level key, end its closing `}` with a comma.)

- [ ] **Step 4: Convert `chatter-bank.ts` to a facade**

Replace the literal in `src/engine/terminal/chatter-bank.ts` (keep the header comment + `ChatterLine` interface; replace the `export const CHATTER = { … }` literal). New body from the interface down:

```ts
import type { LineCategory } from '../data/dictionary';
import story from '../data/story-content.json';

export interface ChatterLine {
  /** callsign rendered as "[SPEAKER] " (overrides the category prefix). */
  speaker: string;
  /** colour register — HQ for friendly net, GHOSTLINK for the hostile/compromised voice. */
  category: LineCategory;
  text: string;
}

// FACADE over the shared content SSOT (story-content.json). The literal pools moved into
// the JSON in Slice 5 (byte-true, guarded by tests/chatter-parity.test.ts); the native
// twin (Chatter.swift) stays hand-mirrored until Slice 1.3's Codable bundle path.
/** key → list of exchanges; each exchange is an ordered set of speaker turns. */
export const CHATTER = (story as { chatter: Record<string, ChatterLine[][]> }).chatter;
```

Note: the original `import type { LineCategory }` line and the doc comment above `CHATTER` are preserved; only the data literal is replaced by the JSON read.

- [ ] **Step 5: Run typecheck + the guard + full suite — all must PASS (proves byte-true move)**

Run: `npm run typecheck && npx vitest run tests/chatter-parity.test.ts && npm test`
Expected: typecheck clean; the guard still `3913490057233810303n` (byte-identical move proven); all existing tests green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/data/story-content.json src/engine/terminal/chatter-bank.ts tests/chatter-parity.test.ts
git commit -m "refactor(data): CHATTER → story-content.json SSOT (byte-true, hash-guarded)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: sceneChange content + `ChatterDirector.fireSceneChange` (web, node-pure tested)

**Files:**
- Modify: `src/engine/data/story-content.json` (add `sceneChange` + `sceneChange:<PHASE>` pools to the `chatter` object)
- Modify: `src/engine/modes/chatter-director.ts` (add `has`, `fireSceneChange`, `lastSceneChange`)
- Create: `tests/scene-chatter.test.ts`

**Interfaces:**
- Consumes: `CHATTER` facade (Task 1); `mkRng` (existing).
- Produces:
  - `ChatterDirector.has(key: string): boolean`
  - `ChatterDirector.fireSceneChange(phase: string, calm: boolean, now: number, cooldownMs?: number): boolean` — returns `true` iff it fired chatter. Default `cooldownMs = 1200`. Phase-keyed (`sceneChange:<PHASE>`), falls back to base `sceneChange`, suppressed when `calm`, throttled by `cooldownMs` against the previous successful call's `now`.

- [ ] **Step 1: Write the failing tests**

Create `tests/scene-chatter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CHATTER, type ChatterLine } from '../src/engine/terminal/chatter-bank';
import { ChatterDirector } from '../src/engine/modes/chatter-director';

const PHASES = ['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE'] as const;

function makeDirector() {
  const lines: { text: string; cat: string; speaker?: string }[] = [];
  const hud = { addLine: (text: string, cat: string, speaker?: string) => { lines.push({ text, cat, speaker }); } };
  // seed is arbitrary; chatter selection is seeded + deterministic.
  return { dir: new ChatterDirector(12345, hud as any), lines };
}

describe('sceneChange chatter content', () => {
  it('has a base sceneChange pool and one per phase, all non-empty + well-formed', () => {
    const keys = ['sceneChange', ...PHASES.map((p) => `sceneChange:${p}`)];
    for (const key of keys) {
      const pool = CHATTER[key];
      expect(pool, `missing pool ${key}`).toBeTruthy();
      expect(pool.length, `empty pool ${key}`).toBeGreaterThan(0);
      for (const exchange of pool) {
        expect(exchange.length).toBeGreaterThan(0);
        for (const line of exchange as ChatterLine[]) {
          expect(typeof line.speaker).toBe('string');
          expect(line.category === 'HQ' || line.category === 'GHOSTLINK').toBe(true);
          expect(line.text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('ChatterDirector.has', () => {
  it('reports presence of a non-empty pool', () => {
    const { dir } = makeDirector();
    expect(dir.has('sceneChange:PANIC')).toBe(true);
    expect(dir.has('sceneChange:NOPE')).toBe(false);
  });
});

describe('ChatterDirector.fireSceneChange', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires a non-empty line for the phase-keyed pool', () => {
    const { dir, lines } = makeDirector();
    expect(dir.fireSceneChange('PANIC', false, 0)).toBe(true);
    vi.advanceTimersByTime(2000); // flush the staggered turns
    expect(lines.length).toBeGreaterThan(0);
  });

  it('is suppressed under calm (reduced-motion)', () => {
    const { dir, lines } = makeDirector();
    expect(dir.fireSceneChange('PANIC', true, 0)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(lines.length).toBe(0);
  });

  it('throttles within the cooldown and allows after it', () => {
    const { dir } = makeDirector();
    expect(dir.fireSceneChange('ROUTINE', false, 1000)).toBe(true);
    expect(dir.fireSceneChange('ROUTINE', false, 1500)).toBe(false); // 500ms < 1200ms
    expect(dir.fireSceneChange('ROUTINE', false, 2300)).toBe(true);  // 1300ms ≥ 1200ms
  });

  it('falls back to the base pool when the phase key is absent', () => {
    const { dir, lines } = makeDirector();
    // 'WEIRD' has no sceneChange:WEIRD pool → fires base 'sceneChange'
    expect(dir.fireSceneChange('WEIRD', false, 0)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests — they must FAIL**

Run: `npx vitest run tests/scene-chatter.test.ts`
Expected: FAIL — `fireSceneChange`/`has` are not functions, and the `sceneChange*` pools do not exist yet.

- [ ] **Step 3: Add the sceneChange content to `story-content.json`**

Inside the `chatter` object (append after `"phase:SILENCE"`, adding a comma after the `phase:SILENCE` array):

```json
    "phase:SILENCE": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "...is anyone still receiving?" }]
    ],
    "sceneChange": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "VECTOR CHANGE LOGGED — ADJUSTING FEED" }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "NEW HEADING ACKNOWLEDGED" }]
    ],
    "sceneChange:ROUTINE": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "COURSE CORRECTION NOTED — ALL NOMINAL" },
       { "speaker": "UNIT-A", "category": "HQ", "text": "EYES ADJUSTING. STEADY." }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "REROUTING OPTICS — STAND BY" }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "FOLLOWING YOUR LEAD." }]
    ],
    "sceneChange:INTRUSION": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "VECTOR SHIFT MID-ANOMALY — CONFIRM INTENT" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "running already?" }],
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "CHANGING LOOK ANGLE — KEEP IT TIGHT" }]
    ],
    "sceneChange:ALARM": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "MANUAL OVERRIDE DURING ALERT — RISKY" },
       { "speaker": "UNIT-A", "category": "HQ", "text": "WHATEVER YOU'RE DOING, DO IT FAST" }],
      [{ "speaker": "WRAITH", "category": "GHOSTLINK", "text": "you can't steer away from me." }]
    ],
    "sceneChange:PANIC": [
      [{ "speaker": "UNIT-A", "category": "HQ", "text": "NO TIME FOR THIS — HOLD SOMETHING" },
       { "speaker": "WRAITH", "category": "GHOSTLINK", "text": "twist all you like." }],
      [{ "speaker": "RADIO", "category": "HQ", "text": "FEED UNSTABLE — CAN'T TRACK THE SWITCH" }]
    ],
    "sceneChange:SILENCE": [
      [{ "speaker": "RADIO", "category": "HQ", "text": "...still steering. someone's still there." }],
      [{ "speaker": "WRAITH", "category": "GHOSTLINK", "text": "...why bother." }]
    ]
```

(Ensure the final pool — `sceneChange:SILENCE` — has NO trailing comma before the `chatter` object's closing `}`.)

- [ ] **Step 4: Add `has` + `fireSceneChange` + `lastSceneChange` to `ChatterDirector`**

In `src/engine/modes/chatter-director.ts`, add a field and two methods to the class (after the existing `fire` method):

```ts
  private lastSceneChange = Number.NEGATIVE_INFINITY;

  /** True if a non-empty pool exists for `key`. */
  has(key: string): boolean {
    const pool = CHATTER[key];
    return !!pool && pool.length > 0;
  }

  /**
   * Course-correction chatter for a user-initiated scene change. Phase-keyed
   * (`sceneChange:<PHASE>`, falling back to the base `sceneChange` pool), suppressed
   * under reduced-motion (`calm`), and throttled to one firing per `cooldownMs`.
   * `now` is a monotonic millisecond timestamp supplied by the caller. Returns whether
   * it fired (so callers/tests can assert).
   */
  fireSceneChange(phase: string, calm: boolean, now: number, cooldownMs = 1200): boolean {
    if (calm) return false;
    if (now - this.lastSceneChange < cooldownMs) return false;
    this.lastSceneChange = now;
    const phaseKey = `sceneChange:${phase}`;
    this.fire(this.has(phaseKey) ? phaseKey : 'sceneChange');
    return true;
  }
```

- [ ] **Step 5: Run the tests — they must PASS; then the full gate**

Run: `npx vitest run tests/scene-chatter.test.ts && npm test && npm run typecheck`
Expected: all green (chatter-parity guard still `3913490057233810303n` — sceneChange additions don't disturb the migrated-pools subset).

- [ ] **Step 6: Commit**

```bash
git add src/engine/data/story-content.json src/engine/modes/chatter-director.ts tests/scene-chatter.test.ts
git commit -m "feat(chatter): phase-keyed sceneChange pools + fireSceneChange (calm-gated, cooldown)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Web wiring — bus kind, user-gated emit, ←/→ binding, route to chatter

**Files:**
- Modify: `src/engine/events/bus.ts` (add `'sceneChange'` kind)
- Modify: `src/engine/controller.ts` (currentPhase, switchScene opts+emit, cycleScene dir, 1-9 emit, arrow binding, subscriber branch)

**Interfaces:**
- Consumes: `FlightEvent { kind, dir? }` (existing); `ChatterDirector.fireSceneChange` (Task 2); `Phase` type (existing import from `narrative`).
- Produces: `controller.switchScene(id: SceneId, opts?: { user?: boolean; dir?: number })`; `controller.cycleScene(dir?: number)`.

- [ ] **Step 1: Add the `sceneChange` event kind**

In `src/engine/events/bus.ts`, extend the union (after `'unitCrash'`):

```ts
export type FlightEventKind =
  | 'intrusion'    // the operator "notices" — migrated from narrative.onIntrusion
  | 'manoeuvre'    // a director manoeuvre fired (for narrative/world to react to, later)
  | 'incomingFire' // antagonist fired a tracer at the camera (Brick D)
  | 'unitArrive'   // a CORP support unit arrived
  | 'unitCrash'    // a support unit went down
  | 'sceneChange'; // Slice 5: a user-initiated scene change (←/→ or 1-9) — dir: -1|0|+1
```

(`FlightEvent.dir?` already exists — no interface change.)

- [ ] **Step 2: Track the current phase in the controller**

In `src/engine/controller.ts`, add a field next to `private phaseCounter = 0;` (line ~58):

```ts
  private currentPhase: Phase = 'ROUTINE';
```

Then in the `onPhaseEnter` callback (line ~294) record it before firing phase chatter:

```ts
        onPhaseEnter: (phase) => { this.currentPhase = phase; this.chatter?.fire(`phase:${phase}`); this.onFilmPhase(phase); },
```

- [ ] **Step 3: Gate the emit to user-initiated scene changes in `switchScene`**

Change the `switchScene` signature + add the emit at the top (after the engine/hud guard, line ~808):

```ts
  switchScene(id: SceneId, opts?: { user?: boolean; dir?: number }) {
    if (!this.engine || !this.hud) return;
    if (opts?.user) this.engine.bus.emit({ kind: 'sceneChange', dir: opts.dir ?? 0 });
    this.audio?.sceneSwitch();
```

(The rest of `switchScene` is unchanged. Automatic callers — `onFilmPhase`'s `this.switchScene(next)` at line ~843 and `main.ts`'s `controller.switchScene(transTo)` — pass no `opts`, so they never emit.)

- [ ] **Step 4: Give `cycleScene` a direction and mark its calls user-initiated**

Change `cycleScene()` (line ~855) to take a direction and thread it through; replace the `idx`/`next` computation and the final `switchScene` call:

```ts
  cycleScene(dir: number = 1) {
    if (!this.engine) return;
    if (this.engine.director.inTransition) return;   // don't stack transitions
    const step = dir < 0 ? -1 : 1;
    const cur = this.engine.currentScene;
    const idx = ALL_SCENES.indexOf(cur as any);
    const n = ALL_SCENES.length;
    const next = ALL_SCENES[((idx + step) % n + n) % n];

    if (this.s.autoCycle?.on) {
      const ASPECT_PRESETS = ['phosphor', 'spectre', 'crimson', 'ember'] as const;
      const curIdx = ASPECT_PRESETS.indexOf(this.s.colorPreset as any);
      const base = curIdx >= 0 ? curIdx : 0;
      const m = ASPECT_PRESETS.length;
      const nextPreset = ASPECT_PRESETS[((base + step) % m + m) % m];
      this.s.aspectPaletteMode = 'inherit';
      this.s.colorMode = 'kuro-preset';
      this.s.colorPreset = nextPreset;
      const newColor = resolveColor(this.effectiveSettings());
      this.engine?.setColor(newColor);
      this.hud?.applyColor(newColor);
    }

    this.switchScene(next, { user: true, dir: step });
  }
```

- [ ] **Step 5: Mark the 1-9 scene-pick as user-initiated**

In `handleLiveHotkey`, the `1-9` block (line ~771), pass the user flag:

```ts
        this.switchScene(SCENES[idx], { user: true, dir: 0 });
```

- [ ] **Step 6: Bind ←/→ in `handleLiveHotkey`**

Add this block inside `handleLiveHotkey` (e.g. right after the `1-9` block, before the `m`/`M` block):

```ts
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      this.cycleScene(k === 'ArrowLeft' ? -1 : 1);
      return true;
    }
```

- [ ] **Step 7: Route `sceneChange` to phase-keyed chatter in the bus subscriber**

In the `this.engine.bus.subscribe('*', …)` handler (lines ~321-331), add a `sceneChange` branch (the closure already captures `reduceMotion`):

```ts
        if (e.kind === 'sceneChange') {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          this.chatter?.fireSceneChange(this.currentPhase, reduceMotion, now);
        }
```

- [ ] **Step 8: Verify — typecheck, build, full suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: typecheck clean; build succeeds; all tests green (including both new test files and the unchanged parity guard). No DOM/keydown test here — the gated-emit is structural, and the chatter logic is covered by Task 2's unit tests.

- [ ] **Step 9: Commit**

```bash
git add src/engine/events/bus.ts src/engine/controller.ts
git commit -m "feat(controller): ←/→ course-correction → user-gated sceneChange chatter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Native Swift twin (additive — emit + subscriber + pools)

**Files:**
- Modify: `native/macos/KuroNativeSaver/Core/EventBus.swift` (`.sceneChange` case + 6th bucket)
- Modify: `native/macos/KuroNativeSaver/Core/Chatter.swift` (`sceneChange:*` pools + `has` + `fireSceneChange` + `lastSceneChange`)
- Modify: `native/macos/KuroNativeSaver/Core/Renderer.swift` (emit in `cycleScene`; subscribe + `onSceneChange`)

**Interfaces:**
- Consumes: `Chatter.pools` (Swift dict), `LCG`, `Terminal.currentPhase`, `phaseKey(_:)`, `settings.reducedMotion`, `t` (seconds), `bus`.
- Produces: native `FlightEventKind.sceneChange`; `ChatterDirector.fireSceneChange(phase:calm:t:cooldown:)`; `Renderer.onSceneChange()`.
- Keys/texts MUST match the web `sceneChange:*` pools byte-for-byte (hand-mirror; no automated guard until Slice 1.3).

- [ ] **Step 1: Add the native event kind + bucket**

In `EventBus.swift`, extend the enum (line 6) and add a 6th handler bucket (line 18):

```swift
enum FlightEventKind: Int { case intrusion = 0, manoeuvre = 1, incomingFire = 2, unitArrive = 3, unitCrash = 4, sceneChange = 5 }
```
```swift
    private var buckets: [[(FlightEvent) -> Void]] = [[], [], [], [], [], []]
```

- [ ] **Step 2: Mirror the sceneChange pools + add `has`/`fireSceneChange` in `Chatter.swift`**

In `Chatter.swift`, append these entries inside `Chatter.pools` (after `"phase:SILENCE"`, with a comma after it):

```swift
        "sceneChange": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "VECTOR CHANGE LOGGED — ADJUSTING FEED")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "NEW HEADING ACKNOWLEDGED")],
        ],
        "sceneChange:ROUTINE": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "COURSE CORRECTION NOTED — ALL NOMINAL"),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "EYES ADJUSTING. STEADY.")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "REROUTING OPTICS — STAND BY")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "FOLLOWING YOUR LEAD.")],
        ],
        "sceneChange:INTRUSION": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "VECTOR SHIFT MID-ANOMALY — CONFIRM INTENT"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "running already?")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "CHANGING LOOK ANGLE — KEEP IT TIGHT")],
        ],
        "sceneChange:ALARM": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "MANUAL OVERRIDE DURING ALERT — RISKY"),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "WHATEVER YOU'RE DOING, DO IT FAST")],
            [ChatterLine(speaker: "WRAITH", cat: .ghost, text: "you can't steer away from me.")],
        ],
        "sceneChange:PANIC": [
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "NO TIME FOR THIS — HOLD SOMETHING"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "twist all you like.")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "FEED UNSTABLE — CAN'T TRACK THE SWITCH")],
        ],
        "sceneChange:SILENCE": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "...still steering. someone's still there.")],
            [ChatterLine(speaker: "WRAITH", cat: .ghost, text: "...why bother.")],
        ],
```

Then add to the `ChatterDirector` class (after `fire(_:t:)`):

```swift
    private var lastSceneChange: Double = -Double.greatestFiniteMagnitude

    /// True if a non-empty pool exists for `key`.
    func has(_ key: String) -> Bool { (Chatter.pools[key]?.isEmpty == false) }

    /// Course-correction chatter for a user-initiated scene change: phase-keyed
    /// (`sceneChange:<PHASE>`, falling back to base `sceneChange`), suppressed under
    /// reduced-motion, throttled to one firing per `cooldown` seconds. Returns whether it fired.
    @discardableResult
    func fireSceneChange(phase: String, calm: Bool, t: Double, cooldown: Double = 1.2) -> Bool {
        if calm { return false }
        if t - lastSceneChange < cooldown { return false }
        lastSceneChange = t
        let phaseKey = "sceneChange:\(phase)"
        fire(has(phaseKey) ? phaseKey : "sceneChange", t: t)
        return true
    }
```

- [ ] **Step 3: Emit `.sceneChange` on the user-initiated native cycle**

In `Renderer.swift cycleScene(by:)` (line ~154), emit after the guards confirm a real change (after `guard to != from else { return }`, before `beginTransition`):

```swift
        guard to != from else { return }
        bus.emit(FlightEvent(kind: .sceneChange, dir: delta > 0 ? 1 : -1))
        beginTransition(TransitionProfiles.profileFor(from: from, to: to, calm: settings.reducedMotion)) { [weak self] in
```

(`onFilmPhase` warps via `beginTransition` directly, never `cycleScene`, so automatic scene changes still emit nothing.)

- [ ] **Step 4: Subscribe + handle on the native side**

In `Renderer.swift`, add to the `if !combatWired { … }` block (lines ~364-369):

```swift
            bus.subscribe(.sceneChange) { [weak self] _ in self?.onSceneChange() }
```

Add the handler near `onCombat` (after line ~210):

```swift
    /// React to a user-initiated scene change: phase-keyed course-correction chatter.
    private func onSceneChange() {
        chatter.fireSceneChange(phase: phaseKey(hud.terminal.currentPhase), calm: settings.reducedMotion, t: t)
    }
```

- [ ] **Step 5: Build/compile + native test gate**

Run: `bash scripts/run-native-tests.sh`
Expected: ALL PASS — the native golden is unchanged (sceneChange is user-only; the harness drives no arrow input), parity tests unaffected. If a full app build is available locally: `bash scripts/build-native-app.sh` compiles clean.

- [ ] **Step 6: Commit**

```bash
git add native/macos/KuroNativeSaver/Core/EventBus.swift native/macos/KuroNativeSaver/Core/Chatter.swift native/macos/KuroNativeSaver/Core/Renderer.swift
git commit -m "feat(native): sceneChange event + phase-keyed course-correction chatter twin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification gate + on-device handoff

**Files:** none (verification only).

- [ ] **Step 1: Run all web gates**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green — `chatter-parity` (`3913490057233810303n`), `scene-chatter` (content + fireSceneChange behaviour), and the pre-existing suite; typecheck clean; build emits `dist/`.

- [ ] **Step 2: Run native gates**

Run: `bash scripts/run-native-tests.sh`
Expected: ALL PASS (golden + LCG parity unchanged).

- [ ] **Step 3: Confirm the invariants by inspection**

- `git grep -n "kind: 'sceneChange'" src/engine/controller.ts` → only inside `switchScene`, guarded by `opts?.user`.
- `git grep -n "switchScene(" src/engine` → automatic callers (`onFilmPhase`, `main.ts`) pass no `opts`.
- Web `sceneChange:*` texts equal the `Chatter.swift` `sceneChange:*` texts (hand-mirror check, since no automated guard yet).

- [ ] **Step 4: On-device sign-off (Johannes)**

Manual acceptance (native, active-watch context): press ←/→ → scene cycles AND phase-appropriate operator chatter appears; mashing ←/→ does not spam (≤ ~1 exchange / 1.2 s); with reduced-motion enabled, no sceneChange chatter. Note any tone/wording tweaks for a follow-up content pass.

---

## Self-Review

**Spec coverage:**
- Part A (CHATTER→SSOT byte-true move + guard) → Task 1. ✓
- Part B (sceneChange event, per-phase content, emit seam, ←/→ binding, calm gate, cooldown) → Tasks 2 (content + logic) + 3 (wiring). ✓
- Part C (native twin) → Task 4. ✓
- Part D (tests + acceptance) → Task 2 (unit), Task 1 (move guard), Task 5 (gates + on-device). ✓ The design's "simulate keydown" is adapted to the repo's node-only vitest env: chatter streaming/calm/cooldown is proven via `fireSceneChange` unit tests; the keydown→emit path is structural + covered by typecheck/build (documented in Task 3 Step 8).
- Non-goals (no recklessness, dir non-content-bearing, native parity deferred to 1.3) → Global Constraints, honoured by leaving `arc.ts`/threat/memory untouched. ✓

**Placeholder scan:** none — every code/JSON/command step is concrete.

**Type consistency:** `fireSceneChange(phase, calm, now, cooldownMs?)` (web) / `fireSceneChange(phase:calm:t:cooldown:)` (native) and `has(key)` are defined in Tasks 2/4 and consumed in Tasks 3/4. `switchScene(id, opts?)` / `cycleScene(dir?)` defined and consumed consistently. `currentPhase: Phase` typed against the existing `Phase` import. FNV pin `3913490057233810303n` and cooldown `1200`ms / `1.2`s consistent across tasks.
