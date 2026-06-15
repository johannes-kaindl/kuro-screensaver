# Story Arcs + Corruption (Spec 1) — Design

**Date:** 2026-06-15
**Status:** **Design ratified + self-reviewed.** All six sections were presented
section-by-section and confirmed via AskUserQuestion on 2026-06-15 (see *Decisions log*).
A four-reviewer adversarial self-review (2026-06-15) then corrected several "minimal-change"
overclaims, stale citations, and gaps; those corrections are folded in below (see *Self-review
corrections*). Next: user-review, then a writing-plan (`2026-06-15-story-arcs-corruption-plan.md`).
**Topic:** First spec of the three-part Story-Audio programme (brainstorm log
`.claude/logs/2026-06-10-story-corruption-brainstorm.md`). Covers **story variability**
(branching arcs + variable endings + cross-session memory) and **threat-escalating terminal
corruption**, web (TypeScript) and native (Swift/Metal) as a twin. Spec 2 = mood music;
Spec 3 = SFX + native audio parity — out of scope here.

---

## Context

The terminal narrative is today a **fixed 5-phase machine** with **no memory and no
variability**: `ROUTINE → INTRUSION → ALARM → PANIC → SILENCE`, ~6–9 min, then a CRT
crash + a fresh persona, looping forever with an identical plot (`narrative.ts:44-46`
`NEXT_PHASE`; reset in `silentReset()` `narrative.ts:184`, callback at `:169-172`). Beats
are drawn **uniformly at random** from per-phase pools with **no filtering** (`pick()`
`narrative.ts:533-535`; call sites e.g. routine `:308`, intrusion `:331`, alarm `:399`,
panic `:415`). The native twin mirrors this in `Terminal.swift` (`nextPhase()` `:151-167`).

Two structural problems motivate the architecture:

1. **No variability.** The goal is "bei jedem Durchlesen spannend" — the plot must branch
   and end differently across viewings and accrete across sessions.
2. **The parity trap.** Story *content* is ~100% hand-mirrored across two languages
   (`script-bank.ts` 464 lines ↔ `Script.swift` 254 lines, plus `dictionary.ts`,
   `presets.ts` ↔ `Palette.swift`). Every lore line costs a dual edit; silent divergence
   is the standing risk.

Corruption today is **purely cosmetic via text prefixes** — monochrome on both platforms,
categories are only prefix glyphs (web `hud/index.ts` PREFIX map ~line 568, native
`Terminal.swift` `prefix()` ~line 131). `threat` (0..1) already flows from `ReactiveWorld`
(`fx/reactive-world.ts:14-21` BAND; native twin `Renderer.swift:320-341`) but never touches
text rendering.

## Goal

Ship a twin (web + native) **Arc-Template layer over the existing phase machine** that makes
the story branch (antagonists, mentor behaviour, pacing, endings), **remember across
sessions** (variety + a slowly-degrading world), and **corrupt the terminal visually as
threat escalates** (subtle drift → glyph-salad materialization). Simultaneously **collapse
story content into a single shared JSON SSOT** so logic stays a deliberate twin while content
becomes single-source.

**Non-negotiable invariant:** the change is **additive at the behaviour level**. With no arc
selected (`arc` undefined / nil) and corruption gated off, the *narrative output* (beat
sequence, timing, threat curve, persona generation) is identical to today for a given seed.
This is **enforced by a test** (§6), not just asserted. Note this requires data/interface
changes (adding optional `tags` to beats, a `pickArc()` helper) that are themselves new code —
"additive" means *behaviour-preserving when inert*, not *zero diff*.

---

## Verified current state (2026-06-15 code map + self-review)

