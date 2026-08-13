// METRO — OSM district flyover. A hybrid of a REAL OpenStreetMap district
// (baked into data/osm-district.json at build time by scripts/bake-osm-district.mjs)
// and procedurally generated OSM-like blocks, so the flythrough is infinite.
//
// Structurally a sibling of city.ts (two-tile infinite scroll, CameraFly,
// blinking windows, enemy infection, stars/dust/skyline), but buildings are
// wireframe prisms extruded from polygon footprints (geo-extrude.ts) instead
// of axis-aligned boxes.
//
// Map data © OpenStreetMap contributors, ODbL 1.0
// (https://www.openstreetmap.org/copyright).
import * as THREE from 'three';
import type { SceneCtx, SceneModule, SceneUpdater } from './scene-base';
import { ALT_VALUES, SPEED_VALUES } from '../../data/defaults';
import { CameraFly } from '../camera-fly';
import { mkRng } from '../rng';
import { extrudePrism, decodeRing, type BlinkRef } from '../geo-extrude';
import districtRaw from '../../data/osm-district.json';

interface District {
  meta: { scale: number; spanZ: number; attribution?: string };
  footprints: { h: number; r: number[] }[];
}
const district = districtRaw as unknown as District;

// Chunk length is derived from the baked district so it tiles at TRUE scale
// (no squish); procedural tiles use the same length. Falls back for a small
// or missing district. Even, with a small seam margin beyond the footprints.
const CL = Math.max(340, Math.ceil(((district.meta?.spanZ ?? 160) + 26) / 10) * 20);
const SW = 22;    // corridor half-width kept clear for the flight path

// ── Real baked district → one chunk group ──────────────────────────────────
function buildDistrictChunk(grp: THREE.Group, mats: SceneCtx['mats'], seed: number, blinks: BlinkRef[], enemyMats?: SceneCtx['enemyMats']) {
  const rng = mkRng(seed);
  const scale = district.meta.scale || 0.1;

  // Fit the district into the tile length and keep a clear central corridor.
  const fitLimit = CL / 2 - 16;
  const spanZ = Math.max(1, district.meta.spanZ || fitLimit);
  const fit = spanZ > fitLimit ? fitLimit / spanZ : 1;

  // Faint ground so the district reads as sitting on a plane (matches city).
  const gg = new THREE.PlaneGeometry(240, CL, 24, 44); gg.rotateX(-Math.PI / 2);
  grp.add(new THREE.Mesh(gg, mats.M({ transparent: true, opacity: 0.1 })));

  for (const f of district.footprints) {
    const ring = decodeRing(f.r, scale);
    // scale to fit + compute centroid to carve the corridor
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i += 2) { ring[i] *= fit; ring[i + 1] *= fit; cx += ring[i]; cz += ring[i + 1]; }
    const nn = ring.length / 2; cx /= nn; cz /= nn;
    if (Math.abs(cx) < SW * 0.9) continue;   // keep the flight corridor clear
    extrudePrism(grp, ring, Math.max(6, f.h * fit), mats, rng, { blinks, enemyMats });
  }
}

// ── Procedural OSM-like block → one chunk group ─────────────────────────────
// Star-shaped polygon: vertices at monotonically increasing angles ⇒ always
// simple (no self-intersection), so it extrudes cleanly.
function starFootprint(rng: () => number, ox: number, oz: number, baseR: number, aspect: number, stretchZ: number): number[] {
  const nv = 4 + Math.floor(rng() * 5);            // 4..8 vertices
  const off = rng() * Math.PI * 2;
  const step = (Math.PI * 2) / nv;
  const ring: number[] = [];
  for (let i = 0; i < nv; i++) {
    const ang = off + i * step + (rng() - 0.5) * step * 0.6;   // jitter < ½ step → order preserved
    const rr = baseR * (0.7 + 0.5 * rng());
    ring.push(ox + Math.cos(ang) * rr * aspect, oz + Math.sin(ang) * rr * stretchZ);
  }
  return ring;
}

