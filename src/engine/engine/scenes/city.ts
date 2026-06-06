// CITY RECON — port of city-recon-flyover.html v2 patterns.
// Seeded chunks, 2-tile infinite scroll, setbacks, antennae+beacons,
// blinking windows, skybridges, power lines, rooftop tanks.
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { ALT_VALUES, SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';
import { mkRng } from '../rng';

const CL = 320;  // chunk length
const SW = 22;   // corridor half-width
const JUNCTION = 54;  // open zone at each chunk end → the seam between two chunks reads as an intersection

interface BlinkRef {
  mesh: THREE.Mesh; phase: number; speed: number; hi: number; lo: number;
}

function buildChunk(grp: THREE.Group, mats: SceneCtx['mats'], seed: number, blinks: BlinkRef[], enemyMats?: SceneCtx['enemyMats']) {
  const rng = mkRng(seed);
  const half = CL / 2;

  // Ground
  const gg = new THREE.PlaneGeometry(220, CL, 22, 44); gg.rotateX(-Math.PI / 2);
  grp.add(new THREE.Mesh(gg, mats.M({ transparent: true, opacity: 0.12 })));

  // Street grid
  const lp: number[] = [];
  for (const x of [-SW * 0.55, -SW * 0.27, 0, SW * 0.27, SW * 0.55])
    lp.push(x, 0.08, -half, x, 0.08, half);
  for (let z = -half + 18; z < half; z += 36) {
    lp.push(-SW * 0.6, 0.08, z, SW * 0.6, 0.08, z);
    if (rng() > 0.45) for (let s = 0; s < 6; s++) {
      const lx = -SW * 0.5 + s * (SW / 5);
      lp.push(lx, 0.08, z - 0.4, lx, 0.08, z - 1.3, lx, 0.08, z + 0.4, lx, 0.08, z + 1.3);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  grp.add(new THREE.LineSegments(lg, mats.ML(0.25)));

  // Buildings
  const BS = 22;
  const nb = Math.floor(CL / BS);
  for (let b = 0; b < nb; b++) {
    const bz = -half + b * BS + BS / 2;
    if (Math.abs(bz) > half - JUNCTION) continue;   // leave the ends open → seams become junctions
    for (const side of [-1, 1]) {
      const nB = 1 + (rng() > 0.45 ? 1 : 0);
      for (let i = 0; i < nB; i++) {
        const w = 10 + rng() * 22, h = 14 + rng() * 78, d = 10 + rng() * 16, gap = 3 + rng() * 13;
        const xp = side * (SW + gap + w / 2);
        const zp = bz + (nB > 1 ? (i - 0.5) * BS * 0.42 : 0) + (rng() - 0.5) * 4;

        // Body
        const bx = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.M({ transparent: true, opacity: 0.45 + rng() * 0.3 }));
        bx.position.set(xp, h / 2, zp); grp.add(bx);

        // Setback
        if (h > 40 && rng() > 0.45) {
          const tw = w * 0.56, td = d * 0.56, th = h * 0.2;
          const t1 = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), mats.M({ transparent: true, opacity: 0.52 + rng() * 0.28 }));
          t1.position.set(xp, h + th / 2, zp); grp.add(t1);
          if (rng() > 0.5) {
            const tw2 = tw * 0.54, th2 = th * 0.65;
            const t2 = new THREE.Mesh(new THREE.BoxGeometry(tw2, th2, tw2), mats.M({ transparent: true, opacity: 0.54 + rng() * 0.26 }));
            t2.position.set(xp, h + th + th2 / 2, zp); grp.add(t2);
          }
        }

        // Antenna + beacon
        if (h > 26 && rng() > 0.4) {
          const ah = 5 + rng() * 20;
          const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, ah, 4), mats.M({ transparent: true, opacity: 0.88 }));
          ant.position.set(xp, h + ah / 2, zp); grp.add(ant);
          const bc = new THREE.Mesh(new THREE.SphereGeometry(0.22, 4, 4), mats.MSolid(0.9));
          bc.position.set(xp, h + ah, zp); grp.add(bc);
          blinks.push({ mesh: bc, phase: rng() * Math.PI * 2, speed: 0.5 + rng() * 2, hi: 0.9, lo: 0.04 });
        }

        // Windows — ~25% of buildings are "infectable": their windows crossfade to
        // the enemy colour as the narrative threat rises (a whole building goes red).
        const fl = Math.floor(h / 4.2), wc = Math.floor(w / 3.2);
        const wm = ((enemyMats && rng() < 0.25) ? enemyMats : mats).MSolid(0.9);
        for (let f = 0; f < fl; f++) for (let c = 0; c < wc; c++) if (rng() < 0.35) {
          const wx = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.09), wm);
          wx.position.set(xp - w / 2 + 0.55 + c * (w / wc), 2 + f * 4.2, zp + (rng() > 0.5 ? d / 2 + 0.04 : -d / 2 - 0.04));
          grp.add(wx);
          if (rng() > 0.72) blinks.push({ mesh: wx, phase: rng() * Math.PI * 2, speed: 0.15 + rng() * 3.5, hi: 0.9, lo: 0.03 });
        }
      }
    }

    // Skybridge
    if (rng() > 0.7) {
      const lx = -(SW + 6 + rng() * 6), rx = SW + 6 + rng() * 6, by = 12 + rng() * 26;
      const pts = [
        new THREE.Vector3(lx, by, bz),
        new THREE.Vector3(0, by + 3 + rng() * 12, bz),
        new THREE.Vector3(rx, by, bz),
      ];
      grp.add(new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pts[0], pts[1], pts[2]), 18, 0.11, 4, false),
        mats.M({ transparent: true, opacity: 0.65 }),
      ));
      for (const px of [lx, rx]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, by, 4), mats.M({ transparent: true, opacity: 0.55 }));
        pil.position.set(px, by / 2, bz); grp.add(pil);
      }
    }

    // Power lines
    if (rng() > 0.62) {
      const wy = 9 + rng() * 16, lp2: number[] = [];
      for (let wire = 0; wire < 3; wire++) {
        const yo = wire * 0.45, sag = 0.75 + rng() * 0.4;
        for (let seg = 0; seg < 10; seg++) {
          const t0 = seg / 10, t1 = (seg + 1) / 10;
          lp2.push(
            -SW * 0.55 + t0 * SW * 1.1, wy + yo - 4 * sag * t0 * (1 - t0), bz,
            -SW * 0.55 + t1 * SW * 1.1, wy + yo - 4 * sag * t1 * (1 - t1), bz,
          );
        }
      }
      const lg2 = new THREE.BufferGeometry();
      lg2.setAttribute('position', new THREE.Float32BufferAttribute(lp2, 3));
      grp.add(new THREE.LineSegments(lg2, mats.ML(0.18)));
    }

    // Rooftop tank
    if (rng() > 0.74) {
      const side = rng() > 0.5 ? 1 : -1, tx = side * (SW + 8 + rng() * 10), th = 16 + rng() * 28;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.8, 8), mats.M({ transparent: true, opacity: 0.58 }));
      tank.position.set(tx, th + 1.9, bz + (rng() - 0.5) * 8);
      grp.add(tank);
    }
  }

  // Junction corner blocks — towers in the four quadrants of each open end, framing the
  // crossing. Both the main street (free along z at |x|<SW) and the cross street (free
  // along x at |z-end|<SW) stay open, so a turn over the junction reveals city, not a void.
  for (const endZ of [-half + JUNCTION * 0.5, half - JUNCTION * 0.5]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = 12 + rng() * 16, h = 22 + rng() * 54, d = 12 + rng() * 16;
      const bx = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.M({ transparent: true, opacity: 0.5 + rng() * 0.3 }));
      bx.position.set(sx * (SW + 5 + w / 2), h / 2, endZ + sz * (SW + 5 + d / 2));
      grp.add(bx);
      // a few lit windows on the corner blocks too
      if (rng() < 0.6) {
        const wm = ((enemyMats && rng() < 0.25) ? enemyMats : mats).MSolid(0.9);
        const wx = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.09), wm);
        wx.position.set(bx.position.x, 3 + rng() * (h - 6), bx.position.z + (rng() > 0.5 ? d / 2 + 0.05 : -d / 2 - 0.05));
        grp.add(wx);
      }
    }
  }
}

