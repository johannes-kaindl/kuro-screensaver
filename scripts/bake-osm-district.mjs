#!/usr/bin/env node
// bake-osm-district.mjs — DEV-ONLY. Never imported by the engine, never bundled.
//
// Fetches a small OpenStreetMap building district via Overpass, projects it to
// local metres, simplifies + quantises the footprints, and writes the compact
// committed data module `src/engine/data/osm-district.json` consumed by the
// `metro` scene (src/engine/engine/scenes/metro.ts).
//
// Why build-time, not runtime: the screensaver must run fully offline on every
// host (web / Windows .scr / macOS), and the Windows web bundle has a hard
// <5 MB budget. So the real-world geometry is baked once, here, and the tiny
// JSON travels inside the bundle like data/story-content.json.
//
// OSM data is © OpenStreetMap contributors, licensed ODbL 1.0. The derived
// geometry we ship carries that attribution in the JSON `meta` block and in
// the scene's boot header; see https://www.openstreetmap.org/copyright.
//
// Usage:
//   node scripts/bake-osm-district.mjs
//   OVERPASS_URL=https://overpass.kumi.systems/api/interpreter node scripts/bake-osm-district.mjs
//
// The district is defined by the constants below so the output is reproducible.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/engine/data/osm-district.json');

// ── District definition (Lower Manhattan Financial District — dense, tall,
//    well height-tagged). Change CENTER/HALF_M to re-target; the output is a
//    deterministic function of these + the OSM snapshot. ────────────────────
const CENTER_LAT = 40.7079;
const CENTER_LON = -74.0107;
const HALF_M = 230;                 // half box side in metres (~460 m square)

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// Simplification knobs
const DP_EPSILON = 1.5;             // Douglas–Peucker tolerance, metres
const MAX_VERTS = 12;               // cap ring complexity
const MIN_AREA = 12;                // drop rings smaller than this (m²)
const SCALE = 0.1;                  // quantisation step, metres (decimetres)
const LEVEL_M = 3.2;                // metres per building:level
const MAX_FOOTPRINTS = 320;         // safety cap on output size

// ── Geo helpers ───────────────────────────────────────────────────────────
const R_LAT = 111320;               // metres per degree latitude
const mPerLon = R_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);

function bbox() {
  const dLat = HALF_M / R_LAT;
  const dLon = HALF_M / mPerLon;
  return { s: CENTER_LAT - dLat, w: CENTER_LON - dLon, n: CENTER_LAT + dLat, e: CENTER_LON + dLon };
}

// lon/lat → local metres (equirectangular around the district centre).
// north → -z so the flythrough travels forward along -Z (engine convention).
function project(lat, lon) {
  return { x: (lon - CENTER_LON) * mPerLon, z: -((lat - CENTER_LAT) * R_LAT) };
}

// ── Polygon utilities (flat [x,z,x,z,…] rings) ──────────────────────────────
function signedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

function ensureCCW(r) {
  if (signedArea(r) < 0) {
    const out = [];
    for (let i = r.length / 2 - 1; i >= 0; i--) out.push(r[i * 2], r[i * 2 + 1]);
    return out;
  }
  return r;
}

// Drop the trailing duplicate vertex (OSM rings are closed) and any
// near-duplicate / collinear points.
function dedupeAndDecollinear(r) {
  let pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) pts.pop();
  }
  // remove near-duplicates
  pts = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05;
  });
  // remove collinear
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 0.5) out.push(b[0], b[1]);
  }
  return out.length >= 6 ? out : pts.flat();
}

// Douglas–Peucker on a closed ring: split at the two farthest-apart points,
// simplify each half, recombine.
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
function dpOpen(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = -1, idx = -1;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = dpOpen(pts.slice(0, idx + 1), eps);
  const right = dpOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}
function simplifyRing(r, eps) {
  let pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  if (pts.length < 4) return r;
  // farthest pair as DP anchors
  let iA = 0, iB = 0, best = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > best) { best = d; iA = i; iB = j; }
  }
  const rot = pts.slice(iA).concat(pts.slice(0, iA));
  const k = (iB - iA + pts.length) % pts.length;
  const first = rot.slice(0, k + 1), second = rot.slice(k).concat([rot[0]]);
  const s1 = dpOpen(first, eps), s2 = dpOpen(second, eps);
  const merged = s1.slice(0, -1).concat(s2.slice(0, -1));
  return merged.flat();
}

// Keep the MAX_VERTS highest-deviation vertices.
function capVerts(r, maxV) {
  let pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  while (pts.length > maxV) {
    let minD = Infinity, minI = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const d = perpDist(b, a, c);
      if (d < minD) { minD = d; minI = i; }
    }
    pts.splice(minI, 1);
  }
  return pts.flat();
}

function segIntersect(p1, p2, p3, p4) {
  const d = (b, a) => [b[0] - a[0], b[1] - a[1]];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const r = d(p2, p1), s = d(p4, p3);
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-9) return false;
  const qp = d(p3, p1);
  const t = cross(qp, s) / rxs, u = cross(qp, r) / rxs;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
