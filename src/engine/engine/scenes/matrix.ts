// MATRIX — pure digital-rain scene (no 3D geometry). Mirrors the native MatrixScene:
// the screen IS the rain. The Engine force-enables the matrix composite pass while
// this scene is active (Engine.updateMatrixEnabled), so selecting MATRIX shows the
// cinematic 5-layer rain on black — bloomed + CRT-curved, coloured by the active
// preset. The `matrix` FX toggle is separate: it overlays the same rain on ANY scene.
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';

export const MatrixScene: SceneModule = {
  modeLabels: ['RAIN', 'CASCADE', 'DELUGE'] as const,
  triCount: '0',

  build(ctx: SceneCtx): SceneUpdater {
    const { scene, cam } = ctx;
    scene.fog = null;             // nothing to fog — the rain is screen-space (composite pass)
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    // Static: RenderPass draws an empty (black) scene; the rain is the matrix pass.
    return () => { /* no per-frame world update */ };
  },
};
