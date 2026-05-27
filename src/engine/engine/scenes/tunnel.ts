// TUNNEL — curved 3D spine with rings, banking flight, motion-inertia drift,
// auto-boost on straight segments with motion-blur trails + FOV push.
//
// Visual layers (back-to-front):
//   • Inner spiral spine tube (subtle wireframe)
//   • Floor neon strip (line geometry along curve, brighter near camera)
//   • Primary rings every RING_SPACING with 8 spokes
//   • Cross-bars every 5th ring
//   • Secondary rings every 8th
//   • Beacon spheres on every 4th ring (additive, blink-pulsed)
//   • Parallel detail tube offset laterally (gives depth cue)
//   • Forward-streaming speed particles
//
// Camera follows curve via parameter u; bank-roll + pull-up pitch are computed
// from local curvature (second-derivative of curve direction) and lerped with
// damping → gives the inertia/banking flight feel.
//
// Boost cycle: when curvature stays under threshold for N frames, speedMul
// ramps to 2.5×, AfterimagePass damp climbs (motion blur), FOV pushes 16°,
// camera shake adds high-freq jitter, audio fires jet-crescendo. Resumes when
// next curve arrives.

import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';

const RING_COUNT     = 140;        // dense rings for depth
const RING_SPACING   = 5;          // along-curve units between rings
const BEACON_EVERY   = 4;
const PARTICLE_COUNT = 200;
const PARTICLE_RANGE = 0.05;       // forward-stream u distance

type SegType = 'curve' | 'straight';

function buildSpine(rng: () => number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
  let cursor = new THREE.Vector3(0, 0, 0);
  let dir    = new THREE.Vector3(0, 0, -1);

  let total = 0;
  while (total < RING_COUNT) {
    const isCurve: SegType = rng() < 0.55 ? 'curve' : 'straight';
    if (isCurve === 'curve') {
      const len   = 5 + Math.floor(rng() * 4);
      const turn  = (rng() - 0.5) * 0.9;
      const climb = (rng() - 0.5) * 0.45;
      for (let i = 0; i < len; i++) {
        const r = new THREE.Euler(climb / len, turn / len, 0);
        dir = dir.clone().applyEuler(r).normalize();
        cursor = cursor.clone().add(dir.clone().multiplyScalar(RING_SPACING));
        pts.push(cursor.clone());
        total++;
      }
    } else {
      const len = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < len; i++) {
        cursor = cursor.clone().add(dir.clone().multiplyScalar(RING_SPACING));
        pts.push(cursor.clone());
        total++;
      }
    }
  }
  // v1.2 — Live-Test 2026-05-13: append a closure-arc so the spine ends where
  // it began (with matching tangents). The CatmullRomCurve3 below uses
  // closed:true and gets a smooth wrap — no more visible "tunnel restart" jump
  // when camera.u wraps 0.999 → 0.
  return closeSpine(pts);
}

/**
 * Append a smooth cubic-bezier-style arc from the spine's end back to its
 * start. Tangents at both ends match the in/out directions of the spine so
 * CatmullRomCurve3(closed:true) interpolates seamlessly across the seam.
 *
 * Sample count scales with the gap distance so ring spacing stays roughly
 * uniform across the closure segment.
 */
function closeSpine(pts: THREE.Vector3[]): THREE.Vector3[] {
  if (pts.length < 4) return pts;
  const last     = pts[pts.length - 1];
  const lastPrev = pts[pts.length - 2];
  const first    = pts[0];
  const second   = pts[1];

  const lastDir  = last.clone().sub(lastPrev).normalize();
  const firstDir = second.clone().sub(first).normalize();

  const gap = last.distanceTo(first);
  const closureSamples = Math.max(20, Math.floor(gap / RING_SPACING) + 12);

  // Cubic-bezier control points — push tangents ~35% of gap into space so the
  // arc curves smoothly rather than snapping toward the origin.
  const d  = gap * 0.35;
  const p1 = last.clone().add(lastDir.clone().multiplyScalar(d));
  const p2 = first.clone().sub(firstDir.clone().multiplyScalar(d));

  // de Casteljau evaluation. Stop one step short of `first` — closed:true
  // will weld last→first automatically and we don't want a duplicate vertex.
  for (let i = 1; i < closureSamples; i++) {
    const t = i / closureSamples;
    const a  = last.clone().lerp(p1, t);
    const b  = p1.clone().lerp(p2, t);
    const c  = p2.clone().lerp(first, t);
    const ab = a.clone().lerp(b, t);
    const bc = b.clone().lerp(c, t);
    pts.push(ab.clone().lerp(bc, t));
  }
  return pts;
}

