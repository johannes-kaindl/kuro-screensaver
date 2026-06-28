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

// ── Cross-session story memory (Slice 3; persisted in ScreensaverSettings.story) ──────
export interface StoryMemory {
  schema: number;
  layerCounter: number;                        // completed shifts → escalation baseline
  arcsCompleted: string[];                      // ring buffer, last 3 → anti-repeat
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