| Area | Web | Native |
|---|---|---|
| Phase type | `type Phase = 'ROUTINE'｜'INTRUSION'｜'ALARM'｜'PANIC'｜'SILENCE'` (`narrative.ts:31`) | `ShiftPhase` enum (`Terminal.swift`) |
| Phase machine | `NEXT_PHASE` `narrative.ts:44-46`; transition + foreshadow `:147-178`; `silentReset()` `:184` → CRT crash, fresh persona `:170` | `nextPhase()` `Terminal.swift:151-167`; `update()` `:58-77`; `advancePhase()` `:66` |
| Beat selection | `pick()` uniform, **no filter** (`:533-535`); ~20 call sites (routine `:308`, intrusion `:331`, alarm `:399`, panic `:415`, mentor, hesitations…) | `beatRoutine()` etc. `Terminal.swift:206-217`; pools in `Script.swift` |
| Persona typing | full TraitProfile + `profileFor()` + `phaseModulate()` (`persona.ts:52-120`), imported `narrative.ts:15` | **MISSING** — only `trait.baseSpeed` used; cps at `Terminal.swift:177` = `26.3 / baseSpeed * phaseSpeed(p)`. No typo/pause/abandon |
| Per-line tint | ❌ global CSS vars; `.tl` span has no category (`hud/index.ts:603`) | ⚙️ `colorFor()` exists + called (`:184`, `:260`) but returns **one uniform colour for all categories** (`Hud.swift:289`), documented intentional (`:290-293`) |
| Per-glyph colour | ❌ | ⚠️ **one colour per `add()` call** — `TextRenderer.add()` (`:42`) packs `color` into every vertex of the string (`:53-55`). Varying colour *within a line* is **not** free (see §3) |
| Per-glyph substitution | 🟠 moderate→hard (typewriter is `span.textContent = …slice()` at `hud/index.ts:645-654`; no per-glyph nodes today) | 🟡 ASCII→ASCII = `charMap` check before `uvRect()` (`TextRenderer.swift:46`); katakana = atlas (`FontAtlas.swift:24-75`, already bakes some katakana ~`:27`) |
| Screen-global glitch | ✅ `fx/crt-sim.ts` | ✅ `GlitchScheduler` |
| Reduced-motion | `calm` mode mutes storm/flicker but **only damps threat, doesn't zero it** (`reactive-world.ts:34-35,65,72,109,124`) | `settings.reducedMotion` routes transitions to CALM (`Settings.swift:32`, `Renderer.swift:161`) |
| World→Story | combat only: `bus.emit(incomingFire/…)` → `ChatterDirector` (`chatter-director.ts:22-32`); bus typed/sync (`bus.ts:5-35`) | `Chatter.swift:16-62` — chatter is **native-only**, no web pool today |
| ←/→ hotkey | `cycleScene()` exists (`controller.ts:852`) but **arrows not bound** (`handleLiveHotkey` 1-9+m/p/s only, `:762-801`) | bound to `cycleScene(±1)` (`main.swift:315-316` → `Renderer.swift:154-167`) but **emits no bus event**; only in `sceneHotkeyEnabled` modes |
| Foreshadow lead | scaled: `lead = 6000 * durationScale` (`narrative.ts:157`) | **hardcoded `- 6` seconds, unscaled** (`Terminal.swift:60`) — *latent parity bug* (see §6/Risks) |
| Persistence | `localStorage['kuro-screensaver:settings']`, `deepMerge` forward-safe (`persistence.ts:13-26`); `stats` block already this shape (`defaults.ts:128`); save debounced 1500ms (`controller.ts:928-930`) | `UserDefaults` flat KV (`AppSettings.swift:9-46`), runtime-only, **no JSON/Codable today** |
| Bundle resources | n/a (Vite inlines) | **none loaded today** — only `Bundle.main.executablePath` (`LoginItem.swift:26`). Resource loading in `.app`/`.saver` is **unproven** (see §2) |
| Data/build | JSON import works — `resolveJsonModule:true` (`tsconfig.json:17`), Vite inlines | **no JSON copy** in `build-native-app.sh` (only the icon ~line 35) |

---

## Design

### Shared types (define once, twin both sides)

```ts
// Phase already exists (narrative.ts:31). Arc logic NEVER changes the phase set —
// only transition routing, duration, and content selection.
type Phase = 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC' | 'SILENCE';
type EndingId = 'harmonized' | 'cold-path' | 'karsen' | 'wraith' | 'captured' | 'normal';
interface SceneWeight { scene: FlightSceneId; weight: number; }   // FlightSceneId from film-director.ts:9
```

