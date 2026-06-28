# Slice 2 — Arc-Layer (Spec 1, content + scope design)

**Date:** 2026-06-28
**Status:** Brainstorm-design, awaiting user review → writing-plan.
**Parent:** `docs/specs/2026-06-15-story-arcs-corruption-design.md` (the ratified Spec-1
architecture — §1 Arc-Templates, shared types, `pickArc`/`arcAllows` semantics, selection
lifecycle, ending evaluation). **This doc does NOT re-design the architecture**; it pins the
**concrete creative content + the precise Slice-2 scope boundary** that the parent left open.
**Plan:** `docs/specs/2026-06-15-story-arcs-corruption-plan.md` (Slice 2 row + anchors).

---

## What this slice is

The arc architecture (types, `pickArc`, selection, ending resolution) is ratified. Slices 0+1
were infrastructure (tests, RNG parity, JSON SSOT) and shipped **no user-visible feature**.
**Slice 2 is the first payoff:** the story actually branches — different pacing, mentor
behaviour, beat flavour and ending across shifts.

**Content ambition (ratified this session): "lean + tagged".** Variability comes from
**routing + pacing + mentor presence + ending + tag-filtering of the EXISTING beat pool** — no
new antagonist prose block. Distinctive per-antagonist beat prose is a later content pass.

## Scope

**IN Slice 2:**
- `arc.ts` twin: `ArcTemplate` / `ArcState` / `EndingSpec` types, `arcAllows()`, `pickArc()`,
  `selectArc()`, `resolveEnding()`.
- `pickArc(POOL, this.arc)` swept across the ~20 narrative pick sites (mechanical; `pick()`
  itself untouched).
- Arc **selection** in the `silentReset` callback (weight + **in-memory** ring buffer N=3;
  cold-start = pure weights; first shift deterministic-from-weights for test pinning).
- **phaseRouting** (acyclic forward only) + per-phase **durationScale**.
- **Mentor override** per arc (gate `beatMentor` on `arc.mentor.availablePhases`).
- **threat→stage quantization** (small pure function) for `peakStage` / `divertOnThreat`.
- **Ending resolution** at SILENCE (`peakStage` → first matching `divertOnThreat`, else
  `default`); the resolved `EndingId` selects the SILENCE farewells/lastWords set.
