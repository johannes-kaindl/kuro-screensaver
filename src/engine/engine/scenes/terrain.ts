import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';

// Heightfield is a pure function of LOGICAL world position. Each chunk carries
// its own constant logicalOffset (NOT its rendered position.z). The offset only
// changes when the chunk wraps to the back; during normal scrolling it stays put,
// so per-vertex heights stay constant per cycle → the chunk's hills travel
// forward with the chunk geometry (= forward-flight illusion preserved, no
// wave-like undulation).
//
// At the seam, neighbour-chunk offsets always differ by exactly D (chunk length),
// matching the local-z gap of 2·(D/2) = D between the meeting edges → heights
// agree at the boundary, no visible discontinuity.
const heightAt = (x: number, z: number): number =>
  Math.sin(x * 0.33) * Math.cos(z * 0.2) * 2.8 +
  Math.sin(x * 0.77 + z * 0.26) * 0.95 +
  Math.cos(x * 0.16 - z * 0.13) * 1.8;

export const TerrainScene: SceneModule = {
  modeLabels: ['RECON', 'SWEEP', 'PATROL'] as const,
  triCount: '23K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, rng, scene } = ctx;

    cam.position.set(0, 6, 0); cam.rotation.set(-0.22, 0, 0);
    scene.fog = new THREE.FogExp2(0x000000, 0.012);
    const fly = new CameraFly(Math.floor(rng() * 2e9), 12, 2.6, 6.5, -0.2, ctx.settings.bankStrength);
    // Sweeping course-change state (seeded one-direction banked arc, eased in/out).
    const COURSE_AMP = 38, COURSE_DUR = 12;
    let courseT0 = 8 + rng() * 10, courseDir = rng() < 0.5 ? -1 : 1;

    // Width 280 chosen so even at FOV 72° + camera y=6 the lateral edges sit well
    // beyond the visible cone — no horizon-edge artifacts. Lateral seg count scaled
    // proportionally (was 80 across 90 → ~1.1u/seg; now 140 across 280 → 2u/seg).
    const D = 180, WIDTH = 280, SEG_W = 140, SEG_L = 130;
    const mkGeo = () => {
      const g = new THREE.PlaneGeometry(WIDTH, D, SEG_W, SEG_L);
      g.rotateX(-Math.PI / 2); return g;
    };
    const g1 = mkGeo(), g2 = mkGeo();
    const t1 = new THREE.Mesh(g1, mats.M({ transparent: true, opacity: 0.8 }));
    const t2 = new THREE.Mesh(g2, mats.M({ transparent: true, opacity: 0.75 }));
    t1.position.z = -40; t2.position.z = -40 - D;
    world.add(t1, t2);

    // Logical offsets — start equal to initial position.z. They DO NOT track
    // the chunk's rendered position; they only decrement by 2·D on each wrap.
    // This preserves "hills travel with the chunk geometry" while keeping the
    // seam between neighbour chunks mathematically continuous.
    let logicalA = t1.position.z;       // -40
    let logicalB = t2.position.z;       // -40 - D
    // Invariant: |logicalB - logicalA| === D at all times.

    // (Distant silhouette plane removed — the foreground heightfield already
    // forms a strong horizon line; the previous abs(sin) silhouette read as a
    // row of identical croissants, no atmospheric value.)

    // Stars
    const sv: number[] = [];
    for (let i = 0; i < 1000; i++) sv.push((rng() - 0.5) * 400, rng() * 70 + 5, -(rng() * 400 + 10));
    const sg2 = new THREE.BufferGeometry();
    sg2.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    world.add(new THREE.Points(sg2, mats.MP(0.13)));

    // Dust drift (NEW from v2 patterns)
    const dv: number[] = [];
    for (let i = 0; i < 500; i++) dv.push((rng() - 0.5) * 60, rng() * 18 + 1, -(rng() * 200 + 5));
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dv, 3));
    const dust = new THREE.Points(dg, mats.MP(0.06));
    world.add(dust);

    const p1 = g1.attributes.position, p2 = g2.attributes.position;

    // Heightfield depends only on (x, z + logicalOffset) — both constant between
    // wraps — so we sample once at build time and re-sample only when a chunk
    // wraps. Was previously ~37k setY+ 2 normal recomputes per frame.
    const sampleChunk = (geom: THREE.PlaneGeometry, attr: THREE.BufferAttribute, logicalZ: number) => {
      for (let i = 0; i < attr.count; i++) attr.setY(i, heightAt(attr.getX(i), attr.getZ(i) + logicalZ));
      attr.needsUpdate = true;
      geom.computeVertexNormals();
    };
    sampleChunk(g1, p1 as THREE.BufferAttribute, logicalA);
    sampleChunk(g2, p2 as THREE.BufferAttribute, logicalB);

    return (t: number, _dt: number) => {
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.2;
      t1.position.z += spd; t2.position.z += spd;
      if (t1.position.z > D / 2 + 12) {
        t1.position.z -= D * 2; logicalA -= D * 2;
        sampleChunk(g1, p1 as THREE.BufferAttribute, logicalA);
      }
      if (t2.position.z > D / 2 + 12) {
        t2.position.z -= D * 2; logicalB -= D * 2;
        sampleChunk(g2, p2 as THREE.BufferAttribute, logicalB);
      }

      const f = fly.sample(t, (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.2 * 60);
      // Long banked course-change layered on the weave — reads as a sweeping turn over
      // the open terrain (the ground still scrolls from -Z, but nothing contradicts it).
      let cs = 0;
      const cel = t - courseT0;
      if (cel >= 0 && cel < COURSE_DUR) { const s = Math.sin(Math.PI * (cel / COURSE_DUR)); cs = s * s; }
      else if (cel >= COURSE_DUR) { courseT0 = t + 10 + rng() * 14; courseDir = rng() < 0.5 ? -1 : 1; }
      cam.position.x = f.x + courseDir * COURSE_AMP * cs;
      cam.position.y = f.y;
      cam.rotation.set(f.pitch, f.yaw + courseDir * 0.22 * cs, f.roll + courseDir * 0.18 * cs);

      // Terrain-following: never let the flight path sink into a hill. Sample the
      // heightfield under + just ahead of the camera and keep ≥2.6u clearance —
      // low over valleys, lifts over ridges (proper NOE flight, no clipping).
      const groundAt = (wz: number): number => {
        const useT1 = Math.abs(wz - t1.position.z) <= D / 2;
        return heightAt(cam.position.x, wz - (useT1 ? t1.position.z : t2.position.z) + (useT1 ? logicalA : logicalB));
      };
      const ground = Math.max(groundAt(0), groundAt(-12), groundAt(-24));
      cam.position.y = Math.max(f.y, ground + 2.6);

      // Stream dust TOWARD + past the camera so it flies by (the world forward-scrolls,
      // so the dust must too — otherwise it sits at a constant distance from the POV).
      const dp = dg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dp.count; i++) {
        let dz = dp.getZ(i) + spd;
        if (dz > 6) dz -= 210;            // recycle past the camera → back to the far plane
        dp.setZ(i, dz);
      }
      dp.needsUpdate = true;

      // Dust drifts laterally; under the narrative PANIC storm it whips + brightens.
      const storm = ctx.storm?.() ?? 0;
      dust.position.x = Math.sin(t * 0.07) * 4 + storm * 12 * Math.sin(t * 3.1);
      (dust.material as THREE.PointsMaterial).size = 0.06 + storm * 0.14;
    };
  },
};