### 1. Arc-Templates (over the phase machine)

An **Arc-Template** is a thin policy layer the runner consults at the decision moments below.
It is a **twin** (TS logic in `narrative.ts`, Swift logic in `Terminal.swift`); its **content**
(the template records) lives in the JSON SSOT.

**The levers** (verified hook points)

| # | Lever | Web hook | Native hook |
|---|-------|----------|-------------|
| 1 | Ending (override SILENCE→ROUTINE reset) | `silentReset()` callback `narrative.ts:169-172` | `advancePhase()` `Terminal.swift:66` (SILENCE→ROUTINE branch) |
| 2 | Antagonist / threat-typed intrusions (tag filter) | intrusion pick `narrative.ts:331/399` | `beatIntrusion/Alarm` `Terminal.swift:206-217` |
| 3 | Mentor availability + identity (gate `beatMentor`) | `narrative.ts:253-256` | `Terminal.swift:295-300` |
| 4 | Phase-deviation (routing + per-phase duration) | `arc?.nextPhase(p) ?? NEXT_PHASE[p]`; duration via `durationScale` (`:147`) | `nextPhase()` `Terminal.swift:151-167`; phase span `:31` |
| 5 | Beat-tag filter | `pickArc()` at every pick site (routine `:308`, intrusion `:331`, alarm `:399`, panic `:415`, …) | matching native `beat*()` |
| 6 | FilmDirector scene-itinerary bias | `film-director.ts:11` `PHASE_CANDIDATES`, class `:19` (narrative-blind today) | `Renderer.swift:320-341` scene pick |
| 7 | threatCurve bias | `ReactiveWorld` BAND `reactive-world.ts:14-21` (must be made arc-aware) | `Renderer.swift:320-341` |

**Making beats arc-filterable** — `pick()` itself stays untouched; a thin helper wraps it:

```ts
// new helper — does nothing observable when arc is undefined
function pickArc<T extends { tags?: string[] }>(pool: T[], arc?: ArcState): T {
  if (!arc) return pick(pool);
  const f = pool.filter(b => arcAllows(b.tags, arc.arc.beatTags));
  return pick(f.length ? f : pool);   // never starve: empty filter → full pool
}
// filter semantics (twin-identical, tested in §6):
//   no tags on beat            → always eligible (back-compat for untagged content)
//   include set present         → beat must share ≥1 include tag
//   exclude set present         → beat must share 0 exclude tags
//   exclude wins over include on conflict
```

Every direct `pick(POOL)` at the ~20 narrative call sites becomes `pickArc(POOL, this.arc)`.
This is a mechanical sweep, not a rewrite of `pick()`. Beat interfaces gain an optional
`tags?: string[]`; existing untagged beats stay eligible for all arcs (back-compat).

**Ratified decisions:** ending = **hybrid** (arc default + threat diversion); scope = **full**,
incl. FilmDirector scene-itinerary + threat-curve; mentor = **arc-overridable**.

**Canonical arc set (5 primary arcs):** `harmonized`, `cold-path`, `karsen` (mentor
intervention), `wraith` (antagonist takeover), `normal` (rare straight ending). **Plus one
divert target:** `captured` (reachable via `divertOnThreat`, not a primary arc).

