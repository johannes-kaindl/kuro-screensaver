// VOID / WRECKAGE — shared flythrough: heading-frame translation through a streamed pool
// of world-static templates (asteroids, or CORP-station debris). Forward flight along an
// eased heading; spawn ahead / recycle behind in the heading frame; belt-density on Y.
// VoidScene + (via the same engine) WreckageScene — see wreckage.ts.
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';

export interface FlyTpl { geo: THREE.BufferGeometry; w: number }
export interface FlythroughOpts {
  modeLabels: readonly string[];
  triCount: string;
  fog: number;
  tumble?: number;    // spin multiplier (1 = asteroids; >1 = erratic wreckage tumble)
  makeTemplates: (rng: () => number) => FlyTpl[];
}

export function makeFlythroughScene(opts: FlythroughOpts): SceneModule {
  return {
    modeLabels: opts.modeLabels,
    triCount: opts.triCount,
    build: (ctx) => buildFlythrough(ctx, opts),
  };
}

function buildFlythrough(ctx: SceneCtx, opts: FlythroughOpts): SceneUpdater {
  const { world, cam, mats, scene, rng } = ctx;

  scene.fog = new THREE.FogExp2(0x000000, opts.fog);
  cam.position.set(0, 0, 0);
  cam.rotation.set(0, 0, 0);

  // ── Geometry templates (re-used across the pool) ──
  const TPL = opts.makeTemplates(rng);
  const tumble = opts.tumble ?? 1;
  const cumW: number[] = [];
  { let acc = 0; for (const t of TPL) { acc += t.w; cumW.push(acc); } }
  const pickGeo = (): THREE.BufferGeometry => {
    const r = rng() * cumW[cumW.length - 1];
    for (let i = 0; i < cumW.length; i++) if (r < cumW[i]) return TPL[i].geo;
    return TPL[0].geo;
  };

  // ── Field params ──
  const POOL    = 90;
  const FAR     = -68;
  const FAR_VAR = 45;
  const BEHIND  = 10;
  const FIELD_W = 44;
  const BELT_S  = 14;
  const OFFBELT_P = 0.08;
  const NOSPAWN = 16;      // clear tube ≥ the camera's full weave envelope (≈±12) + size
  const SCALE_MIN = 0.9, SCALE_SPAN = 3.0;

  const sampleBeltY = () => {
    if (rng() < OFFBELT_P) return (rng() - 0.5) * 50;
    return ((rng() - 0.5) + (rng() - 0.5)) * BELT_S * 1.6;
  };
  const inFlightTube = (x: number, y: number) => x * x + y * y < NOSPAWN * NOSPAWN;

  // initial seed: spread over corridor depth, reserve a near-zone so it doesn't open inside a swarm.
  const seedInitial = () => {
    const seedZ = () => -18 - rng() * (Math.abs(FAR) + FAR_VAR - 18);
    for (let tries = 0; tries < 5; tries++) {
      const x = (rng() - 0.5) * 2 * FIELD_W;
      const y = sampleBeltY();
      const z = seedZ();
      if (!inFlightTube(x, y)) return { x, y, z };
    }
    const side = rng() < 0.5 ? -1 : 1;
    return { x: side * (NOSPAWN + 1.5 + rng() * 10), y: sampleBeltY(), z: seedZ() };
  };

  interface Ast { mesh: THREE.Mesh; rx: number; ry: number; rz: number }
  const asteroids: Ast[] = [];
  for (let i = 0; i < POOL; i++) {
    const pool = (ctx.enemyMats && rng() < 0.3) ? ctx.enemyMats : mats;   // ~30% CORP-tinted
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
      rx: (rng() - 0.5) * 0.024 * tumble,
      ry: (rng() - 0.5) * 0.024 * tumble,
      rz: (rng() - 0.5) * 0.020 * tumble,
    });
  }

  // ── Starfield ──
  const sv: number[] = [];
  for (let i = 0; i < 2200; i++)
    sv.push((rng() - 0.5) * 240, (rng() - 0.5) * 140, (rng() - 0.5) * 260 - 50);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  world.add(new THREE.Points(sg, mats.MP(0.09)));

  // ── Speed particles ──
  const SPV = 56;
  const spv: number[] = [];
  for (let i = 0; i < SPV; i++)
    spv.push((rng() - 0.5) * 24, (rng() - 0.5) * 16, -rng() * 60);
  const spg = new THREE.BufferGeometry();
  spg.setAttribute('position', new THREE.Float32BufferAttribute(spv, 3));
  const speedPts = new THREE.Points(spg, mats.MP(0.14));
  world.add(speedPts);

  // ── Debris hazard (Brick D-next) — an oversized chunk barrels straight down the flight
  // tube under high threat; the camera jukes aside at the last moment (near-miss dodge). ──
  const hazardMesh = new THREE.Mesh(pickGeo(), (ctx.enemyMats ?? mats).M({ transparent: true, opacity: 0.92 }));
  hazardMesh.scale.setScalar(SCALE_MIN + SCALE_SPAN + 1.2);
  hazardMesh.visible = false;
  world.add(hazardMesh);

  // ── Update ──
  const fly = new CameraFly(Math.floor(rng() * 2e9), 6, 3, 0, 0, ctx.settings.bankStrength);
  let lastT = 0;
  // Heading state — the camera truly translates through world-static geometry, so a real
  // course change reads convincingly. camPath = the flown base path (xz); weave rides on top.
  let heading = 0, headTarget = 0, nextTurnT = 18 + rng() * 22, prevHeading = 0;
  const camPath = new THREE.Vector3(0, 0, 0);
  const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
  const tmp = new THREE.Vector3();
  // Debris-dodge state (Brick D-next).
  let hazardActive = false, hazardSide = 1, hazardVert = 1, nextHazardT = 8 + rng() * 8;
  let dodgeX = 0, dodgeY = 0;

  const respawnAhead = (out: THREE.Vector3): boolean => {
    for (let tries = 0; tries < 5; tries++) {
      const lat = (rng() - 0.5) * 2 * FIELD_W, y = sampleBeltY();
      if (lat * lat + y * y < NOSPAWN * NOSPAWN) continue;   // keep the path tube clear
      const d = -FAR + rng() * FAR_VAR;                      // ahead along the heading
      out.set(camPath.x + fwd.x * d + right.x * lat, y, camPath.z + fwd.z * d + right.z * lat);
      return true;
    }
    return false;
  };

  return (t: number, _dt: number) => {
    const dts = lastT === 0 ? 0.016 : Math.min(0.1, t - lastT);
    lastT = t;
    const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]);

    // Course: occasional eased heading changes. Rocks recycle only when they fall BEHIND,
    // so laterally-drifting rocks stream past with natural parallax — that parallax is the
    // cue that sells a curve in open space (over-recycling them ahead made it read as a
    // block rotating = swivel + strafe; reverted to the 6b2df3d approach).
    if (t > nextTurnT) {
      headTarget += (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.9);
      nextTurnT = t + 8 + rng() * 12;
    }
    prevHeading = heading;
    heading += (headTarget - heading) * (1 - Math.exp(-dts / 2.6));
    fwd.set(Math.sin(heading), 0, -Math.cos(heading));
    right.set(Math.cos(heading), 0, Math.sin(heading));

    camPath.addScaledVector(fwd, spd * 14 * dts);

    // Debris dodge: under high threat, launch a big chunk straight down the tube; as it
    // bears down, juke the camera aside (eased) so it whips past — a near-miss, not a hit.
    const threatNow = ctx.threat?.() ?? 0;
    if (!hazardActive && threatNow > 0.55 && t > nextHazardT) {
      hazardActive = true;
      hazardSide = rng() < 0.5 ? -1 : 1;
      hazardVert = rng() < 0.5 ? -1 : 1;
      hazardMesh.position.set(camPath.x + fwd.x * 120, 0, camPath.z + fwd.z * 120);   // far ahead, dead on the path
      hazardMesh.visible = true;
    }
    let dodgeTX = 0, dodgeTY = 0;
    if (hazardActive) {
      hazardMesh.rotation.x += 0.03 * spd; hazardMesh.rotation.y += 0.022 * spd;
      const along = tmp.copy(hazardMesh.position).sub(camPath).dot(fwd);
      if (along > 0 && along < 60) {                 // in range, still ahead → break aside
        const urgency = 1 - along / 60;
        dodgeTX = hazardSide * 7.5 * urgency;
        dodgeTY = hazardVert * 4.5 * urgency;
      }
      if (along < -BEHIND) { hazardActive = false; hazardMesh.visible = false; nextHazardT = t + 7 + rng() * 9; }
    }
    dodgeX += (dodgeTX - dodgeX) * (1 - Math.exp(-dts / 0.32));
    dodgeY += (dodgeTY - dodgeY) * (1 - Math.exp(-dts / 0.32));

    const f = fly.sample(t, spd * 14);
    const latOff = f.x * 0.3 + dodgeX;
    cam.position.set(camPath.x + right.x * latOff, f.y + dodgeY, camPath.z + right.z * latOff);
    const turnRate = (heading - prevHeading) / Math.max(1e-4, dts);
    cam.rotation.set(f.pitch, heading + f.yaw * 0.3, f.roll - turnRate * 2.6 - dodgeX * 0.05);

    // Rotation + recycle (heading frame: along = (pos-camPath)·fwd, lateral = ·right).
    for (const a of asteroids) {
      a.mesh.rotation.x += a.rx * spd;
      a.mesh.rotation.y += a.ry * spd;
      a.mesh.rotation.z += a.rz * spd;
      tmp.copy(a.mesh.position).sub(camPath);
      // Recycle ONLY when a rock falls behind — laterally-drifting rocks must stream past
      // with natural parallax (teleporting them ahead made the field rotate as a block).
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
}

// ── Asteroid templates (rocks): platonic solids + one displaced irregular ──
function rockTemplates(rng: () => number): FlyTpl[] {
  const TPL: FlyTpl[] = [
    { geo: new THREE.IcosahedronGeometry(1, 2), w: 0.20 },
    { geo: new THREE.IcosahedronGeometry(1, 1), w: 0.32 },
    { geo: new THREE.IcosahedronGeometry(1, 0), w: 0.18 },
    { geo: new THREE.DodecahedronGeometry(1),    w: 0.15 },
  ];
  const irr = new THREE.IcosahedronGeometry(1, 1);
  const pos = irr.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const j = 0.62 + rng() * 0.55;
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
  }
  irr.computeVertexNormals();
  TPL.push({ geo: irr, w: 0.15 });
  return TPL;
}

export const VoidScene = makeFlythroughScene({
  modeLabels: ['DRIFT', 'BELT', 'SWARM'] as const,
  triCount: '20K',
  fog: 0.0045,
  makeTemplates: rockTemplates,
});
