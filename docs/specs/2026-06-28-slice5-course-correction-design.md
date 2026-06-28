# Slice 5 — ←/→ "Kurskorrektur" chatter + CHATTER → JSON-SSOT migration

**Date:** 2026-06-28
**Spec:** Spec 1 (Story-Arcs + Corruption), Slice 5 — "Variabilität Ebene 4" (world→story feedback)
**Status:** design approved (brainstorm 2026-06-28), ready for implementation plan
**Depends on:** Slice 1 (JSON SSOT) — shipped.

## Summary

The ←/→ arrow keys already cycle the 3D flight scene. Slice 5 makes a **user-initiated**
scene change emit a new `sceneChange` event on the flight bus, which triggers reactive,
phase-aware operator radio **chatter** — the operator verbally reacts to the viewer steering
("Kurskorrektur"). It is deliberately the lightest world→story-feedback touch.

This slice also pays down a debt discovered during brainstorm: the spec assumed chatter
content got "free parity via the SSOT", but **chatter is NOT in `story-content.json`** today —
`chatter-bank.ts` (web) and `Chatter.swift` (native) are hand-mirrored twins. Before adding the
new `sceneChange` content we migrate the existing `CHATTER` pool into the JSON SSOT (byte-true
move, hash-guarded), making the web side a facade like `presets.ts`/`dictionary.ts`.

## Ratified scope decisions (brainstorm 2026-06-28)

