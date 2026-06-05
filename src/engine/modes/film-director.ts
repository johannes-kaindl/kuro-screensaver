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
  PANIC:     ['tunnel', 'void', 'wreckage'],
  SILENCE:   ['void', 'wreckage'],
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
