// Common scene contract.
import * as THREE from 'three';
import type { MaterialPool } from '../materials';
import type { ScreensaverSettings } from '../../data/defaults';

export interface SceneCtx {
  scene: THREE.Scene;
  world: THREE.Group;
  cam: THREE.PerspectiveCamera;
  mats: MaterialPool;
  rng: () => number;
  settings: ScreensaverSettings;
  /** Reactive-world signal (0..1), live per frame. Optional — scenes that don't
   *  read it are unaffected. `storm` is the high-threat payoff scalar. */
  threat?: () => number;
  storm?: () => number;
}

export type SceneUpdater = (t: number, dt: number) => void;

export interface SceneModule {
  build(ctx: SceneCtx): SceneUpdater;
  modeLabels: readonly string[];
  triCount: string;
}
