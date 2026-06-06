// CITY GRID — a Manhattan street grid the camera flies through. Buildings sit in blocks on
// a fixed lattice; the streets are the gaps between them, in BOTH axes. The camera flies
// down a street lane (x = 0), so it never passes through buildings; cross-streets slide by.
// (Real 90° turns at intersections are layered on next, once the grid itself reads right.)
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { ALT_VALUES, SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';
import { mkRng } from '../rng';

const P = 120;             // grid period (block footprint + street)
const STREET = 44;         // street width — the flight lane between block rows/cols
const BLOCK = P - STREET;  // 76 — block footprint
const COLS = 6;            // building-block columns (x), centred on the x=0 lane
const ROWS = 7;            // building-block rows (z), scrolled toward the camera

interface BlinkRef { mesh: THREE.Mesh; phase: number; speed: number; hi: number; lo: number; }

// One city block: towers pushed to the block PERIMETER so they line the streets (a
// continuous canyon wall), with an open courtyard centre — a real city block.
function buildBlock(grp: THREE.Group, mats: SceneCtx['mats'], seed: number, blinks: BlinkRef[], enemyMats?: SceneCtx['enemyMats']) {
  const rng = mkRng(seed);
  const half = BLOCK / 2;
  const n = 3 + (rng() > 0.4 ? 1 : 0) + (rng() > 0.7 ? 1 : 0);   // 3–5 towers around the perimeter
  for (let i = 0; i < n; i++) {
    const w = 16 + rng() * 24, h = 30 + rng() * 92, d = 16 + rng() * 24;
    // pin each tower to one block edge so all four streets get a built frontage
    let ox = (rng() - 0.5) * (BLOCK - w), oz = (rng() - 0.5) * (BLOCK - d);
    const edge = i % 4;
    if (edge === 0) oz = half - d / 2;
    else if (edge === 1) oz = -half + d / 2;
    else if (edge === 2) ox = half - w / 2;
    else ox = -half + w / 2;

    const bx = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.M({ transparent: true, opacity: 0.45 + rng() * 0.3 }));
    bx.position.set(ox, h / 2, oz); grp.add(bx);

    if (h > 46 && rng() > 0.45) {                         // setback tier
      const tw = w * 0.56, td = d * 0.56, th = h * 0.2;
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), mats.M({ transparent: true, opacity: 0.52 + rng() * 0.28 }));
      t1.position.set(ox, h + th / 2, oz); grp.add(t1);
    }
    if (h > 30 && rng() > 0.45) {                         // antenna + beacon
      const ah = 5 + rng() * 18;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, ah, 4), mats.M({ transparent: true, opacity: 0.85 }));
      ant.position.set(ox, h + ah / 2, oz); grp.add(ant);
      const bc = new THREE.Mesh(new THREE.SphereGeometry(0.22, 4, 4), mats.MSolid(0.9));
      bc.position.set(ox, h + ah, oz); grp.add(bc);
      blinks.push({ mesh: bc, phase: rng() * Math.PI * 2, speed: 0.5 + rng() * 2, hi: 0.9, lo: 0.04 });
    }
    // windows on the front/back faces (kept sparse — many blocks on screen)
    const fl = Math.floor(h / 4.4), wc = Math.max(1, Math.floor(w / 3.4));
    const wm = ((enemyMats && rng() < 0.22) ? enemyMats : mats).MSolid(0.9);
    for (let f = 0; f < fl; f++) for (let c = 0; c < wc; c++) if (rng() < 0.16) {
      const wx = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.09), wm);
      wx.position.set(ox - w / 2 + 0.6 + c * (w / wc), 2 + f * 4.4, oz + (rng() > 0.5 ? d / 2 + 0.05 : -d / 2 - 0.05));
      grp.add(wx);
      if (rng() > 0.8) blinks.push({ mesh: wx, phase: rng() * Math.PI * 2, speed: 0.15 + rng() * 3.5, hi: 0.9, lo: 0.03 });
    }
  }
}

