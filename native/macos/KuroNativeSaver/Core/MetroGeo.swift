// MetroGeo — polygon-footprint geometry for the METRO scene. Swift twin of
// engine/geo-extrude.ts plus the footprint generator from scenes/metro.ts.
//
// Pure: flat [Float] in, flat [Float] out, no Metal and no scene state — which is why
// it is a separate file from MetroScene and why the logic tests can reach it.
//
// The native renderer BATCHES (see CityScene): a chunk's building edges all land in one
// buffer instead of one mesh per building. So where the web appends THREE objects to a
// Group, these helpers append raw triangle/line vertices to an `inout [Float]`.
//
// Deliberately not a triangulated extrusion: the look is wireframe lines, so a prism is
// bottom ring + top ring + verticals — the same idiom as the city street grid.

import Foundation
import simd

enum MetroGeo {
    /// Decode an osm-district.json ring (delta-encoded decimetres) into a flat metre
    /// loop [x0,z0,x1,z1,…]. The first pair is absolute, every later pair is a delta.
    static func decodeRing(_ r: [Int], scale: Float) -> [Float] {
        guard r.count >= 2 else { return [] }
        var out: [Float] = [Float(r[0]) * scale, Float(r[1]) * scale]
        out.reserveCapacity(r.count)
        var x = r[0], z = r[1]
        var i = 2
        while i + 1 < r.count {
            x += r[i]; z += r[i + 1]
            out.append(Float(x) * scale); out.append(Float(z) * scale)
            i += 2
        }
        return out
    }

    static func centroid(_ ring: [Float]) -> (Float, Float) {
        let n = ring.count / 2
        guard n > 0 else { return (0, 0) }
        var cx: Float = 0, cz: Float = 0
        for i in 0..<n { cx += ring[i * 2]; cz += ring[i * 2 + 1] }
        return (cx / Float(n), cz / Float(n))
    }

    /// Shrink a ring toward its centroid — the setback tiers of a stepped tower.
    static func shrink(_ ring: [Float], _ f: Float) -> [Float] {
        let (cx, cz) = centroid(ring)
        var out = [Float](); out.reserveCapacity(ring.count)
        var i = 0
        while i + 1 < ring.count {
            out.append(cx + (ring[i] - cx) * f)
            out.append(cz + (ring[i + 1] - cz) * f)
            i += 2
        }
        return out
    }

    /// Append the wireframe prism of `ring` extruded from `baseY` by `height`:
    /// per side one bottom edge, one top edge and one vertical — 3 segments, 18 floats.
    /// A ring with fewer than 3 vertices or a non-positive height emits nothing (the web
    /// returns early for the same case; here it must not append a half prism either).
    static func appendPrismEdges(_ buf: inout [Float], ring: [Float], baseY: Float, height: Float) {
        let n = ring.count / 2
        guard n >= 3, height > 0 else { return }
        let topY = baseY + height
        buf.reserveCapacity(buf.count + n * 18)
        for i in 0..<n {
            let j = (i + 1) % n
            let xi = ring[i * 2], zi = ring[i * 2 + 1]
            let xj = ring[j * 2], zj = ring[j * 2 + 1]
            buf.append(contentsOf: [xi, baseY, zi, xj, baseY, zj])   // bottom edge
            buf.append(contentsOf: [xi, topY, zi, xj, topY, zj])     // top edge
            buf.append(contentsOf: [xi, baseY, zi, xi, topY, zi])    // vertical
        }
    }

    /// A star-shaped polygon: vertices at monotonically increasing angles around
    /// (ox, oz), so the ring is always simple and extrudes cleanly. The jitter stays
    /// below half a step, which is what preserves the order; `aspect`/`stretchZ` are
    /// positive anisotropic scalings and those preserve angular order too.
    static func starFootprint(_ rng: inout LCG, ox: Float, oz: Float,
                              baseR: Float, aspect: Float, stretchZ: Float) -> [Float] {
        let nv = 4 + Int(rng.next() * 5)                 // 4..8 vertices
        let off = rng.nextF() * 2 * .pi
        let step = (2 * Float.pi) / Float(nv)
        var ring = [Float](); ring.reserveCapacity(nv * 2)
        for i in 0..<nv {
            let ang = off + Float(i) * step + (rng.nextF() - 0.5) * step * 0.6
            let rr = baseR * (0.7 + 0.5 * rng.nextF())
            ring.append(ox + cos(ang) * rr * aspect)
            ring.append(oz + sin(ang) * rr * stretchZ)
        }
        return ring
    }

    /// One lit facade window: world position plus the yaw that turns the quad to face
    /// outward. The caller batches these into blink buckets.
    struct WindowSlot {
        let x: Float, y: Float, z: Float, yaw: Float
    }

    /// Facade windows for a prism, mirroring geo-extrude.ts: one grid per facet, a
    /// 35 % fill roll per cell, the quad pushed 5 cm out along the facet's outward
    /// normal. Draws exactly as many random numbers as the web does, in the same order.
    static func facadeWindows(ring: [Float], baseY: Float, height: Float,
                              _ rng: inout LCG) -> [WindowSlot] {
        let n = ring.count / 2
        let floors = Int(height / 4.2)
        guard n >= 3, floors > 0 else { return [] }
        let (cx, cz) = centroid(ring)
        var out: [WindowSlot] = []
        for i in 0..<n {
            let j = (i + 1) % n
            let ax = ring[i * 2], az = ring[i * 2 + 1]
            let bx = ring[j * 2], bz = ring[j * 2 + 1]
            let ex = bx - ax, ez = bz - az
            let len = (ex * ex + ez * ez).squareRoot()
            let cols = Int(len / 3.2)
            if cols < 1 { continue }
            // outward normal: perpendicular to the edge, flipped away from the centroid
            var nx = ez, nz = -ex
            let nl = (nx * nx + nz * nz).squareRoot()
            if nl > 0 { nx /= nl; nz /= nl }
            let mx = (ax + bx) / 2, mz = (az + bz) / 2
            if (mx - cx) * nx + (mz - cz) * nz < 0 { nx = -nx; nz = -nz }
            let yaw = atan2(nx, nz)
            for f in 0..<floors {
                for c in 0..<cols {
                    if rng.nextF() >= 0.35 { continue }
                    let t = (Float(c) + 0.5) / Float(cols)
                    out.append(WindowSlot(x: ax + ex * t + nx * 0.05,
                                          y: baseY + 2 + Float(f) * 4.2,
                                          z: az + ez * t + nz * 0.05,
                                          yaw: yaw))
                }
            }
        }
        return out
    }

    /// A window quad (two triangles) rotated by `yaw` around Y, appended flat.
    /// The web builds a thin BoxGeometry; a quad is the batched equivalent and matches
    /// what CityScene already emits for its own windows.
    static func appendWindowQuad(_ buf: inout [Float], _ w: WindowSlot) {
        let hw: Float = 0.23, hh: Float = 0.28
        let s = sin(w.yaw), c = cos(w.yaw)
        let corners: [(Float, Float)] = [(-hw, -hh), (hw, -hh), (hw, hh),
                                         (-hw, -hh), (hw, hh), (-hw, hh)]
        for (dx, dy) in corners {
            buf.append(w.x + dx * c)
            buf.append(w.y + dy)
            buf.append(w.z - dx * s)
        }
    }
}