```ts
interface EndingSpec {
  default: EndingId;
  // hybrid model: the *peak* threatStage reached during the shift can divert the ending.
  divertOnThreat?: { atStage: 1 | 2 | 3; to: EndingId }[];
  divertOnRecklessness?: { atCount: number; to: EndingId }[];   // RESERVED — inert in Spec 1 (§5)
}

interface ArcTemplate {
  id: string;
  weight: number;                                   // base selection weight at shift start
  antagonist: string;                               // tag → threat-typed intrusion content
  mentor: { name: string; availablePhases: Phase[] } | null;   // null = no mentor this arc
  // phaseRouting overrides NEXT_PHASE. Missing entry → fall back to NEXT_PHASE[phase].
  // "false all-clear" = routing a high phase back down (e.g. ALARM→ROUTINE) then re-escalating.
  // "skip-blitz" = INTRUSION→PANIC. Values are always a Phase (never boolean).
  phaseRouting?: Partial<Record<Phase, Phase>>;
  durationScale?: Partial<Record<Phase, number>>;   // per-phase pacing
  beatTags: { include?: string[]; exclude?: string[] };
  scenes?: Partial<Record<Phase, SceneWeight[]>>;   // arc-biased FilmDirector itinerary
  threatCurve?: Partial<Record<Phase, [number, number]>>;   // override reactive-world BAND per phase
  ending: EndingSpec;
}

interface ArcState {
  arc: ArcTemplate;
  threatStage: 0 | 1 | 2 | 3;   // current quantized corruption level
  peakStage: 0 | 1 | 2 | 3;     // max reached this shift → feeds divertOnThreat at SILENCE
  recklessness: number;          // RESERVED — inert in Spec 1
}
```

**Arc selection & lifecycle** (preserves the additive invariant):

1. Selection happens **inside the `silentReset` callback** (`narrative.ts:169-172`), *after*
   the blackout + persona regen, *before* `enterPhase('ROUTINE')`. The arc is never visible
   until a fresh shift has already begun.
2. `pickArc`-selection over `arcs[]`: weight each candidate by `weight`, then dampen any id
   present in `story.arcsCompleted` (ring buffer, **N = 3**) so the same arc can't repeat
   within 3 shifts; pick uniformly among the survivors. Empty/cold history → pure weights.
3. `ArcState` lives on the runner and **survives `silentReset`** (unlike the persona). It is
   re-selected each shift; `peakStage` resets to 0 at shift start.
4. On the first ever shift (no history), selection is deterministic-from-weights so the
   additive-invariant test can pin a known arc — or pass `arc=undefined` to assert identity.

**Ending evaluation (SILENCE):** at the PANIC→SILENCE transition, resolve the ending =
the first `divertOnThreat` rule whose `atStage ≤ peakStage`, else `ending.default`. The
resolved `EndingId` selects the SILENCE-phase `farewells`/`lastWords` set (§2) and is recorded
to `story.endingsReached` (§4) at the force-flush.

### 2. JSON content SSOT + loader

**Ratified:** one namespaced `story-content.json` + a schema-decode parity test.

**In JSON** = raw **unsubstituted** placeholder strings + category tags + arc templates.
**In code** (twin): the state machine, `pick()`/`pickArc()`, beat scheduling, persona token
substitution (`{node}/{hq}/{hqlower}/{sector}/$P` via `typing.ts` / `Terminal.subst()`
`Swift:140-147`), lore-intensity weights (`dictionary.ts:204-221`), computed preset math.

```jsonc
{
  "schemaVersion": 1,
  "presets":       [ /* id,label,kanji,darkAccent,lightAccent,glow,scanline,vignette ×13 */ ],
  "boot":          { "lines": [...], "headers": { "<sceneId>": [...] } },
  "terminalDicts": { "STATUS": [...], "WARNING": [...], "LORE": [...], "QUOTES": [...] },
  "beats": {
    "routine": [ { "cmd": "…", "resp": [ {"cat":"…","text":"…"} ], "tags": [] } ],
    "hqInboundRoutine": [...], "hqReplyRoutine": [...],
    "intrusionsQuotes":    [ { "text": "…", "followup": null, "tags": [] } ],  // followup → JSON null, not absent
    "intrusionsFragments": [...],
    "reactions": { "first": [...], "alarm": [...], "panic": [...] },
    "hesitations": [...], "hqEscalationDrafts": [...], "panicDrafts": [...], "systemFinal": [...]
  },
  "endings": { "farewells": { "harmonized":[...], "wraith":[...], … }, "lastWords": { … } },  // keyed by EndingId
  "mentor":  { "exchanges": [ {"phase":"…","out":"…","reply":[…],"threat":"…"} ], "ghostlink": { … } },
  "film":    { "foreshadow": {…}, "arrival": {…}, "combat": {…}, "chatter": {…} },  // chatter gains web parity for free
  "arcs":    [ /* ArcTemplate[] */ ]
}
```

