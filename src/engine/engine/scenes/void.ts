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
    const NOSPAWN = 16;      // clear tube ≥ the camera's full weave envelope (≈±12) + rock size
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


    interface Ast { mesh: THREE.Mesh; rx: number; ry: number; rz: number }
    const asteroids: Ast[] = [];
    for (let i = 0; i < POOL; i++) {
      // ~30% of asteroids are "infectable" — their material crossfades to the enemy
      // colour as the narrative threat rises (the world catching the operator's dread).
      const pool = (ctx.enemyMats && rng() < 0.3) ? ctx.enemyMats : mats;
      const mesh = new THREE.Mesh(
        pickGeo(),
        pool.M({ transparent: true, opacity: 0.60 + rng() * 0.30 }),
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
    // Heading state — Void truly translates through world-static rocks, so a real course
    // change reads convincingly. camPath = the flown base path (xz); weave rides on top.
    let heading = 0, headTarget = 0, nextTurnT = 18 + rng() * 22, prevHeading = 0;
    const camPath = new THREE.Vector3(0, 0, 0);
    const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
    const tmp = new THREE.Vector3();

    // Respawn a rock ahead along the heading, clear of the flight tube (perpendicular).
    const respawnAhead = (out: THREE.Vector3): boolean => {
      for (let tries = 0; tries < 5; tries++) {
        const lat = (rng() - 0.5) * 2 * FIELD_W, y = sampleBeltY();
        if (lat * lat + y * y < NOSPAWN * NOSPAWN) continue;   // keep the path tube clear
        const d = -FAR + rng() * FAR_VAR;                      // 68..113 ahead along fwd
        out.set(camPath.x + fwd.x * d + right.x * lat, y, camPath.z + fwd.z * d + right.z * lat);
        return true;
      }
      return false;
    };

    return (t: number, _dt: number) => {
      const dts = lastT === 0 ? 0.016 : Math.min(0.1, t - lastT);
      lastT = t;
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]);

      // Course: occasionally pick a new heading; ease toward it (sweeping arc).
      if (t > nextTurnT) {
        headTarget += (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.6);
        nextTurnT = t + 16 + rng() * 20;
      }
      prevHeading = heading;
      heading += (headTarget - heading) * (1 - Math.exp(-dts / 4));
      fwd.set(Math.sin(heading), 0, -Math.cos(heading));
      right.set(Math.cos(heading), 0, Math.sin(heading));

      // Forward flight along the heading.
      camPath.addScaledVector(fwd, spd * 14 * dts);

      // Weave in the heading frame; body yaw = heading + cosmetic weave; bank from turn rate.
      const f = fly.sample(t, spd * 14);
      cam.position.set(camPath.x + right.x * f.x, f.y, camPath.z + right.z * f.x);
      const turnRate = (heading - prevHeading) / Math.max(1e-4, dts);
      cam.rotation.set(f.pitch, heading + f.yaw, f.roll - turnRate * 2.0);

      // Asteroid rotation + recycle (heading frame: ahead = (pos - camPath)·fwd).
      for (const a of asteroids) {
        a.mesh.rotation.x += a.rx * spd;
        a.mesh.rotation.y += a.ry * spd;
        a.mesh.rotation.z += a.rz * spd;
        tmp.copy(a.mesh.position).sub(camPath);
        if (tmp.dot(fwd) < -BEHIND && respawnAhead(tmp)) {
          a.mesh.position.copy(tmp);
          a.mesh.scale.setScalar(SCALE_MIN + rng() * SCALE_SPAN);
          a.mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        }
      }

      // Speed particles stream past along the heading; PANIC storm widens their spread.
      const storm = ctx.storm?.() ?? 0;
      const spreadX = 24 * (1 + storm * 0.5), spreadY = 16 * (1 + storm * 0.5);
      const spa = speedPts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = spa.array as Float32Array;
      for (let i = 0; i < SPV; i++) {
        const ahead = (arr[i * 3] - camPath.x) * fwd.x + (arr[i * 3 + 2] - camPath.z) * fwd.z;
        if (ahead < -2) {
          const d = 40 + rng() * 30, lat = (rng() - 0.5) * spreadX;
          arr[i * 3]     = camPath.x + fwd.x * d + right.x * lat;
          arr[i * 3 + 1] = (rng() - 0.5) * spreadY + f.y;
          arr[i * 3 + 2] = camPath.z + fwd.z * d + right.z * lat;
        }
      }
      spa.needsUpdate = true;
      (speedPts.material as THREE.PointsMaterial).size = 0.14 + storm * 0.12;
    };
  },
};