export const TunnelScene: SceneModule = {
  modeLabels: ['INFIL', 'TRANSIT', 'BOOST'] as const,
  triCount: '~62K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, rng, settings } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.024);

    const spinePts = buildSpine(rng);
    // v1.2 — closed:true makes the curve cyclic. Combined with the closure
    // segment appended in buildSpine() this gives a seamless infinite loop
    // when camera.u wraps from 0.999 back to 0.
    const curve = new THREE.CatmullRomCurve3(spinePts, true, 'catmullrom', 0.5);

    // Pre-compute Frenet frames once — used for ring placement and parallel tube.
    const samples = RING_COUNT;
    const frenet = curve.computeFrenetFrames(samples, false);

    // ── Primary rings + spokes ──
    interface Beacon { mesh: THREE.Mesh; phase: number; speed: number; }
    const beacons: Beacon[] = [];

    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1);
      const p = curve.getPointAt(u);
      const T = frenet.tangents[i];
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), T);
      const grp = new THREE.Group();
      grp.position.copy(p);
      grp.quaternion.copy(q);

      const r = 4 + Math.sin(i * 0.4) * 0.7;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.07, 6, 64),
        mats.M({ transparent: true, opacity: 0.78 }),
      );
      grp.add(ring);

      // v1.2 — Live-Test 2026-05-13: Jay preferred clean rings. The 8-spoke
      // wagon-wheel pattern read as "crosses" in the tunnel center,
      // overlapping when looking forward through several rings at once.
      // Rings + cross-bars (already removed) + secondary rings + parallel
      // tube + floor neon strip + beacons still provide enough depth cue.

      // v1.2 — Cross-bars removed (Live-Test 2026-05-13).
      // The horizontal+vertical box pair every 5th ring read visually as a
      // tunnel obstacle / "+"-shaped barrier rather than as structural detail.
      // Rings + spokes + secondary rings + parallel detail tube already
      // provide enough depth cue without them.

      // Secondary inner ring every 8
      if (i % 8 === 0 && i > 0) {
        const r2 = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.35, 0.04, 4, 32),
          mats.M({ transparent: true, opacity: 0.4 }),
        );
        grp.add(r2);
      }

      // Beacon spheres every Nth ring — additive material → bright dots
      if (i % BEACON_EVERY === 0 && i > 0) {
        for (const dx of [-1, 1]) {
          const bm = mats.MSolid(0.95);
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), bm);
          b.position.set(dx * (r - 0.4), 0, 0);
          grp.add(b);
          beacons.push({ mesh: b, phase: rng() * Math.PI * 2, speed: 0.7 + rng() * 1.6 });
        }
      }

      world.add(grp);
    }

    // v1.2 — Live-Test 2026-05-13: removed inner spine tube + parallel
    // detail tube. With closeSpine() the parallel tube's offset relied on
    // `frenet.normals[i]` clamped to samples-1 — the last ~20 closure-arc
    // points all got the SAME normal, producing a spiral "spinning strand"
    // through the tunnel center where the seam closes. The inner spine
    // tube ran along the curve too and showed the same artifact at the
    // seam. Rings + secondary rings + floor strip + beacons + particles
    // already give plenty of depth cue without these two layers.

    // ── Floor neon strip — line geometry hugging bottom of tunnel along curve ──
    const floorPts: number[] = [];
    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1);
      const p = curve.getPointAt(u);
      const B = frenet.binormals[i];
      const floor = p.clone().sub(B.clone().multiplyScalar(3.6));
      floorPts.push(floor.x, floor.y, floor.z);
    }
    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(floorPts, 3));
    world.add(new THREE.Line(floorGeo, mats.ML(0.62)));

    // ── Forward-streaming speed particles ──
    interface Particle { u: number; offX: number; offY: number; }
    const particles: Particle[] = [];
    const partGeo = new THREE.BufferGeometry();
    const partPos = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        u: rng(),
        offX: (rng() - 0.5) * 6,
        offY: (rng() - 0.5) * 6,
      });
      partPos[i * 3] = 0; partPos[i * 3 + 1] = 0; partPos[i * 3 + 2] = 0;
    }
    partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
    const particles3d = new THREE.Points(partGeo, mats.MP(0.08));
    world.add(particles3d);

    // ── Camera + flight state ──
    // Design rule: gaze always points forward along the curve tangent (via lookAt).
    // Only the BANK (roll around forward axis = Z) is animated — rolling rotates the
    // horizon without moving the gaze. Pitch (around X) and yaw (around Y) would
    // tilt the view away from the tangent and produce the "chaotic perspective"
    // sensation, so they are intentionally NOT applied here.
    let u = 0;
    let currentRoll = 0;
    const baseFov = cam.fov;

    // Boost cycle
    let speedMul = 1;
    let speedMulTarget = 1;
    let straightFrames = 0;
    let inBoost = false;

    cam.position.copy(curve.getPointAt(0));
    cam.lookAt(curve.getPointAt(0.001));

    const state = { boost: false, speedMul: 1, u: 0 };
    (this as any).state = state;

    return (t: number, dt: number) => {
      const sceneSpeed = SPEED_VALUES[ctx.settings.speed];
      // ── SPEED CALIBRATION ──
      // ~1 full traversal of the curve in 24 seconds at 'norm' speed.
      // Boost multiplies up to 2.5× → ~10s straight burst.
      const baseStep = sceneSpeed * 0.000028 * dt * speedMul;
      u = (u + baseStep) % 1;
      state.u = u;

      // v1.2 — Seamless loop: with closed:true the curve is cyclic, but
      // getPointAt(u) still requires u ∈ [0,1]. The old clamp(v) snapped
      // ahead/farr to 0.999 near the end of the spine, freezing camera
      // direction at the wrap point. Replaced with modulo wrap so ahead/farr
      // sample the closure-arc and the start of the curve seamlessly.
      const wrap = (v: number) => ((v % 1) + 1) % 1;
      const here  = curve.getPointAt(wrap(u));
      const ahead = curve.getPointAt(wrap(u + 0.005));
      const farr  = curve.getPointAt(wrap(u + 0.025));

      // Curvature: difference of consecutive normalized tangents.
      // Magnitude ≈ sin(angle-between-tangents); typical values 0.005–0.08 in our spines.
      const tan1 = ahead.clone().sub(here).normalize();
      const tan2 = farr.clone().sub(ahead).normalize();
      const curveDelta = tan2.clone().sub(tan1);
      const curvLat = curveDelta.x;          // lateral (used for bank only)
      const curvMag = curveDelta.length();    // for boost detection

      // Boost trigger
      if (settings.tunnelAutoBoost && curvMag < 0.0015) {
        straightFrames++;
        if (straightFrames > 30 && !inBoost) {
          inBoost = true;
          speedMulTarget = 2.5;
          state.boost = true;
        }
      } else {
        straightFrames = 0;
        if (inBoost) {
          inBoost = false;
          speedMulTarget = 1;
          state.boost = false;
        }
      }
      speedMul += (speedMulTarget - speedMul) * 0.05;
      state.speedMul = speedMul;

      // Camera always faces the curve's forward tangent — gaze is locked.
      cam.position.copy(here);
      cam.lookAt(ahead);

      // Banking — roll around the FORWARD axis only. This kips the horizon to
      // "feel" the turn without moving the view away from the tangent. Multiplier
      // ~8 gives a max bank of ~25° on tight bends; lerp damping ~0.04 = ~25-frame
      // settle time, which is the inertia / mass-feel.
      const targetRoll = -curvLat * 8;
      currentRoll += (targetRoll - currentRoll) * 0.04;
      cam.rotateZ(currentRoll);

      // Boost: gentle FOV push + very small position shake.
      // No rotational shake — would break the forward-gaze invariant.
      const boostFov = inBoost ? 10 : 0;
      cam.fov += (baseFov + boostFov - cam.fov) * 0.07;
      cam.updateProjectionMatrix();
      if (inBoost) {
        cam.position.x += (Math.random() - 0.5) * 0.025;
        cam.position.y += (Math.random() - 0.5) * 0.025;
      }

      // Beacon pulse
      for (const b of beacons) {
        const v = (Math.sin(t * b.speed + b.phase) + 1) / 2;
        (b.mesh.material as any).opacity = 0.2 + v * 0.75;
      }

      // Stream particles forward — each particle holds its u-offset into the
      // window [u .. u+PARTICLE_RANGE]; once it passes camera (offset → 0), wrap.
      const arr = partGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.u -= baseStep * 1.3 / PARTICLE_RANGE; // drift relative
        if (p.u < 0) p.u += 1;
        const targetU = (u + p.u * PARTICLE_RANGE) % 1;
        const pp = curve.getPointAt(wrap(targetU));
        arr[i * 3]     = pp.x + p.offX;
        arr[i * 3 + 1] = pp.y + p.offY;
        arr[i * 3 + 2] = pp.z;
      }
      partGeo.attributes.position.needsUpdate = true;
    };
  },
};