**Loader plumbing**

- **Web:** `import story from './data/story-content.json'`; `script-bank.ts`/`presets.ts`/
  `dictionary.ts` become thin typed facades. No tooling change.
- **Native:** `StoryContent` Codable structs parsed once at app init. **Bundle loading is
  unproven and must be de-risked FIRST** (zero current resource loads; macOS screensaver
  bundle paths differ between the `.app` host and any legacy `.saver`). Plan step 0:
  prototype `Bundle.main.url(forResource:"story-content", withExtension:"json")` in the real
  `.app`, print `Bundle.main.resourcePath`, confirm it resolves. Add an explicit
  `mkdir -p "$RES" && cp story-content.json "$RES/"` to `build-native-app.sh` (~after line 35).
  **Fallback:** if the resource is missing/unparsable, load a small embedded default (or fail
  loud in dev) — never silently render an empty terminal.
- The Codable infra added here is **reused** by persistence (§4) and the schema test (§6).

**Trade made explicit:** swaps a *high-frequency, easy-to-forget content-divergence* risk for
a *low-frequency, loud-failure schema-divergence* risk (a mismatched Swift struct crashes or
silently drops fields). The schema test (§6) makes the failure loud. `null` discipline for
nullable fields (`followup`) is required for Swift `Optional` Codable.

### 3. Corruption render layer

**Ratified:** stepped 4-stage curve; katakana atlas pre-bake; per-category tint **threat-gated**;
**also reduced-motion-gated** (self-review addition).

**Model:** `threat` (0..1, per-phase, arc-biasable via `threatCurve`) quantizes to
`corruptionStage` 0–3 = `ArcState.threatStage`. The quantization is a twin, unit-tested for
bit-parity (§6). **`corruptionStage` is forced to 0 when `calm`/`reducedMotion` is set** — in
calm mode `threat` is only damped, not zeroed (`reactive-world.ts:124`), so corruption needs
its **own explicit calm gate**, not reliance on a low threat value.

| Stage | threat | Web | Native |
|---|---|---|---|
| **0 calm** | <.15 *or reduced-motion* | monochrome (today) | uniform glow (today, **preserved**) |
| **1 subtle** | .15–.40 | faint per-category tint + `text-shadow` drift; rare single-glyph flicker | faint per-category tint (gated) + glyph-alpha flicker |
| **2 active** | .40–.70 | category tint clear; ASCII/katakana glyph-salad on intrusion lines during typing; line jitter | full category tint; `charMap` substitution; per-glyph colour variation |
| **3 aggressive** | >.70 | **materialization from glyph-salad** (line resolves out of random glyphs); own-colour; flicker; coordinated screen glitch | same via per-glyph colour + `charMap` ramp + `GlitchScheduler` |

Both platforms show **per-category tint starting at stage 1** (the gate threshold); the
texture differs (web text-shadow drift, native glyph-alpha flicker) but the essence is one
threat-gated implementation. **Per-category corruptibility** (code-side factor, not JSON):
`LORE`/`QUOTES` corrupt hardest, `CMD`/`STATUS` latest.

**Threading `corruptionStage` to the renderers** (the part the first draft undersold):

- **Web:** the narrative/ReactiveWorld already updates per frame; expose `corruptionStage`
  on the HUD update path and write it as a CSS custom property on the terminal root
  (`--ks-corrupt: <0..3>`) + `span.dataset.category` + `class="tl cat-<x>"` at line creation
  (`hud/index.ts:603`). Per-category CSS + corruption colour vars extend `:304-311`.
  Per-line glitch lives **in the HUD**, not `crt-sim.ts` (screen-global only) — else double
  artifacts.
