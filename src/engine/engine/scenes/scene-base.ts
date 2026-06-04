// Common scene contract.
import * as THREE from 'three';
import type { MaterialPool } from '../materials';
import type { ScreensaverSettings } from '../../data/defaults';

export interface SceneCtx {
  scene: THREE.Scene;
  world: THREE.Group;
  cam: THREE.PerspectiveCamera;
  mats: MaterialPool;
  /** Second pool for the "enemy" infection — scenes tag an infectable subset with it. */
  enemyMats?: MaterialPool;
  rng: () => number;
  settings: ScreensaverSettings;
  /** Reactive-world signal (0..1), live per frame. Optional — scenes that don't
   *  read it are unaffected. `storm` is the high-threat payoff scalar. */
  threat?: () => number;
  storm?: () => number;
  /** Effective forward-speed multiplier = SPEED_VALUES[settings.speed] × director.
   *  Scenes should read this instead of the enum directly (enables warp ramps). */
  speed?: () => number;
}

export type SceneUpdater = (t: number, dt: number) => void;

export interface SceneModule {
  build(ctx: SceneCtx): SceneUpdater;
  modeLabels: readonly string[];
  triCount: string;
  /** Corridor scenes (tunnel/rift): the camera is path-locked, so the director's
   *  kick/manoeuvre overlay is skipped (it would break the camera out of the tube).
   *  Transitions still own the camera. */
  cameraLocked?: boolean;
}