1. **Chatter SSOT:** migrate the whole `CHATTER` bank into `story-content.json` (byte-true,
   FNV-hash guarded à la Slice 1b), *then* add the new `sceneChange` content there. Web reads
   the JSON via a facade; the native Swift twin stays hand-mirrored (its JSON parity is Slice
   1.3's job, identical treatment to presets/dict today).
2. **Content shape:** per-phase variants — `sceneChange:ROUTINE … sceneChange:SILENCE` — so the
   operator's tone shifts with the threat phase. A base `sceneChange` pool is the fallback.
3. **Native + test:** ship web **and** native this slice (native is purely additive — keys are
   already bound there). Acceptance covered by an automated web behavioural test + an on-device
   sign-off by Johannes.
4. **`1-9` direct-pick keys also emit `sceneChange`** (any manual scene pick = course-correction).
5. **Cooldown 1.2 s** against arrow-mashing chatter spam.
6. **`dir` (left = −1 / right = +1) is carried but does NOT change content** — reserved for future use.

### Held from the ratified Spec-1 scope (non-goals)

- No recklessness machinery: ←/→ does **not** touch arc selection, `threat`, `peakStage`,
  endings, or persisted `StoryMemory`. `divertOnRecklessness` / `ArcState.recklessness` stay
  reserved-and-absent.
- The automated **web↔native chatter content-parity** guard stays deferred to Slice 1.3
  (Swift `Codable` + schema test). This slice does not build a cross-language guard.

## Current state (verified against live code)

- **Web chatter exists** and is populated: `src/engine/terminal/chatter-bank.ts` exports
  `CHATTER: Record<string, ChatterLine[][]>`, keyed by `FlightEventKind`
  (`incomingFire`/`unitArrive`/`unitCrash`) or `phase:*`. (The design doc's stale "native-only"
  note was wrong.)
- **`Chatter.swift` is a byte-identical twin** of `chatter-bank.ts` today (same pools/texts/
  speakers/categories) — no pre-existing drift to reconcile.
- **`ChatterDirector`** (`chatter-director.ts` web / `Chatter.swift` native) dispatches by exact
  key, picks a non-repeating exchange via seeded RNG (`mkRng(seed ^ 0xc4a77e)` / `LCG`), and
  streams the exchange's turns at 520 ms stagger. A missing/empty pool is a silent no-op.
- **Controller wiring:** `this.engine.bus.subscribe('*', …)` routes flight events to
  `this.chatter?.fire(e.kind)`; `onPhaseEnter` fires `phase:<PHASE>`. `reduceMotion` is already
  captured in the subscriber but the existing chatter `fire` calls are **not** calm-gated.
- **Scene plumbing:** `switchScene(id)` is the shared low-level path. It is called by
  `cycleScene()` (←/→), the `1-9` block, the **automatic** film-mode phase warp
  (`onPhaseEnter`), and the startup transition (`main.ts`). `cycleScene()`/`switchScene()` emit
  no bus event today.
- **Keybindings:** ←/→ are **unbound on web** today; any unhandled key falls through and closes
  the saver. Native ←/→ are already bound to `cycleScene(±1)` (only in `sceneHotkeyEnabled`
  modes) but emit no bus event.
- **JSON SSOT:** `story-content.json` has 15 top-level keys; **no `chatter` key yet**. The
  native Swift twin does **not** read the JSON at all — it is hand-mirrored, verified against the
  JSON only by parity tests / on-device golden, with the Codable bundle path being Slice 1.3.
- **Facade precedent:** `presets.ts` imports the JSON and rebuilds the original runtime shape so
  the export is byte-identical to the old literal, pinned by an FNV-1a hash in
  `tests/dict-presets-parity.test.ts` (explicitly a *web-internal* move-fidelity guard).
- **Path correction:** the bus type lives at `src/engine/events/bus.ts` (spec/plan said
  `core/bus.ts`); `FlightEvent` already carries an optional `dir?: number`.

## Architecture

### Part A — CHATTER → `story-content.json` (byte-true move)

- Add a new top-level **`chatter`** section to `story-content.json`: a JSON **object** keyed by
  the chatter key (`incomingFire`, `unitArrive`, `unitCrash`, `phase:INTRUSION`, `phase:ALARM`,
  `phase:PANIC`, `phase:SILENCE`). Unlike `presets` (array-with-id, because the swatch UI needs
  order), chatter dispatch is purely key-based, so an object is correct; byte-identity of the
  facade output is preserved by authoring the keys in the current literal order.
- `chatter-bank.ts` becomes a **facade**: keep the `ChatterLine` interface + doc comment, replace
  the literal with `export const CHATTER = (story as …).chatter`. Same mechanism as `presets.ts`.
- **Move guard:** pin `fnv1a(JSON.stringify(CHATTER))` captured from the *pre-move* literal
  (independently reproducible from `git show HEAD:…chatter-bank.ts`), then re-hash the facade
  output — green ⇒ byte-identical. Add to a chatter parity test (sibling of the dict/presets
  guard). The new `sceneChange` pools are added **after** the guard hash is pinned, so the move
  and the content addition are separable and the hash proves only the move.

### Part B — `sceneChange` event + per-phase chatter (web)

1. **Type:** add `'sceneChange'` to `FlightEventKind` in `src/engine/events/bus.ts`. `dir?`
   already exists — no interface change.
2. **Emit seam (centralised, auto-safe):** change `switchScene(id, opts?: { user?: boolean })`.
   Emit `bus.emit({ kind: 'sceneChange', dir })` **only when `opts.user` is true**. Automatic
   callers (`onPhaseEnter` warp, `main.ts` startup transition) omit the flag → never emit, so the
   fixed-seed narrative stream and the golden snapshot are untouched. User callers pass
   `{ user: true }`: `cycleScene(dir)` (←/→, `dir = ∓1`) and the `1-9` block (`dir = 0`).
3. **Binding:** in `handleLiveHotkey`, bind `ArrowLeft → cycleScene(-1)` and
   `ArrowRight → cycleScene(+1)`, each calling `preventDefault()` + `stopPropagation()` and
   returning `true` (so the key does not close the saver). They run under the same context gate
   as the already-working `1-9` keys (active-watch / `sceneHotkeyEnabled`).
4. **Route + calm gate:** in the bus `'*'` subscriber add a `sceneChange` branch that
   (a) suppresses when `prefers-reduced-motion` is set; (b) applies the 1.2 s cooldown;
   (c) builds the key `'sceneChange:' + currentPhase` and calls `this.chatter?.fire(key)`, with a
   fallback to the base `sceneChange` pool if the phase-keyed pool is missing. The controller must
   expose the current narrative phase (track `this.currentPhase`, set in `onPhaseEnter`).
5. **Cooldown:** a single timestamp in the `sceneChange` branch; drop chatter if the last
   sceneChange chatter fired < 1.2 s ago. Scene cycling itself is not throttled — only the chatter.
6. **Content:** author `sceneChange:ROUTINE` (calm operator ack) → escalating → `sceneChange:PANIC`
   (terse / overwhelmed) → `sceneChange:SILENCE` (near-silent), plus a base `sceneChange` fallback,
   in the `HQ`/`GHOSTLINK` registers consistent with the existing bank.

### Part C — native Swift twin (additive)

- `Renderer.swift cycleScene`: emit `.sceneChange` (keys already routed here; only the emit is
  new). Add `.sceneChange` to the native `FlightEventKind` enum and a subscriber next to the
  combat subscriptions that calls `chatter.fire("sceneChange:" + phase, t:)` with the same calm
  gate + 1.2 s cooldown. Do **not** rebind keys; keep behaviour gated to `sceneHotkeyEnabled`.
- `Chatter.swift`: hand-mirror the same `sceneChange:PHASE` pools (consistent with all existing
  native chatter). No new cross-language guard (Slice 1.3).

### Part D — tests + acceptance

1. **Move fidelity (web):** FNV-1a hash of the `CHATTER` facade output equals the pinned
   pre-move hash.
2. **Behavioural (web, the automated acceptance test):** in an active-watch context, a simulated
   `ArrowLeft`/`ArrowRight` keydown (a) emits a `sceneChange` bus event with the correct `dir`,
   and (b) causes `ChatterDirector.fire` to be called with the phase-keyed `sceneChange` key and
   stream a non-empty line. Also assert: `prefers-reduced-motion` suppresses the chatter; the
   automatic phase warp does **not** emit `sceneChange`.
3. **Golden snapshot:** unchanged when no arrow is pressed (sceneChange is user-only).
4. **Native:** CI compile-check + on-device sign-off by Johannes (←/→ in active-watch fires
   chatter; respects reduced-motion).

## Files touched

**Web**
- `src/engine/data/story-content.json` — new `chatter` section (migrated bank + `sceneChange:*`).
- `src/engine/terminal/chatter-bank.ts` — literal → facade over `story.chatter`.
- `src/engine/events/bus.ts` — `'sceneChange'` added to `FlightEventKind`.
- `src/engine/controller.ts` — `switchScene` `{user}` opt + emit; `cycleScene(dir)`; `1-9` emit;
  ←/→ binding in `handleLiveHotkey`; `sceneChange` branch (calm gate + cooldown) in the bus
  subscriber; `currentPhase` tracking.
- `tests/chatter-parity.test.ts` (new) — move-fidelity FNV guard.
- `tests/scene-change.test.ts` (new) — behavioural acceptance.

**Native (macOS)**
- `native/macos/KuroNativeSaver/Core/Renderer.swift` — `.sceneChange` emit + subscriber.
- `native/macos/KuroNativeSaver/Core/Chatter.swift` — `sceneChange:*` pools (hand-mirror).
- native `FlightEventKind` enum — `.sceneChange` case.

## Risks / invariants

- **Auto-emit hazard:** the emit MUST be gated to user-initiated scene changes — verified by the
  golden-snapshot test and the "auto warp emits nothing" assertion.
- **Saver-close hazard:** the ←/→ binding MUST `preventDefault`/`stopPropagation`/`return true`.
- **Byte-true move:** the FNV guard hash is pinned from the pre-move literal, never re-derived
  from the migrated value; `sceneChange` content is added only after pinning.
- **Calm parity:** sceneChange chatter needs its *own* explicit reduced-motion gate — it cannot
  rely on a threat threshold (calm only damps threat, does not zero chatter triggers).
- **Sign convention:** left = −1, right = +1 must match across both twins (matters only if `dir`
  later becomes content-bearing).
- **Native parity:** the `sceneChange` pools must be added identically by hand in both files; no
  automated guard catches drift until Slice 1.3.