- **Native (multi-layer plumbing, NOT ~10 lines):** `colorFor()` (`Hud.swift:289`) takes no
  threat today and `renderOverlay()` (`Hud.swift:36`) has no threat parameter. Required:
  (1) add `corruptionStage: Int` (+ `calm: Bool`) to `renderOverlay()`; (2) pass it from the
  `Renderer` frame loop; (3) thread it into both `colorFor()` call sites (`Hud.swift:184`,
  `:260`); (4) rewrite `colorFor()` to `switch(category, stage)` with the stage-0/calm gate
  so the calm log keeps the deliberate uniform look (`Hud.swift:290-293`).

**Per-glyph colour (native) is not free.** `TextRenderer.add()` writes **one** colour into
every vertex of the whole string (`TextRenderer.swift:53-55`). Varying colour *within* a line
needs one of: (A) a `glyphColors: [SIMD3<Float>]?` (or sparse `[Int: SIMD3]`) parameter that
the packing loop reads per glyph — extends the call signature but **not** the vertex format
(colour is already per-vertex); or (B) per-glyph `add()` calls — a perf cliff in the Metal hot
loop (dozens of draws vs. a few batches). **Plan must prototype (A)** and measure; default to
(A) with a sparse map so only corrupting lines pay.

**Materialization is a real feature, not a typewriter tweak.** The web typewriter is
`span.textContent = prefix + slice(0, ++ci)` (`hud/index.ts:645-654`) — no per-glyph nodes.
Materialization at stage ≥2 means: per revealed glyph, emit a random "salad" glyph first, then
resolve to the target over ~150–250 ms. Web implementation = per-glyph inner spans (or a
char-buffer rewrite) interleaved with the reveal loop; native = `charMap` ramp in the hot
loop. Treat this as its own plan slice with its own visual sign-off.

**Katakana atlas:** `FontAtlas` already bakes some katakana (`FontAtlas.swift:~27`), and the
Matrix-rain scene uses katakana. **Plan step 0:** audit whether that glyph set is reusable for
corruption; only bake new slots if corrupted variants are actually needed. Note `uvRect()`
(`FontAtlas.swift:79`) is a fixed lookup — new glyphs mean new atlas entries.

### 4. Persistence / story memory

**Ratified:** depth = **variety + escalation**, both platforms.

A `story` block beside `stats` in `ScreensaverSettings` (`defaults.ts:128-133` +
`DEFAULT_SCREENSAVER` `:135-214`); `deepMerge` (`persistence.ts:13-26`) makes old saves
forward-safe automatically.

```ts
story: {
  schema: 1;                                 // versioned for future migrations
  layerCounter: number;                      // completed shifts → escalation baseline
  arcsCompleted: string[];                   // ring buffer, last 3 → anti-repeat
  endingsReached: Record<EndingId, number>;  // counts → rare-ending gating
  antagonistHistory?: Record<string, number>;// RESERVED — inert in Spec 1
  mentalStateScore?: number;                 // RESERVED — inert in Spec 1
}
```

- **Two independent per-device silos, twins in SHAPE not shared storage.** Web persists to its
  `localStorage`; native persists to its own `UserDefaults`. They are **not** synced at runtime
  (no shared store, no cross-device sync) — each platform reads/writes its own copy. "Both
  platforms together" means *implement both*, so a viewer on either platform gets memory — it
  does **not** mean one authoritative store. Arc selection is therefore device-local and not
  cross-platform-deterministic (and need not be — see §6 RNG note).
- **Native** stores the `story` block as a single JSON blob under `UserDefaults` key
  `StoryMemory`, encoded/decoded with the Codable infra from §2 (native has no Codable today).
- **Force-flush ordering** (avoids the 1500 ms debounce, `controller.ts:928-930`): inside the
  `silentReset` callback, **after** the new arc is selected and the ending recorded, call an
  explicit non-debounced save (`plugin.saveData()` immediate on web; `UserDefaults` write on
  native) **before** `enterPhase('ROUTINE')`. Also force-flush on `narrative.stop()`. Sequence:
  `SILENCE end → onShiftEnd(clearScreen) → [blank] → select arc + record ending → force-flush →
  enterPhase('ROUTINE')`.