function isSimple(r) {
  const pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segIntersect(a1, a2, pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

// ── PCA: principal axis of a point cloud → yaw that aligns it with Z ────────
function principalYaw(allPts) {
  let mx = 0, mz = 0;
  for (const [x, z] of allPts) { mx += x; mz += z; }
  mx /= allPts.length; mz /= allPts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of allPts) { const dx = x - mx, dz = z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  // largest-eigenvector angle of the 2×2 covariance
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  // theta is the angle of the principal axis; rotate so it lines up with +Z.
  return { yaw: Math.PI / 2 - theta, cx: mx, cz: mz };
}
function rotate(x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c - z * s, x * s + z * c];
}

// ── Height from tags ────────────────────────────────────────────────────────
function heightOf(tags, id) {
  if (tags?.height) {
    const h = parseFloat(String(tags.height).replace(/[^\d.]/g, ''));
    if (h > 0) return h;
  }
  if (tags?.['building:levels']) {
    const l = parseFloat(tags['building:levels']);
    if (l > 0) return l * LEVEL_M;
  }
  // deterministic default from the way id → 12..72 m
  let h = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 12 + (Math.abs(h) % 60);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const b = bbox();
  const query =
    `[out:json][timeout:60];way["building"](${b.s},${b.w},${b.n},${b.e});(._;>;);out body;`;

  console.log(`[bake-osm] querying ${OVERPASS_URL}`);
  console.log(`[bake-osm] bbox ${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)}`);

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass CDNs reject the default undici UA with 406; identify politely.
      'User-Agent': 'kuro-screensaver bake-osm (github.com/johannes-kaindl/kuro-screensaver)',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();

  const nodes = new Map();
  const ways = [];
  for (const el of json.elements) {
    if (el.type === 'node') nodes.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.tags?.building) ways.push(el);
  }
  console.log(`[bake-osm] ${ways.length} building ways, ${nodes.size} nodes`);

  // First pass: project + collect all vertices for the PCA alignment.
  const raw = [];
  const cloud = [];
  for (const w of ways) {
    const ring = [];
    for (const nid of w.nodes) {
      const nd = nodes.get(nid);
      if (!nd) continue;
      const p = project(nd[0], nd[1]);
      ring.push(p.x, p.z);
      cloud.push([p.x, p.z]);
    }
    if (ring.length >= 8) raw.push({ ring, h: heightOf(w.tags, w.id) });
  }
  if (!cloud.length) throw new Error('no projectable geometry returned');

  const { yaw, cx, cz } = principalYaw(cloud);

  // Second pass: rotate to align dominant axis with Z, recentre, simplify.
  const footprints = [];
  let spanZ = 0, spanX = 0;
  for (const f of raw) {
    let r = [];
    for (let i = 0; i < f.ring.length; i += 2) {
      const [rx, rz] = rotate(f.ring[i] - cx, f.ring[i + 1] - cz, yaw);
      r.push(rx, rz);
    }
    r = dedupeAndDecollinear(r);
    if (r.length < 6) continue;
    r = simplifyRing(r, DP_EPSILON);
    r = dedupeAndDecollinear(r);
    if (r.length / 2 > MAX_VERTS) r = capVerts(r, MAX_VERTS);
    if (r.length < 6) continue;
    if (Math.abs(signedArea(r)) < MIN_AREA) continue;
    if (!isSimple(r)) continue;
    r = ensureCCW(r);
    for (let i = 0; i < r.length; i += 2) {
      spanX = Math.max(spanX, Math.abs(r[i]));
      spanZ = Math.max(spanZ, Math.abs(r[i + 1]));
    }
    footprints.push({ h: Math.round(f.h), ringM: r });
  }

  // Sort by |z| so the densest core sits near the corridor centre, cap count.
  footprints.sort((a, b2) => Math.abs(a.ringM[1]) - Math.abs(b2.ringM[1]));
  const kept = footprints.slice(0, MAX_FOOTPRINTS);

  // Quantise to decimetres + delta-encode each ring.
  const q = (v) => Math.round(v / SCALE);
  const encoded = kept.map((f) => {
    const r = f.ringM;
    const out = [q(r[0]), q(r[1])];
    let px = q(r[0]), pz = q(r[1]);
    for (let i = 2; i < r.length; i += 2) {
      const cxq = q(r[i]), czq = q(r[i + 1]);
      out.push(cxq - px, czq - pz);
      px = cxq; pz = czq;
    }
    return { h: f.h, r: out };
  });

  const data = {
    meta: {
      source: '© OpenStreetMap contributors',
      license: 'ODbL 1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      attribution: 'Map data © OpenStreetMap contributors, ODbL 1.0',
      note: 'Baked at build time by scripts/bake-osm-district.mjs — geometry only, no imagery.',
      bbox: [+b.s.toFixed(6), +b.w.toFixed(6), +b.n.toFixed(6), +b.e.toFixed(6)],
      origin: [CENTER_LAT, CENTER_LON],
      scale: SCALE,
      axisYawRad: +yaw.toFixed(5),
      spanX: Math.ceil(spanX),
      spanZ: Math.ceil(spanZ),
      count: encoded.length,
      query,
    },
    footprints: encoded,
  };

  writeFileSync(OUT, JSON.stringify(data));
  const bytes = Buffer.byteLength(JSON.stringify(data));
  console.log(`[bake-osm] wrote ${OUT}`);
  console.log(`[bake-osm] ${encoded.length} footprints, ${(bytes / 1024).toFixed(1)} KB minified`);
  console.log(`[bake-osm] ${data.meta.attribution}`);
}

main().catch((err) => {
  console.error('[bake-osm] FAILED:', err.message);
  process.exit(1);
});
