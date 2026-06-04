// Transition profiles — the choreography for a warp scene change. A small data table
// so web/native stay in lockstep. Brick B: a generic DEFAULT + the terrain→city hero.
import type { SceneId } from '../data/defaults';

export interface TransitionProfile {
  windupDur: number;   // s — wind-up (climb / centre)
  warpDur: number;     // s — accelerate, streak, swap at the peak (mid-warp)
  emergeDur: number;   // s — ease back, descend, hand to the scene
  warpSpeed: number;   // peak speedMul during the warp
  fovPush: number;     // degrees added to base FOV at the warp peak
  climbPitch?: number; // windup nose-up (radians); hero only
  entryAltitude?: number; // emerge starts cam.y here, eases to the scene's natural y; hero only
}

export const DEFAULT_TRANSITION: TransitionProfile = {
  windupDur: 0.6, warpDur: 1.4, emergeDur: 1.0, warpSpeed: 6, fovPush: 28,
};

const HERO: Partial<Record<`${SceneId}>${SceneId}`, TransitionProfile>> = {
  'terrain>city': {
    windupDur: 1.2, warpDur: 1.6, emergeDur: 2.2, warpSpeed: 7, fovPush: 32,
    climbPitch: 0.28, entryAltitude: 60,
  },
};

/** calm mode (prefers-reduced-motion): a short, motion-light transition that still swaps. */
export const CALM_TRANSITION: TransitionProfile = {
  windupDur: 0.2, warpDur: 0.5, emergeDur: 0.4, warpSpeed: 1.6, fovPush: 0,
};

export function profileFor(from: SceneId, to: SceneId, calm = false): TransitionProfile {
  if (calm) return CALM_TRANSITION;
  return HERO[`${from}>${to}`] ?? DEFAULT_TRANSITION;
}