export const CityScene: SceneModule = {
  modeLabels: ['LOW LEVEL', 'URBAN', 'HIGH PASS'] as const,
  triCount: '~52K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, settings } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.008);

    const blinks: BlinkRef[] = [];
    const cA = new THREE.Group(), cB = new THREE.Group();
    // Use seeded rng for chunk seeds, but each chunk has its own RNG to keep layouts reproducible
    const baseSeed = (ctx.rng() * 0xffffffff) | 0;
    buildChunk(cA, mats, baseSeed + 42, blinks, ctx.enemyMats);
    buildChunk(cB, mats, baseSeed + 137, blinks, ctx.enemyMats);
    cA.position.z = -CL / 2;
    cB.position.z = -CL / 2 - CL;
    world.add(cA, cB);

    // Stars
    {
      const sv: number[] = [];
      const r = ctx.rng;
      for (let i = 0; i < 1200; i++) sv.push((r() - 0.5) * 700, 18 + r() * 200, -(r() * 800 + 60));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
      world.add(new THREE.Points(g, mats.MP(0.14)));
    }

    // Skyline silhouette
    {
      const sg = new THREE.PlaneGeometry(550, 120, 85, 8); sg.rotateX(-Math.PI / 2);
      const sp = sg.attributes.position;
      const r = ctx.rng;
      for (let i = 0; i < sp.count; i++)
        sp.setY(i, Math.abs(Math.sin(sp.getX(i) * 0.024) * Math.cos(sp.getX(i) * 0.006)) * 76 + r() * 3);
      sp.needsUpdate = true;
      const sil = new THREE.Mesh(sg, mats.M({ transparent: true, opacity: 0.12 }));
      sil.position.z = -900; world.add(sil);
    }

    // Dust (streamed toward the camera in the updater — see below)
    const dustG = new THREE.BufferGeometry();
    {
      const dv: number[] = [];
      const r = ctx.rng;
      for (let i = 0; i < 600; i++) dv.push((r() - 0.5) * 80, r() * 55, -(r() * 700 + 20));
      dustG.setAttribute('position', new THREE.Float32BufferAttribute(dv, 3));
      world.add(new THREE.Points(dustG, mats.MP(0.065)));
    }

    cam.position.set(0, ALT_VALUES[settings.cityAltitude], 0);
    cam.rotation.set(-0.08, 0, 0);
    const fly = new CameraFly(Math.floor(ctx.rng() * 2e9), 8, 1.6, ALT_VALUES[settings.cityAltitude], -0.08, ctx.settings.bankStrength);

    let blinkTick = 0, lastT = 0;
    // Heading-frame flight: the city is world-static; the camera flies through it along a
    // heading. At a junction (the open zone where two chunks meet) the heading swings 90° —
    // a real corner. Corridor chunks recycle as a chain ahead in the current heading.
    let heading = 0, nextTurnT = 16 + ctx.rng() * 8;
    let turning = false, turnFrom = 0, turnTo = 0, turnT0 = 0;
    const camPath = new THREE.Vector3(0, 0, 0);
    const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
    const tmp = new THREE.Vector3();
    const turnRng = mkRng((baseSeed ^ 0x717271) >>> 0);
    const TURN_DUR = 1.6;
    const segs = [cA, cB];
    cA.position.set(0, 0, -CL / 2);
    cB.position.set(0, 0, -CL / 2 - CL);
    const dp = dustG.attributes.position as THREE.BufferAttribute;

    return (t: number, _dt: number) => {
      const dts = lastT === 0 ? 0.016 : Math.min(0.1, t - lastT);
      lastT = t;
      const altTarget = ALT_VALUES[ctx.settings.cityAltitude];
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.24 * 60;   // units/sec

      // Are we in an open junction zone (near a chunk seam)? Turns only start there, so the
      // 90° swing plays out over the open intersection, never into a building wall.
      let inJunction = false;
      for (const s of segs) {
        const sy = s.rotation.y;
        const la = (camPath.x - s.position.x) * Math.sin(sy) - (camPath.z - s.position.z) * Math.cos(sy);
        if (Math.abs(la) < CL / 2 && Math.abs(la) > CL / 2 - JUNCTION) { inJunction = true; break; }
      }
      // Corner choreography: at an open junction, swing the heading 90°.
      const prevHeading = heading;
      if (!turning && t > nextTurnT && inJunction) {
        turning = true; turnFrom = heading;
        turnTo = heading + (turnRng() < 0.5 ? -1 : 1) * Math.PI / 2;
        turnT0 = t;
        // Re-aim the far (fogged-out) chunk into the NEW direction so we emerge into corridor.
        const nfx = Math.sin(turnTo), nfz = -Math.cos(turnTo);
        let front = segs[0], fd = -1e9;
        for (const s of segs) { const d = tmp.copy(s.position).sub(camPath).dot(fwd); if (d > fd) { fd = d; front = s; } }
        front.position.set(camPath.x + nfx * (CL / 2 + 30), 0, camPath.z + nfz * (CL / 2 + 30));
        front.rotation.y = turnTo;
      }
      if (turning) {
        const p = Math.min(1, (t - turnT0) / TURN_DUR);
        const e = 0.5 - 0.5 * Math.cos(p * Math.PI);      // cosine ease in/out
        heading = turnFrom + (turnTo - turnFrom) * e;
        if (p >= 1) { turning = false; heading = turnTo; nextTurnT = t + 6 + turnRng() * 6; }
      }
      fwd.set(Math.sin(heading), 0, -Math.cos(heading));
      right.set(Math.cos(heading), 0, Math.sin(heading));
      const turnRate = (heading - prevHeading) / Math.max(1e-4, dts);

      camPath.addScaledVector(fwd, spd * dts);

      // Recycle corridor chunks as a chain: a chunk that falls behind re-appends one CL ahead
      // of the other, rotated to the current heading (so the corridor follows the corner).
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (tmp.copy(seg.position).sub(camPath).dot(fwd) < -CL / 2 - 24) {
          const other = segs[(i + 1) % segs.length];
          seg.position.copy(other.position).addScaledVector(fwd, CL);
          seg.rotation.y = heading;
        }
      }

      // Dust streams along the heading (recycle when it falls behind the camera).
      for (let i = 0; i < dp.count; i++) {
        const ahead = (dp.getX(i) - camPath.x) * fwd.x + (dp.getZ(i) - camPath.z) * fwd.z;
        if (ahead < -6) {
          const d = 30 + Math.random() * 670, lat = (Math.random() - 0.5) * 80;
          dp.setX(i, camPath.x + fwd.x * d + right.x * lat);
          dp.setZ(i, camPath.z + fwd.z * d + right.z * lat);
          dp.setY(i, Math.random() * 55);
        }
      }
      dp.needsUpdate = true;

      fly.vertBase = altTarget;
      const f = fly.sample(t, spd);
      cam.position.set(camPath.x + right.x * f.x, Math.max(1.8, f.y), camPath.z + right.z * f.x);
      const bank = Math.max(-0.5, Math.min(0.5, -turnRate * 0.4));   // bank into the corner (clamped)
      cam.rotation.set(f.pitch, heading + f.yaw, f.roll + bank);

      blinkTick++;
      if (blinkTick % 2 === 0) {
        for (const bw of blinks) {
          const on = Math.sin(t * bw.speed + bw.phase) > 0;
          (bw.mesh.material as any).opacity = on ? bw.hi : bw.lo;
        }
      }
    };
  },
};