- `threat`/stage stored **quantized** (0–3), never float → no round-trip divergence.

### 5. World→Story events + ←/→ course-correction

**Ratified:** parity-fix + reactive chatter, **no** recklessness machinery.

**Context limit (honest):** in the true idle macOS saver any key dismisses (OS behaviour).
←/→ steering is meaningful only in **active-watch contexts** — preview pane, browser tab,
windowed/dev, film-browse (the `sceneHotkeyEnabled` modes). A *touch*, not a pillar.

**Baseline (the parity fix — really a bug fix):**

1. **NEW** `'sceneChange'` variant added to `FlightEventKind` (`bus.ts:5-10`); `dir: -1|0|+1`
   in `FlightEvent` (`:12-18`). (Not present today.)
2. **Web:** bind ArrowLeft/Right in `handleLiveHotkey` (`controller.ts:762-801`) → `cycleScene()`;
   emit `bus.emit({kind:'sceneChange',dir})` in `switchScene`/`cycleScene` (`:804-829/:852`).
3. **Native:** `bus.emit(.sceneChange)` in `Renderer.cycleScene` (`Renderer.swift:154-167`)
   before `onFilmPhase`.
4. **Content:** add `sceneChange` (+ optional per-phase variants) to CHATTER both sides
   (`chatter-bank.ts:22-68` / `Chatter.swift:16-62`) — free parity via the SSOT.
5. **Reduced-motion:** sceneChange chatter respects the same calm gate as other reactive FX.

`divertOnRecklessness` / `ArcState.recklessness` remain reserved but inert in Spec 1.

### 6. Testing + native persona-typing parity

**Ratified:** persona-typing parity is **in Spec 1**.

**Native persona-typing twin:** port `TraitProfile` + `profileFor()` + `phaseModulate()`
(`persona.ts:52-120`) to Swift so the native operator hesitates/typos/abandons, escalating with
phase. Wire it where cps is computed (`Terminal.swift:177`): call `profileFor(persona.trait)`
at persona creation, `phaseModulate()` on each `enterPhase`, recompute the modulated cps
**before** running beats. Mind native's `phaseSpeed()` SILENCE multiplier so post-PANIC rhythm
matches web.

**Latent parity fix (do before arc work):** native foreshadow lead is hardcoded `- 6`
(`Terminal.swift:60`), web scales it `6000 * durationScale` (`narrative.ts:157`). Give the
native `Terminal` a `durationScale` and use `phaseEndsAt - 6 * durationScale`.

**Test strategy** (extends `scripts/run-native-tests.sh`, already in CI):

1. **Additive-invariant** — same seed, `arc=undefined` + corruption off ⇒ beat sequence,
   timing, threat curve, persona generation byte-identical to pre-change, both platforms.
2. **Schema-decode** — decode `story-content.json` into the Codable structs; assert section
   counts/keys against a manifest → schema drift fails loud in CI.
3. **Arc-logic parity (LCG)** — seed both platforms identically with `arcsCompleted=[]`,
   `layerCounter=0` (ring buffer frozen) ⇒ identical arc selection, `pickArc` filtering,
   phase routing. (LCG cores are bit-identical; `freshSeed()` differs web vs native, so tests
   pin an explicit seed rather than relying on fresh seeding.)
4. **corruptionStage(threat) parity** — stepped quantization bit-identical; calm/reduced-motion
   forces stage 0 on both.
5. **Ending determinism** — `(arc, peakStage) → EndingId` deterministic; `divertOnThreat`
   covered at several peak timings.
6. **Beat-tag filter parity** — `arcAllows()` truth table identical both sides (include/exclude,
   empty, untagged).
7. **Foreshadow parity** — same seed + `durationScale=0.1` ⇒ foreshadow fires at identical
   elapsed phase % both sides.
8. **Persistence forward-compat** — `deepMerge` unit (old save w/o `story` → defaults); native
   missing `StoryMemory` key → default; arc survives a process kill mid-`silentReset`.
