// THE RIFT — flying through a vertical tear in space.
//
// Two parallel walls of jagged wireframe geometry, infinitely tall (top and bottom
// are well off-screen). No floor, no scattered objects — pure architectural
// emptiness with sporadic full-roll dynamics.
//
// The "rift" feeling comes from:
//   • Wall edges never visible (height 220, centered at camera Y → ±110 from view)
//   • Wall length 280 > fog-visible distance (≈ 150 at fog density 0.014) → far ends
//     dissolve into the dark
//   • Sporadic 360° barrel rolls (every 30–90 s) for dynamic punctuation
//   • Slow lateral camera drift suggesting wide passage
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';
import { mkRng } from '../rng';

const CHUNK_LEN     = 280;       // > fog-visible range — far ends always invisible
const WALL_X_OFFSET = 13;        // half-distance between left/right walls
const WALL_HEIGHT   = 220;       // top/bottom always off-screen at camera y=8
const SEG_Z         = 36;
const SEG_Y         = 22;

const ROLL_DURATION = 1.8;       // seconds for one full 360° barrel roll
const ROLL_GAP_MIN  = 30;        // seconds between rolls
const ROLL_GAP_MAX  = 90;

// Wall noise is PERIODIC with period CHUNK_LEN. Because the chunks tile every
// CHUNK_LEN unit of travel, a periodic noise function automatically matches at
// chunk boundaries → no visible seams, ever. Frequencies are integer multiples of
// the base wavenumber 2π/CHUNK_LEN; this is what makes the function periodic.
//
// We also avoid using rng() in the displacement formula — different chunks have
// different RNG seeds, so any rng() phase contribution would mismatch at seams.
// Per-side variety is injected via a deterministic side*N constant instead.
const K_BASE = 2 * Math.PI / CHUNK_LEN;     // ≈ 0.02244 — fundamental wavenumber

function buildWall(grp: THREE.Group, mats: SceneCtx['mats'], side: number, _seed: number) {
  // PlaneGeometry(width, height) lies in XY. After rotateY(PI/2):
  //   "width" axis (originally X) → Z; "height" axis (originally Y) → still Y.
  // Result: a vertical wall with width along Z and height along Y, normal along X.
  const g = new THREE.PlaneGeometry(CHUNK_LEN, WALL_HEIGHT, SEG_Z, SEG_Y);
  g.rotateY(Math.PI / 2);

  // Displace vertices along X (toward/away from camera path) for jagged texture.
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // All z-frequencies are integer multiples of K_BASE → period matches chunk length.
    const noise =
      Math.sin(z * 2  * K_BASE + side * 12) * 4   +
      Math.cos(z * 5  * K_BASE + y * 0.05)  * 2.2 +
      Math.sin(z * 12 * K_BASE + y * 0.03 + side * 7) * 1.4;
    pos.setX(i, side * noise);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();

  const wall = new THREE.Mesh(g, mats.M({ transparent: true, opacity: 0.55 }));
  wall.position.x = side * WALL_X_OFFSET;   // push wall to its side of the corridor
  wall.position.y = 8;                       // center on camera Y → equal margin top/bottom
  grp.add(wall);
}

export const RiftScene: SceneModule = {
  cameraLocked: true,   // path-locked corridor: no kick overlay (stay in the rift)
  modeLabels: ['THE RIFT', 'CHASM', 'INVERSION'] as const,
  triCount: '~22K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, rng } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.014);

    // Both chunks build identical wall geometry — by design. The periodic noise
    // tiles seamlessly across the chunk boundary, so visual repetition is the
    // intended (and seam-free) behavior. Different per-chunk seeds would re-introduce
    // a seam mismatch (different rng phases) which is exactly what we eliminated.
    const cA = new THREE.Group(), cB = new THREE.Group();
    buildWall(cA, mats, -1, 0);
    buildWall(cA, mats, +1, 0);
    buildWall(cB, mats, -1, 0);
    buildWall(cB, mats, +1, 0);
    cA.position.z = -CHUNK_LEN / 2;
    cB.position.z = -CHUNK_LEN / 2 - CHUNK_LEN;
    world.add(cA, cB);

    // Distant stars — high above so still visible during inversion
    const sv: number[] = [];
    for (let i = 0; i < 800; i++) {
      sv.push((rng() - 0.5) * 220, 30 + rng() * 130, -(rng() * 600 + 60));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    world.add(new THREE.Points(sg, mats.MP(0.11)));

    cam.position.set(0, 8, 0);
    cam.rotation.set(-0.06, 0, 0);

    // ── Barrel-roll state ──
    let nextRollT  = 25 + rng() * 30;     // first roll after 25–55 s
    let rollActive = false;
    let rollStartT = 0;
    let currentRoll = 0;                   // current Z-rotation contribution from roll

    return (t: number, _dt: number) => {
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.22;
      cA.position.z += spd; cB.position.z += spd;
      if (cA.position.z > CHUNK_LEN / 2 + 8) cA.position.z -= CHUNK_LEN * 2;
      if (cB.position.z > CHUNK_LEN / 2 + 8) cB.position.z -= CHUNK_LEN * 2;

      // Gentle lateral + vertical drift
      cam.position.x = Math.sin(t * 0.08) * 2.4;
      cam.position.y = 8 + Math.sin(t * 0.27) * 0.5;
      cam.rotation.x = -0.06;
      cam.rotation.y = Math.cos(t * 0.08) * 0.03;

      // Barrel-roll trigger / progress
      if (!rollActive && t > nextRollT) {
        rollActive = true;
        rollStartT = t;
      }
      if (rollActive) {
        const phase = (t - rollStartT) / ROLL_DURATION;
        if (phase >= 1) {
          rollActive = false;
          currentRoll = 0;
          nextRollT = t + ROLL_GAP_MIN + ctx.rng() * (ROLL_GAP_MAX - ROLL_GAP_MIN);
        } else {
          // Cosine ease-in-out → smooth start + end, no jolt
          const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
          currentRoll = eased * Math.PI * 2;     // full 360° (passes through 180° = inverted at midpoint)
        }
      }

      // Z = base subtle sway + barrel-roll contribution
      cam.rotation.z = Math.sin(t * 0.08) * 0.04 + currentRoll;
    };
  },
};
