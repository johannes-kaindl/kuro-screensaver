// geo-extrude.ts — turn a polygon footprint into a retro-CRT wireframe prism.
//
// Used by the `metro` scene (scenes/metro.ts) for both the baked real-OSM
// district and the procedurally generated blocks. Deliberately NOT
// THREE.ExtrudeGeometry: the engine's look is wireframe lines, so a prism is
// the bottom ring + top ring + vertical edges merged into a single
// LineSegments (few draw calls, same idiom as the city street-grid/power-lines).
// Windows / antenna / beacon reuse the exact patterns from scenes/city.ts.
import * as THREE from 'three';
import type { SceneCtx } from './scenes/scene-base';

export interface BlinkRef {
  mesh: THREE.Mesh; phase: number; speed: number; hi: number; lo: number;
}

export interface PrismOpts {
  /** Bottom of the prism (>0 for stacked setback tiers). Default 0. */
  baseY?: number;
  /** Edge/frame opacity. Default 0.5 + slight jitter. */
  opacity?: number;
  /** Emit facade windows. Default true. */
  windows?: boolean;
  /** Emit rooftop antenna + blinking beacon. Default true. */
  antenna?: boolean;
  /** Second pool for the enemy infection — ~25% of footprints go "red". */
  enemyMats?: SceneCtx['enemyMats'];
  /** Collector for blinking meshes (beacons + lit windows). */
  blinks?: BlinkRef[];
}

/** Decode an osm-district.json ring `r` (decimetre, delta-encoded) into a flat
 *  metre loop [x0,z0,x1,z1,…]. First pair is absolute, the rest are deltas. */
export function decodeRing(r: number[], scale: number): number[] {
  const out: number[] = [r[0] * scale, r[1] * scale];
  let x = r[0], z = r[1];
  for (let i = 2; i < r.length; i += 2) {
    x += r[i]; z += r[i + 1];
    out.push(x * scale, z * scale);
  }
  return out;
}

function centroid(ring: number[]): [number, number] {
  let cx = 0, cz = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
  return [cx / n, cz / n];
}

/** Shrink a ring toward its centroid (setback tiers). */
function shrink(ring: number[], f: number): number[] {
  const [cx, cz] = centroid(ring);
  const out: number[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    out.push(cx + (ring[i] - cx) * f, cz + (ring[i + 1] - cz) * f);
  }
  return out;
}

/** Append a wireframe prism (footprint `ring` extruded to `height`) to `grp`.
 *  `ring` is a flat, simple, local-metre loop [x0,z0,x1,z1,…]. */
export function extrudePrism(
  grp: THREE.Group,
  ring: number[],
  height: number,
  mats: SceneCtx['mats'],
  rng: () => number,
  opts: PrismOpts = {},
): void {
  const n = ring.length / 2;
  if (n < 3 || height <= 0) return;

  const baseY = opts.baseY ?? 0;
  const topY = baseY + height;
  const windows = opts.windows ?? true;
  const antenna = opts.antenna ?? true;
  const opacity = opts.opacity ?? 0.45 + rng() * 0.3;
  const blinks = opts.blinks;
  const [cx, cz] = centroid(ring);

  // ── Prism edges: bottom ring + top ring + verticals, one LineSegments ──
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = ring[i * 2], zi = ring[i * 2 + 1];
    const xj = ring[j * 2], zj = ring[j * 2 + 1];
    pos.push(xi, baseY, zi, xj, baseY, zj);       // bottom edge
    pos.push(xi, topY, zi, xj, topY, zj);         // top edge
    pos.push(xi, baseY, zi, xi, topY, zi);        // vertical
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  grp.add(new THREE.LineSegments(geo, mats.M({ transparent: true, opacity })));

  // ── Windows on the facets ──
  if (windows) {
    // Whole-footprint infection roll (once), mirroring city.ts:81.
    const wm = ((opts.enemyMats && rng() < 0.25) ? opts.enemyMats : mats).MSolid(0.9);
    const floors = Math.floor(height / 4.2);
    for (let i = 0; i < n && floors > 0; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1];
      const bx = ring[j * 2], bz = ring[j * 2 + 1];
      const ex = bx - ax, ez = bz - az;
      const len = Math.hypot(ex, ez);
      const cols = Math.floor(len / 3.2);
      if (cols < 1) continue;
      // outward normal (perpendicular to the edge, pointing away from centroid)
      let nx = ez, nz = -ex;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const yaw = Math.atan2(nx, nz);
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          if (rng() >= 0.35) continue;
          const t = (c + 0.5) / cols;
          const px = ax + ex * t + nx * 0.05;
          const pz = az + ez * t + nz * 0.05;
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.09), wm);
          w.position.set(px, baseY + 2 + f * 4.2, pz);
          w.rotation.y = yaw;
          grp.add(w);
          if (blinks && rng() > 0.72) {
            blinks.push({ mesh: w, phase: rng() * Math.PI * 2, speed: 0.15 + rng() * 3.5, hi: 0.9, lo: 0.03 });
          }
        }
      }
    }
  }

  // ── Antenna + beacon (city.ts:69-76) ──
  if (antenna && height > 26 && rng() > 0.4) {
    const ah = 5 + rng() * 20;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, ah, 4), mats.M({ transparent: true, opacity: 0.88 }));
    ant.position.set(cx, topY + ah / 2, cz); grp.add(ant);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.22, 4, 4), mats.MSolid(0.9));
    bc.position.set(cx, topY + ah, cz); grp.add(bc);
    if (blinks) blinks.push({ mesh: bc, phase: rng() * Math.PI * 2, speed: 0.5 + rng() * 2, hi: 0.9, lo: 0.04 });
  }

  // ── Setback tiers (city.ts:56-66) ──
  if (opts.antenna !== false && height > 40 && rng() > 0.45) {
    const t1 = shrink(ring, 0.56);
    extrudePrism(grp, t1, height * 0.2, mats, rng, { baseY: topY, windows: false, antenna: false, opacity: 0.52 + rng() * 0.28, blinks });
    if (rng() > 0.5) {
      const t2 = shrink(ring, 0.30);
      extrudePrism(grp, t2, height * 0.13, mats, rng, { baseY: topY + height * 0.2, windows: false, antenna: false, opacity: 0.54 + rng() * 0.26, blinks });
    }
  }
}
