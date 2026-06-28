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