export const CityScene: SceneModule = {
  modeLabels: ['LOW LEVEL', 'URBAN', 'HIGH PASS'] as const,
  triCount: '~60K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, settings } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.0085);

    const blinks: BlinkRef[] = [];
    const baseSeed = (ctx.rng() * 0xffffffff) | 0;

    // ── Block grid: a pool of COLS×ROWS blocks tiled toroidally around the camera on the
    // fixed lattice each frame. Block centres sit at (i+0.5)·P, so x=k·P / z=k·P are streets. ──
    interface Blk { grp: THREE.Group; a: number; b: number; }
    const blocks: Blk[] = [];
    for (let a = 0; a < COLS; a++) {
      for (let b = 0; b < ROWS; b++) {
        const grp = new THREE.Group();
        buildBlock(grp, mats, baseSeed + a * 101 + b * 7919 + 17, blinks, ctx.enemyMats);
        world.add(grp);
        blocks.push({ grp, a, b });
      }
    }
    const cxi = Math.floor(COLS / 2), czi = Math.floor(ROWS / 2);

    // ── Ground street grid (centred on the camera each frame, snapped to the lattice) ──
    const groundGrid = new THREE.Group();
    {
      const lp: number[] = [];
      const kmax = Math.ceil(Math.max(COLS, ROWS) / 2) + 2;
      const span = kmax * P;
      for (let k = -kmax; k <= kmax; k++) {
        lp.push(k * P, 0.05, -span, k * P, 0.05, span);   // streets along z
        lp.push(-span, 0.05, k * P, span, 0.05, k * P);   // cross-streets along x
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      groundGrid.add(new THREE.LineSegments(lg, mats.ML(0.22)));
      world.add(groundGrid);
    }

    // ── Stars ──
    {
      const sv: number[] = [];
      const r = ctx.rng;
      for (let i = 0; i < 1100; i++) sv.push((r() - 0.5) * 900, 70 + r() * 220, (r() - 0.5) * 900);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
      world.add(new THREE.Points(g, mats.MP(0.14)));
    }

    cam.position.set(0, ALT_VALUES[settings.cityAltitude], 0);
    cam.rotation.set(-0.05, 0, 0);
    const fly = new CameraFly(Math.floor(ctx.rng() * 2e9), 6, 1.4, ALT_VALUES[settings.cityAltitude], -0.05, ctx.settings.bankStrength);

    // Heading-frame flight on the street lanes: camPath rides a lane; at an intersection the
    // heading swings 90° onto the cross-street. Blocks tile toroidally on the fixed lattice,
    // so the lanes (k·P) are always clear — the camera never enters a building.
    let heading = 0, nextTurnT = 12 + ctx.rng() * 8, lastT = 0;
    let turning = false, turnFrom = 0, turnTo = 0, turnT0 = 0;
    const camPath = new THREE.Vector3(0, 0, 0);
    const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
    const turnRng = mkRng((baseSeed ^ 0x717271) >>> 0);
    const TURN_DUR = 1.3;
    let blinkTick = 0;

    return (t: number, _dt: number) => {
      const dts = lastT === 0 ? 0.016 : Math.min(0.1, t - lastT);
      lastT = t;
      const altTarget = ALT_VALUES[ctx.settings.cityAltitude];
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.24 * 60;   // units/sec

      // Turn at an intersection: when the along-lane coordinate is near a lattice crossing
      // (k·P), swing the heading 90° onto the cross street.
      const prevHeading = heading;
      const alongZ = Math.abs(Math.cos(heading)) > 0.5;            // flying along z (vs x)?
      const along = alongZ ? camPath.z : camPath.x;
      const atCrossing = Math.abs(along - Math.round(along / P) * P) < 14;
      if (!turning && t > nextTurnT && atCrossing) {
        turning = true; turnFrom = heading;
        turnTo = heading + (turnRng() < 0.5 ? -1 : 1) * Math.PI / 2;
        turnT0 = t;
      }
      if (turning) {
        const p = Math.min(1, (t - turnT0) / TURN_DUR);
        const e = 0.5 - 0.5 * Math.cos(p * Math.PI);
        heading = turnFrom + (turnTo - turnFrom) * e;
        if (p >= 1) {
          turning = false; heading = turnTo; nextTurnT = t + 10 + turnRng() * 8;
          // snap the now-fixed axis exactly onto its lane (kills any cornering drift)
          if (Math.abs(Math.cos(heading)) > 0.5) camPath.x = Math.round(camPath.x / P) * P;
          else camPath.z = Math.round(camPath.z / P) * P;
        }
      }
      fwd.set(Math.sin(heading), 0, -Math.cos(heading));
      right.set(Math.cos(heading), 0, Math.sin(heading));
      const turnRate = (heading - prevHeading) / Math.max(1e-4, dts);

      camPath.addScaledVector(fwd, spd * dts);

      // Tile the block pool toroidally on the lattice around the camera.
      const baseI = Math.round(camPath.x / P - 0.5), baseJ = Math.round(camPath.z / P - 0.5);
      for (const blk of blocks) {
        blk.grp.position.set((baseI + blk.a - cxi + 0.5) * P, 0, (baseJ + blk.b - czi + 0.5) * P);
      }
      groundGrid.position.set(Math.round(camPath.x / P) * P, 0, Math.round(camPath.z / P) * P);

      fly.vertBase = altTarget;
      const f = fly.sample(t, spd);
      const bank = Math.max(-0.45, Math.min(0.45, -turnRate * 0.4));
      cam.position.set(camPath.x + right.x * f.x * 0.22, Math.max(2, f.y), camPath.z + right.z * f.x * 0.22);
      cam.rotation.set(f.pitch, heading + f.yaw * 0.3, f.roll + bank);

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