- **Beat tagging** of a subset of existing beats + **arc-specific farewells/lastWords** per
  ending (6 ending sets; `normal` = today's content unchanged).
- Additive invariant: `arc=undefined` ⇒ golden narrative byte-identical (web + native twin).

**OUT (deliberately deferred):**
- Corruption render layer → **Slice 4** (only the threat→stage *quantization* lands here, not
  the visual render).
- Arc `scenes` FilmDirector bias → **Slice 7**; `threatCurve` → **Slice 8**. The `ArcTemplate`
  type carries these optional fields but Slice-2 templates omit them (no unconsumed data).
- Persistence of `arcsCompleted`/`endingsReached`/`layerCounter` → **Slice 3** (ring buffer is
  in-memory until then; cold-start path already handles empty history).
- **"False all-clear" backward routing** (e.g. ALARM→ROUTINE then re-escalate) — needs a
  once-guard to avoid loops; deferred. Slice 2 does acyclic forward routing only, so the
  additive invariant holds trivially.

**Web/native split (mirrors Slice 1's 1a/1b/1.3 rhythm):**
- **Slice 2 web** — now, autonomous: arcs authored in `story-content.json`, web reads them,
  web tests (golden, `arcAllows` truth table, ending determinism).
- **Slice 2 native** — later, bundled with native 1.3 in an on-device session: native reads
  the **same** arcs from the JSON (no double-authoring). The cross-platform LCG arc-parity
  tests run once native lands.

---

## The 5 arcs (selectable) + `captured` (divert-only)

Selectable `arcs[]` = `normal, harmonized, cold-path, karsen, wraith`. `captured` is **not** a
template — it exists only as an `EndingId` with its own farewells/lastWords, reached via
`divertOnThreat`.

| Arc | weight | antagonist | mentor (Karsen) availablePhases | routing / pacing | ending.default | divertOnThreat |
|---|---|---|---|---|---|---|
| normal | 1 | baseline | ROUTINE,INTRUSION,ALARM,PANIC | linear, ×1 | `normal` | — |
| harmonized | 3 | drift | ROUTINE,INTRUSION,ALARM,PANIC | ROUTINE ×1.3, PANIC ×0.7 | `harmonized` | stage 3 → `cold-path` |
| cold-path | 3 | trace | ROUTINE,INTRUSION | skip-blitz INTRUSION→PANIC; INTRUSION ×0.8, PANIC ×0.9 | `cold-path` | stage 3 → `captured` |
| karsen | 3 | injection | ROUTINE,INTRUSION,ALARM,PANIC | ALARM ×1.3, PANIC ×1.3 | `karsen` | stage 3 → `captured` |
| wraith | 2 | wraith | ROUTINE | ROUTINE ×0.5, PANIC ×1.4 | `wraith` | — |

Total weight 12 → `normal` ≈ 8 % (rare), each dramatic arc 17–25 %.

**As `ArcTemplate[]` (the `arcs` section of `story-content.json`):**

```jsonc
[
  { "id": "normal", "weight": 1, "antagonist": "baseline",
    "mentor": { "name": "INSTR-KARSEN", "availablePhases": ["ROUTINE","INTRUSION","ALARM","PANIC"] },
    "beatTags": {},
    "ending": { "default": "normal" } },

  { "id": "harmonized", "weight": 3, "antagonist": "drift",
    "mentor": { "name": "INSTR-KARSEN", "availablePhases": ["ROUTINE","INTRUSION","ALARM","PANIC"] },
    "durationScale": { "ROUTINE": 1.3, "PANIC": 0.7 },
    "beatTags": { "include": ["drift","calm","technical"], "exclude": ["wraith","aggressive"] },
    "ending": { "default": "harmonized", "divertOnThreat": [ { "atStage": 3, "to": "cold-path" } ] } },

  { "id": "cold-path", "weight": 3, "antagonist": "trace",
    "mentor": { "name": "INSTR-KARSEN", "availablePhases": ["ROUTINE","INTRUSION"] },
    "phaseRouting": { "INTRUSION": "PANIC" },
    "durationScale": { "INTRUSION": 0.8, "PANIC": 0.9 },
    "beatTags": { "include": ["trace","technical"], "exclude": ["calm"] },
    "ending": { "default": "cold-path", "divertOnThreat": [ { "atStage": 3, "to": "captured" } ] } },

  { "id": "karsen", "weight": 3, "antagonist": "injection",
    "mentor": { "name": "INSTR-KARSEN", "availablePhases": ["ROUTINE","INTRUSION","ALARM","PANIC"] },
    "durationScale": { "ALARM": 1.3, "PANIC": 1.3 },
    "beatTags": { "include": ["injection","technical"], "exclude": ["wraith"] },
    "ending": { "default": "karsen", "divertOnThreat": [ { "atStage": 3, "to": "captured" } ] } },

  { "id": "wraith", "weight": 2, "antagonist": "wraith",
    "mentor": { "name": "INSTR-KARSEN", "availablePhases": ["ROUTINE"] },
    "durationScale": { "ROUTINE": 0.5, "PANIC": 1.4 },
    "beatTags": { "include": ["wraith","aggressive"], "exclude": ["calm","drift"] },
    "ending": { "default": "wraith" } }
]
```

**Differentiation logic:** `normal` ≈ today (rare). `harmonized` lingers calm then resolves;
spiking to peak stage 3 means harmonization failed → `cold-path`. `cold-path` skips the ALARM
deliberation (decisive sever), Karsen drops after INTRUSION (channel goes cold); too slow →
`captured`. `karsen` keeps the mentor present throughout with extra ALARM/PANIC dialogue room.
`wraith` compresses ROUTINE (turns hostile fast), cuts the mentor after ROUTINE, and drags out
a hostile PANIC (where Slice 4 corruption will peak).

---

## Tagging

**Vocabulary** (theme + tone), referenced by `beatTags`:
- theme: `drift`, `trace`, `injection`, `wraith`
- tone: `calm`, `aggressive`, `technical`

**Filter semantics** (from parent §1, restated for the implementer):
- beat with **no tags** → always eligible (back-compat; this is why most beats stay untagged).
- beat **with** tags → eligible iff (no `include` set **or** shares ≥1 `include` tag) **and**
  shares **0** `exclude` tags. Exclude wins on conflict.
- `pickArc` with `arc=undefined` → `pick(pool)`, tags never consulted (invariant).
- Empty filter result → fall back to full pool (never starve).

**Tagging plan (lean):** tag a *subset* of INTRUSION/ALARM/PANIC beats by tone/theme so each
arc draws a different colour from the existing pool; ROUTINE stays largely untagged (similar
across arcs). Rough split to assign during implementation:
- aggressive/hostile intrusions+alarms → `aggressive` (a few also `wraith`).
- spec-drift / impersonal-anomaly beats → `drift` + `calm` + `technical`.
- tracking/trace-themed beats → `trace`.
- signature/injection-themed beats (canon: "i think this is signed", "module 14") → `injection`.
- calm/technical status-y beats → `calm`/`technical`.

**Guard re-pin:** adding the optional `tags` field changes `story.beats.*`, so the
`tests/script-bank-parity.test.ts` hash is **intentionally re-pinned** in Slice 2 (reviewed
change). The **golden narrative test stays green** (tags are inert when `arc=undefined`), which
is what proves behaviour preservation.

---

## Ending content (6 sets, keyed by `EndingId`)

Stored under `story.endings = { farewells: Record<EndingId,string[]>, lastWords:
Record<EndingId,{typed,abandonAt}[]> }`. `farewells` render as QUOTES lines; `lastWords.typed`
is typed at the prompt and left hanging (the string itself is the cut-off half-thought;
`abandonAt` stays `0`, matching today's convention — web `beatSilence` types the whole `typed`
and holds, so `abandonAt` is currently inert on web; kept for the data convention / native parity).

**`normal` — unchanged (today's content), preserved for the additive invariant:**
- farewells = the current 6 (`> you should have used the cold path.` … `> goodnight, officer.`)
- lastWords = the current 5 (`i was just running through the final wait someone's at the door…`, etc.)

> Note: `normal` keeps today's "someone's at the door" lastWords as-is (preservation); the
> `captured` ending below gets its own thematically-overlapping but distinct set.

**`harmonized`** (the anomaly folds back in; calm closure):
```jsonc
"farewells": [
  "> harmonization complete. the strings fold back in.",
  "> the work is the answer.",
  "> nothing followed me home tonight.",
  "> quiet again. the way it should be.",
  "> [SHIFT CLOSED // NOMINAL]"
],
"lastWords": [
  { "typed": "logging it clean. see you next rota", "abandonAt": 0 },
  { "typed": "all folded back. i think we're go", "abandonAt": 0 },
  { "typed": "going to sleep well for on", "abandonAt": 0 }
]
```

**`cold-path`** (severed the link, went dark to survive):
```jsonc
"farewells": [
  "> you should have used the cold path.",
  "> channel severed. i'm a ghost now.",
  "> better cold than traced.",
  "> they can't read a line that isn't there.",
  "> [LINK DARK // NO CARRIER]"
],
"lastWords": [
  { "typed": "pulling the jack now don't try to recon", "abandonAt": 0 },
  { "typed": "going dark. if you're reading this i'm already g", "abandonAt": 0 },
  { "typed": "cold path. should have taken it ho", "abandonAt": 0 }
]
```

**`karsen`** (mentor intervention holds the line):
```jsonc
"farewells": [
  "> stay on the line. i've got you. — INSTR-KARSEN",
  "> module 14. he was right.",
  "> karsen pulled the plug in time.",
  "> not alone after all.",
  "> [GHOSTLINK HELD // OPERATOR RECOVERED]"
],
"lastWords": [
  { "typed": "karsen are you still th", "abandonAt": 0 },
  { "typed": "okay. okay. doing what you sa", "abandonAt": 0 },
  { "typed": "tell me it's going to b", "abandonAt": 0 }
]
```

**`wraith`** (antagonist takeover; identity stolen):
```jsonc
"farewells": [
  "> it answers to my name now.",
  "> the wraith wears my designation.",
  "> i was never the operator.",
  "> whatever types next is not me.",
  "> [CONTROL TRANSFERRED // SESSION HIJACKED]"
],
"lastWords": [
  { "typed": "that's not what i typed who is wri", "abandonAt": 0 },
  { "typed": "my hands aren't on the k", "abandonAt": 0 },
  { "typed": "it's using my designat", "abandonAt": 0 }
]
```

**`captured`** (taken through the door, not the wire; system-side close):
```jsonc
"farewells": [
  "> they came through the door, not the wire.",
  "> operator did not return from break.",
  "> [SEAT VACATED // NO SIGNOUT]",
  "> [SESSION ABANDONED // CHAIR EMPTY]"
],
"lastWords": [
  { "typed": "wait someone's at the do", "abandonAt": 0 },
  { "typed": "who are y", "abandonAt": 0 },
  { "typed": "no no i didn't", "abandonAt": 0 },
  { "typed": "how did you get in h", "abandonAt": 0 }
]
```

---

## Selection, routing-safety, quantization

- **Selection** (`selectArc`): weight each `arcs[]` candidate by `weight`; dampen any id in the
  in-memory `arcsCompleted` ring buffer (N=3) so the same arc can't repeat within 3 shifts;
  pick uniformly among survivors. Empty history → pure weights. First-ever shift →
  deterministic-from-weights (test can pin a known arc), or pass `arc=undefined` to assert
  identity. Runs inside `silentReset` after blackout + persona regen, before
  `enterPhase('ROUTINE')`. `ArcState` survives `silentReset`; `peakStage` resets to 0 at shift
  start. `captured` is excluded from selection.
- **Routing safety:** Slice-2 `phaseRouting` values are acyclic forward only (skip a phase, as
  cold-path's INTRUSION→PANIC). No backward routing → no loop guard needed.
- **threat→stage quantization** (shared pure fn, twin-tested): `threat<0.15→0`,
  `<0.40→1`, `<0.70→2`, else `3` (parent §3 table), **with a `calm` flag that forces 0**.
  Per parent §3 this is **one** quantity — `corruptionStage = ArcState.threatStage` — so Slice 2
  and the Slice-4 render share the single helper. `peakStage = max(threatStage)` over the shift.
  **Decision (resolves the calm ambiguity):** because calm/reduced-motion forces `threatStage`
  to 0, `peakStage` stays 0 in reduced-motion → `divertOnThreat` never fires → reduced-motion
  always reaches `ending.default`. This is a deliberate, parent-consistent a11y flattening: the
  story still varies by arc selection / pacing / mentor, only the *threat-spike* diversions are
  suppressed. Slice 2 consumes `threatStage` only for `peakStage`/divert; the **visual** render
  is Slice 4.
- **Ending resolution** (`resolveEnding`): at PANIC→SILENCE, the first `divertOnThreat` rule with
  `atStage ≤ peakStage` wins, else `ending.default` (single-step on the **selected** arc's spec —
  a diverted ending does not re-evaluate its own diverts). Resolved `EndingId` → that ending's
  farewells/lastWords set. **`arc=undefined` ⇒ the `normal` ending set** (= today's pools), which
  is what keeps the additive-invariant golden byte-identical. Recording to `endingsReached` is
  Slice 3 (persistence).

---

## Testing (Slice-2 subset of parent §6)

1. **Additive-invariant golden** — same seed, `arc=undefined`, corruption off ⇒ beat sequence /
   timing / threat curve / persona byte-identical to today (the existing golden tests, kept
   green). Web now; native when Slice-2-native lands.
2. **`arcAllows` truth table** — include/exclude/empty/untagged matrix, identical both sides.
3. **Ending determinism** — `(arc, peakStage) → EndingId` deterministic; `divertOnThreat`
   covered at several peak timings (incl. stage-3 diverts to `cold-path`/`captured`).
4. **Arc selection + routing parity (LCG)** — pinned seed, frozen ring buffer ⇒ identical arc
   choice, `pickArc` filtering, phase routing. Cross-platform test runs when native lands.
5. **`script-bank-parity` re-pin** — re-pinned after tagging; reviewed as an intentional change.

---

## Decisions log (2026-06-28)

1. Next step after Slice 1 → **Slice 2 web** (first user-visible payoff; autonomous).
2. Content ambition → **lean + tagged** (mechanism + templates + endings + tag existing beats;
   no new antagonist prose this slice).
3. 5-arc bible (weights, antagonists, mentor availability, routing/pacing, endings, diverts) →
   approved as the table above.
4. Tag vocabulary (`drift/trace/injection/wraith` + `calm/aggressive/technical`), untagged =
   universal, guard re-pinned after tagging → approved.
5. Ending content (6 sets; `normal` = today's, 5 new in canon voice) → approved (full sets above).
6. Scope boundary: corruption render (4), scenes (7), threatCurve (8), persistence (3),
   false-all-clear backward routing → all OUT of Slice 2; web/native split at the 1.3 boundary.
