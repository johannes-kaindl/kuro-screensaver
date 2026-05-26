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
}

export type SceneUpdater = (t: number, dt: number) => void;

export interface SceneModule {
  build(ctx: SceneCtx): SceneUpdater;
  modeLabels: readonly string[];
  triCount: string;
}