9. **Web visual** — extend `node scripts/verify-crt.mjs` to snapshot corruption stages 0–3.
10. **Native visual** — Johannes on-device (katakana atlas + tint only judgeable on-device).

---

## Out of scope / deferred

- Spec 2 (mood music) and Spec 3 (SFX + native audio parity).
- `antagonistHistory` / `mentalStateScore` continuity, persisted persona threads (fields reserved, inert).
- recklessness → ending/branch effects (fields reserved, inert).
- Cross-platform / cross-device shared story state (silos are per-device by design).
- Arc→FilmDirector coupling beyond per-phase scene-weight bias (no new flight choreography).
- Migrating non-story config (terrain/camera/palette math) into the JSON SSOT.

## Risks (with mitigations)

- **Bundle resource loading unproven (native)** — *prototype FIRST* (§2 plan step 0) before any
  JSON migration; keep an embedded fallback.
- **Per-glyph colour / materialization hot-loop cost (native)** — prototype the sparse
  `glyphColors` path and measure draw-call count before committing the corruption render slice.
- **Schema divergence** (Swift Codable vs JSON) — schema-decode test + `null` discipline.
- **Twin logic drift** — arc/corruption/persona logic is duplicated by design; LCG + truth-table
  parity tests guard it.
- **Latent foreshadow bug** — fixed up front (§6) so arc phase-deviation doesn't inherit desync.
- **Reduced-motion** — corruption + sceneChange chatter explicitly calm-gated; a11y test in §6/9.
- **Reversing the deliberate uniform-glow decision** (`Hud.swift:290-293`) — threat+calm-gated so
  the calm log is unchanged; final call on-device.
- **Debounce data loss** — force-flush ordering in §4.
- **Scope:** Spec 1 is large (arcs + JSON migration + corruption incl. atlas + materialization +
  persistence + ←/→ + typing parity + foreshadow fix). The writing-plan must sequence it into
  independently shippable slices, each verifying the additive invariant.

## Decisions log (2026-06-15, AskUserQuestion)

1. Ending model → **hybrid** (arc default + threat diversion).
2. Arc scope → **full**, incl. FilmDirector scene-itinerary + threat-curve.
3. Mentor → **arc-overridable** (identity/availability are content).
4. JSON layout → **one namespaced file** + schema parity test.
5. Corruption curve → **stepped, 4 stages**.
6. Native glyph corruption → **katakana atlas pre-bake** (audit Matrix-rain reuse first).
7. Per-category tint → **yes, but threat-gated** (calm log stays uniform) + reduced-motion-gated.
8. Story-memory depth → **variety + escalation** (layerCounter/arcsCompleted/endingsReached).
9. ←/→ story effect → **parity-fix + reactive chatter** (no recklessness machinery).
10. Native persona-typing parity → **in Spec 1**.

## Self-review corrections (2026-06-15, 4 adversarial reviewers)

- Native per-line tint is **multi-layer plumbing** (renderOverlay→colorFor callers), not ~10 lines.
- Native per-glyph colour is **one-colour-per-`add()`-call** today; intra-line variation needs a
  `glyphColors` param (prototype + measure), it is not "free".
- Web materialization is a **rewrite** of the `textContent` typewriter, not an additive tweak.
- **Bundle resource loading is unproven** — prototype-first, with fallback.
- `pick()` "untouched" clarified: a `pickArc()` helper wraps it at **~20 call sites**; beats gain
  optional `tags`; "additive" = behaviour-preserving when inert (test-enforced), not zero-diff.
- Added missing types (`Phase`, `SceneWeight`), beat-tag filter semantics, ring-buffer **N=3**,
  arc-selection sequence, SILENCE ending evaluation (peakStage), web threat→HUD threading.
- Added **reduced-motion gating** of corruption + chatter (threat is only damped, not zeroed).
- Clarified persistence **silos** (per-device, not shared) + force-flush ordering.
- Surfaced the **latent native foreshadow durationScale bug**; fix scheduled before arc work.
- Citations corrected to verified lines; some switched to function-name refs to resist drift.
