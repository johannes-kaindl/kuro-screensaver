// VOID — asteroid-field flythrough. Forward-flight + side-drift + tiny yaw/pitch.
// Streaming pool (spawn ahead, recycle behind), belt-density on Y, no-spawn-zone forward.
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';

export const VoidScene: SceneModule = {
  modeLabels: ['DRIFT', 'BELT', 'SWARM'] as const,
  triCount: '20K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, rng } = ctx;

    scene.fog = new THREE.FogExp2(0x000000, 0.0045);   // matches native VoidScene (a bit further view distance)
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);

    // ── Geometry templates (re-used across asteroids) ──────────────────
    // Detail-2 ico ≈ 320 tri · Detail-1 ico ≈ 80 · Detail-0 ico ≈ 20
    // Dodeca ≈ 36 · Irregular (icosa+displacement, detail-1) ≈ 80
    interface Tpl { geo: THREE.BufferGeometry; w: number }
    const TPL: Tpl[] = [];
    TPL.push({ geo: new THREE.IcosahedronGeometry(1, 2), w: 0.20 });
    TPL.push({ geo: new THREE.IcosahedronGeometry(1, 1), w: 0.32 });
    TPL.push({ geo: new THREE.IcosahedronGeometry(1, 0), w: 0.18 });
    TPL.push({ geo: new THREE.DodecahedronGeometry(1),    w: 0.15 });
    {
      const irr = new THREE.IcosahedronGeometry(1, 1);
      const pos = irr.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const j = 0.62 + rng() * 0.55;
        pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
      }
      irr.computeVertexNormals();
      TPL.push({ geo: irr, w: 0.15 });
    }
    const cumW: number[] = [];
    { let acc = 0; for (const t of TPL) { acc += t.w; cumW.push(acc); } }
    const pickGeo = (): THREE.BufferGeometry => {
      const r = rng() * cumW[cumW.length - 1];
      for (let i = 0; i < cumW.length; i++) if (r < cumW[i]) return TPL[i].geo;
      return TPL[0].geo;
    };

    // ── Field params ────────────────────────────────────────────────────
    const POOL    = 90;      // simultaneous asteroids
    const FAR     = -68;     // spawn z (relative to camera, always ahead)
    const FAR_VAR = 45;      // additional random depth at spawn (broad)
    const BEHIND  = 10;      // recycle when this far behind camera
    const FIELD_W = 44;      // x half-width
    const BELT_S  = 14;      // belt sigma on y (gauss-like, 3D-volume)
    const OFFBELT_P = 0.08;  // probability for off-belt y (uniform ±25)
    const NOSPAWN = 5.5;     // cylinder radius around predicted flight path
    const SCALE_MIN = 0.9, SCALE_SPAN = 3.0;  // 0.9-3.9 range

    // Y: gauss-like belt with rare wide off-belt outliers (3D volume, not disk).
    const sampleBeltY = () => {
      if (rng() < OFFBELT_P) return (rng() - 0.5) * 50;  // uniform ±25
      return ((rng() - 0.5) + (rng() - 0.5)) * BELT_S * 1.6;
    };

    // Cylinder check around the predicted flight path (camera xy projected forward).
    const inFlightTube = (x: number, y: number, cx: number, cy: number) => {
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy < NOSPAWN * NOSPAWN;
    };

    // initial seed: spread over corridor depth, reserve a near-zone (camera +18)
    // so the scene doesn't open inside a swarm. Camera starts at (0,0,0).
    const seedInitial = () => {
      const seedZ = () => -18 - rng() * (Math.abs(FAR) + FAR_VAR - 18);
      for (let tries = 0; tries < 5; tries++) {
        const x = (rng() - 0.5) * 2 * FIELD_W;
        const y = sampleBeltY();
        const z = seedZ();
        if (!inFlightTube(x, y, 0, 0)) return { x, y, z };
      }
      // fall through with edge-of-tube offset
      const side = rng() < 0.5 ? -1 : 1;
      return { x: side * (NOSPAWN + 1.5 + rng() * 10), y: sampleBeltY(), z: seedZ() };
    };

    // re-spawn ahead of camera, rejection-sample out of the flight tube.
    const respawn = (camX: number, camY: number, camZ: number) => {
      for (let tries = 0; tries < 5; tries++) {
        const x = (rng() - 0.5) * 2 * FIELD_W;
        const y = sampleBeltY();
        if (!inFlightTube(x, y, camX, camY))
          return { x, y, z: camZ + FAR - rng() * FAR_VAR };
      }
      // skip-frame fallback: push behind recycleZ so we try again next frame
      return null;
    };

    interface Ast { mesh: THREE.Mesh; rx: number; ry: number; rz: number }
    const asteroids: Ast[] = [];
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(
        pickGeo(),
        mats.M({ transparent: true, opacity: 0.60 + rng() * 0.30 }),
      );
      mesh.scale.setScalar(SCALE_MIN + rng() * SCALE_SPAN);
      const p = seedInitial();
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      world.add(mesh);
      asteroids.push({
        mesh,
        rx: (rng() - 0.5) * 0.024,
        ry: (rng() - 0.5) * 0.024,
        rz: (rng() - 0.5) * 0.020,
      });
    }

    // ── Starfield (kept) ────────────────────────────────────────────────
    const sv: number[] = [];
    for (let i = 0; i < 2200; i++)
      sv.push((rng() - 0.5) * 240, (rng() - 0.5) * 140, (rng() - 0.5) * 260 - 50);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    world.add(new THREE.Points(sg, mats.MP(0.09)));

    // ── Speed particles — fewer than tunnel, streaming with camera ─────
    const SPV = 56;
    const spv: number[] = [];
    for (let i = 0; i < SPV; i++)
      spv.push((rng() - 0.5) * 24, (rng() - 0.5) * 16, -rng() * 60);
    const spg = new THREE.BufferGeometry();
    spg.setAttribute('position', new THREE.Float32BufferAttribute(spv, 3));
    const speedPts = new THREE.Points(spg, mats.MP(0.14));
    world.add(speedPts);

    // ── Update ──────────────────────────────────────────────────────────
    // dt from core is in ms; convert via t-diff (clockT is in seconds).
    const fly = new CameraFly(Math.floor(rng() * 2e9), 6, 3, 0, 0, ctx.settings.bankStrength);
    let lastT = 0;
    return (t: number, _dt: number) => {
      const dts = lastT === 0 ? 0.016 : Math.min(0.1, t - lastT);
      lastT = t;
      const spd = SPEED_VALUES[ctx.settings.speed];

      // Forward flight — dt-safe step.
      cam.position.z -= spd * 14 * dts;

      // Banking weave through the belt (forward-on-z kept above).
      const f = fly.sample(t, spd * 14);
      cam.position.x = f.x; cam.position.y = f.y;
      cam.rotation.set(f.pitch, f.yaw, f.roll);

      // Asteroid rotation + recycle.
      const camX = cam.position.x;
      const camY = cam.position.y;
      const camZ = cam.position.z;
      const recycleZ = camZ + BEHIND;
      for (const a of asteroids) {
        a.mesh.rotation.x += a.rx * spd;
        a.mesh.rotation.y += a.ry * spd;
        a.mesh.rotation.z += a.rz * spd;
        if (a.mesh.position.z > recycleZ) {
          const p = respawn(camX, camY, camZ);
          if (p) {
            a.mesh.position.set(p.x, p.y, p.z);
            a.mesh.scale.setScalar(SCALE_MIN + rng() * SCALE_SPAN);
            a.mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
          }
          // else: rejection failed 5x — leave asteroid at last pos, retry next frame
        }
      }

      // Speed particles cycle past camera; the PANIC storm widens their spread.
      const storm = ctx.storm?.() ?? 0;
      const spreadX = 24 * (1 + storm * 0.5), spreadY = 16 * (1 + storm * 0.5);
      const spa = speedPts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = spa.array as Float32Array;
      for (let i = 0; i < SPV; i++) {
        const zi = i * 3 + 2;
        if (arr[zi] > camZ + 2) {
          arr[zi] = camZ - 40 - rng() * 30;
          arr[i * 3]     = (rng() - 0.5) * spreadX + cam.position.x;
          arr[i * 3 + 1] = (rng() - 0.5) * spreadY + cam.position.y;
        }
      }
      spa.needsUpdate = true;
      (speedPts.material as THREE.PointsMaterial).size = 0.14 + storm * 0.12;
    };
  },
};