function buildProcChunk(grp: THREE.Group, mats: SceneCtx['mats'], seed: number, blinks: BlinkRef[], enemyMats?: SceneCtx['enemyMats']) {
  const rng = mkRng(seed);
  const half = CL / 2;

  // Ground + street grid (same idiom as city.ts)
  const gg = new THREE.PlaneGeometry(240, CL, 24, 44); gg.rotateX(-Math.PI / 2);
  grp.add(new THREE.Mesh(gg, mats.M({ transparent: true, opacity: 0.1 })));
  const lp: number[] = [];
  for (const x of [-SW * 0.55, -SW * 0.27, 0, SW * 0.27, SW * 0.55]) lp.push(x, 0.08, -half, x, 0.08, half);
  for (let z = -half + 18; z < half; z += 36) lp.push(-SW * 0.6, 0.08, z, SW * 0.6, 0.08, z);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  grp.add(new THREE.LineSegments(lg, mats.ML(0.25)));

  const BS = 22;
  const nb = Math.floor(CL / BS);
  for (let b = 0; b < nb; b++) {
    const bz = -half + b * BS + BS / 2;
    for (const side of [-1, 1]) {
      const nB = 1 + (rng() > 0.5 ? 1 : 0);
      for (let i = 0; i < nB; i++) {
        const baseR = 5 + rng() * 9, gap = 3 + rng() * 12;
        const h = 14 + rng() * 78;
        const xp = side * (SW + gap + baseR);
        const zp = bz + (nB > 1 ? (i - 0.5) * BS * 0.42 : 0) + (rng() - 0.5) * 4;
        const ring = starFootprint(rng, xp, zp, baseR, 0.7 + rng() * 0.7, 0.7 + rng() * 0.6);
        extrudePrism(grp, ring, h, mats, rng, { blinks, enemyMats });
      }
    }

    // Skybridge (city.ts:91-107)
    if (rng() > 0.72) {
      const lx = -(SW + 6 + rng() * 6), rx = SW + 6 + rng() * 6, by = 12 + rng() * 26;
      const pts = [new THREE.Vector3(lx, by, bz), new THREE.Vector3(0, by + 3 + rng() * 12, bz), new THREE.Vector3(rx, by, bz)];
      grp.add(new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pts[0], pts[1], pts[2]), 18, 0.11, 4, false),
        mats.M({ transparent: true, opacity: 0.65 }),
      ));
    }

    // Power lines (city.ts:109-125)
    if (rng() > 0.66) {
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
  }
}

export const MetroScene: SceneModule = {
  modeLabels: ['DISTRICT', 'OSM RECON', 'HIGH PASS'] as const,
  triCount: '~48K',

  build(ctx: SceneCtx): SceneUpdater {
    const { world, cam, mats, scene, settings } = ctx;
    scene.fog = new THREE.FogExp2(0x000000, 0.008);

    const blinks: BlinkRef[] = [];
    const cA = new THREE.Group(), cB = new THREE.Group();
    const baseSeed = (ctx.rng() * 0xffffffff) | 0;
    // Tile A = the real baked district; Tile B = procedural continuation.
    buildDistrictChunk(cA, mats, baseSeed + 42, blinks, ctx.enemyMats);
    buildProcChunk(cB, mats, baseSeed + 137, blinks, ctx.enemyMats);
    cA.position.z = -CL / 2;
    cB.position.z = -CL / 2 - CL;
    world.add(cA, cB);

    // Stars (city.ts:155-163)
    {
      const sv: number[] = [];
      const r = ctx.rng;
      for (let i = 0; i < 1200; i++) sv.push((r() - 0.5) * 700, 18 + r() * 200, -(r() * 800 + 60));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
      world.add(new THREE.Points(g, mats.MP(0.14)));
    }

    // Skyline silhouette (city.ts:165-175)
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

    // Dust (streamed toward the camera in the updater)
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

    let blinkTick = 0;

    return (t: number, _dt: number) => {
      const altTarget = ALT_VALUES[ctx.settings.cityAltitude];
      const spd = (ctx.speed?.() ?? SPEED_VALUES[ctx.settings.speed]) * 0.24;
      cA.position.z += spd; cB.position.z += spd;

      const dp = dustG.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dp.count; i++) {
        let dz = dp.getZ(i) + spd;
        if (dz > 10) dz -= 720;
        dp.setZ(i, dz);
      }
      dp.needsUpdate = true;
      if (cA.position.z > CL / 2 + 8) cA.position.z -= CL * 2;
      if (cB.position.z > CL / 2 + 8) cB.position.z -= CL * 2;

      fly.vertBase = altTarget;
      const f = fly.sample(t, spd * 60);
      cam.position.x = f.x; cam.position.y = Math.max(1.8, f.y);
      cam.rotation.set(f.pitch, f.yaw, f.roll);

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
