// MetroScene — OSM district flyover. Swift twin of scenes/metro.ts.
//
// A hybrid of a REAL OpenStreetMap district (baked into osm-district.json at build
// time, see District.swift) and procedurally generated OSM-like blocks, so the
// flythrough is infinite: tile A is the real district, tile B its procedural
// continuation, and the two scroll past the camera in turn.
//
// Structurally a sibling of CityScene — two-tile scroll, CameraFly, blinking window
// buckets, stars/dust/skyline — but the buildings are wireframe prisms extruded from
// polygon footprints (MetroGeo) instead of axis-aligned boxes. Geometry is BATCHED per
// chunk for the same reason it is there: one buffer per material beats one mesh per
// building.
//
// Layout draws from our LCG; web-seed parity is a non-goal (same stance as CityScene).
//
// Map data © OpenStreetMap contributors, ODbL 1.0
// (https://www.openstreetmap.org/copyright).

import Metal
import simd
import Foundation

final class MetroScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.008

    private let speedPerSec: Float
    private var fly: CameraFly
    private var dustItem: DrawItem!          // IUO: assigned after the chunk builders run
    private static let dustCount = 600

    /// Tile length, derived from the baked district so it tiles at TRUE scale (no
    /// squish); the procedural tile uses the same length. Web parity, metro.ts:29.
    private static let CL: Float = max(340, Float(ceil((District.shared.meta.spanZ + 26) / 10)) * 20)
    private static let SW: Float = 22        // corridor half-width kept clear for the flight path
    private static let BS: Float = 22        // procedural block spacing

    private struct Chunk { var z: Float; let items: [DrawItem] }
    private var chunks: [Chunk] = []

    private struct Bucket { let item: DrawItem; let phase: Float; let speed: Float; let hi: Float; let lo: Float }
    private var buckets: [Bucket] = []
    private let bucketCount = 6

    init(ctx: SceneContext) {
        let device = ctx.device
        speedPerSec = ctx.speed() * 0.24 * 60          // web *0.24 per frame@60
        let altTarget = ctx.settings.cityAltitude.value
        fly = CameraFly(seed: (ctx.settings.seed ?? freshSeed()) &+ 6363,
                        latAmp: 8, vertAmp: 1.6, vertBase: altTarget,
                        pitchBase: -0.08, bankScale: ctx.settings.bankStrength)

        camera.position = SIMD3(0, altTarget, 0)
        camera.rotation = SIMD3(-0.08, 0, 0)

        var base = ctx.rng
        let baseSeed = Int32(truncatingIfNeeded: Int(base.next() * 2_000_000_000))
        let CL = MetroScene.CL, SW = MetroScene.SW, half = CL / 2

        // ── one chunk's geometry, batched into a handful of buffers ───────────────
        struct Sink {
            var ground = [Float]()
            var streets = [Float]()
            var edges = [Float]()
            var antennas = [Float]()
            var beacons = [Float]()
            var wires = [Float]()
            var windows: [[Float]]
            var wb = 0                                  // window bucket round-robin
        }

        /// Ground plane as a line grid — the web draws a faint 240 × CL plane; the
        /// wireframe renderer has no surface shader, so it becomes its grid lines.
        func appendGround(_ s: inout Sink) {
            let gw: Float = 240, segX = 12, segZ = 22
            for i in 0...segX {
                let x = -gw / 2 + gw * Float(i) / Float(segX)
                s.ground.append(contentsOf: [x, 0, -half, x, 0, half])
            }
            for i in 0...segZ {
                let z = -half + CL * Float(i) / Float(segZ)
                s.ground.append(contentsOf: [-gw / 2, 0, z, gw / 2, 0, z])
            }
        }

        /// Extrude one footprint: edges, windows into the round-robin buckets, rooftop
        /// antenna + beacon, and up to two setback tiers. Mirrors extrudePrism().
        func addPrism(_ s: inout Sink, _ ring: [Float], _ height: Float, _ r: inout LCG,
                      baseY: Float = 0, windows: Bool = true, antenna: Bool = true) {
            MetroGeo.appendPrismEdges(&s.edges, ring: ring, baseY: baseY, height: height)
            let (cx, cz) = MetroGeo.centroid(ring)
            let topY = baseY + height

            if windows {
                for w in MetroGeo.facadeWindows(ring: ring, baseY: baseY, height: height, &r) {
                    MetroGeo.appendWindowQuad(&s.windows[s.wb % bucketCount], w)
                    s.wb += 1
                }
            }
            if antenna && height > 26 && r.nextF() > 0.4 {
                let ah = 5 + r.nextF() * 20
                s.antennas.append(contentsOf: [cx, topY, cz, cx, topY + ah, cz])
                s.beacons.append(contentsOf: [cx, topY + ah, cz])
            }
            // Setback tiers (geo-extrude.ts): only on the main volume, never on a tier.
            if antenna && height > 40 && r.nextF() > 0.45 {
                addPrism(&s, MetroGeo.shrink(ring, 0.56), height * 0.2, &r,
                         baseY: topY, windows: false, antenna: false)
                if r.nextF() > 0.5 {
                    addPrism(&s, MetroGeo.shrink(ring, 0.30), height * 0.13, &r,
                             baseY: topY + height * 0.2, windows: false, antenna: false)
                }
            }
        }

        // ── tile A: the real baked district ───────────────────────────────────────
        func buildDistrictChunk(_ seedOff: Int32) -> Sink {
            var s = Sink(windows: [[Float]](repeating: [], count: bucketCount))
            var r = LCG(seed: baseSeed &+ seedOff)
            let d = District.shared
            let scale = Float(d.meta.scale == 0 ? 0.1 : d.meta.scale)
            appendGround(&s)

            // Fit the district into the tile and keep the central corridor clear.
            let fitLimit = CL / 2 - 16
            let spanZ = max(1, Float(d.meta.spanZ))
            let fit = spanZ > fitLimit ? fitLimit / spanZ : 1

            for f in d.footprints {
                var ring = MetroGeo.decodeRing(f.r, scale: scale)
                for i in ring.indices { ring[i] *= fit }
                let (cx, _) = MetroGeo.centroid(ring)
                if abs(cx) < SW * 0.9 { continue }        // keep the flight corridor clear
                addPrism(&s, ring, max(6, Float(f.h) * fit), &r)
            }
            return s
        }

        // ── tile B: procedural OSM-like blocks ────────────────────────────────────
        func buildProcChunk(_ seedOff: Int32) -> Sink {
            var s = Sink(windows: [[Float]](repeating: [], count: bucketCount))
            var r = LCG(seed: baseSeed &+ seedOff)
            appendGround(&s)

            for x in [-SW * 0.55, -SW * 0.27, 0, SW * 0.27, SW * 0.55] {
                s.streets.append(contentsOf: [x, 0.08, -half, x, 0.08, half])
            }
            var zc = -half + 18
            while zc < half {
                s.streets.append(contentsOf: [-SW * 0.6, 0.08, zc, SW * 0.6, 0.08, zc])
                zc += 36
            }

            let nb = Int(CL / MetroScene.BS)
            for b in 0..<nb {
                let bz = -half + Float(b) * MetroScene.BS + MetroScene.BS / 2
                for side in [Float(-1), Float(1)] {
                    let nB = 1 + (r.nextF() > 0.5 ? 1 : 0)
                    for i in 0..<nB {
                        let baseR = 5 + r.nextF() * 9, gap = 3 + r.nextF() * 12
                        let h = 14 + r.nextF() * 78
                        let xp = side * (SW + gap + baseR)
                        let zp = bz + (nB > 1 ? (Float(i) - 0.5) * MetroScene.BS * 0.42 : 0) + (r.nextF() - 0.5) * 4
                        let ring = MetroGeo.starFootprint(&r, ox: xp, oz: zp, baseR: baseR,
                                                          aspect: 0.7 + r.nextF() * 0.7,
                                                          stretchZ: 0.7 + r.nextF() * 0.6)
                        addPrism(&s, ring, h, &r)
                    }
                }

                // Skybridge — the web sweeps a tube along a quadratic Bézier; batched
                // wireframe means the curve itself, sampled as a line strip.
                if r.nextF() > 0.72 {
                    let lx = -(SW + 6 + r.nextF() * 6), rx = SW + 6 + r.nextF() * 6
                    let by = 12 + r.nextF() * 26, my = by + 3 + r.nextF() * 12
                    let segs = 18
                    var prev = SIMD3<Float>(lx, by, bz)
                    for k in 1...segs {
                        let t = Float(k) / Float(segs), u = 1 - t
                        let p = SIMD3<Float>(u * u * lx + 2 * u * t * 0 + t * t * rx,
                                             u * u * by + 2 * u * t * my + t * t * by,
                                             bz)
                        s.wires.append(contentsOf: [prev.x, prev.y, prev.z, p.x, p.y, p.z])
                        prev = p
                    }
                }

                // Power lines: three sagging wires across the corridor.
                if r.nextF() > 0.66 {
                    let wy = 9 + r.nextF() * 16
                    for wire in 0..<3 {
                        let yo = Float(wire) * 0.45, sag = 0.75 + r.nextF() * 0.4
                        for seg in 0..<10 {
                            let t0 = Float(seg) / 10, t1 = Float(seg + 1) / 10
                            s.wires.append(contentsOf: [
                                -SW * 0.55 + t0 * SW * 1.1, wy + yo - 4 * sag * t0 * (1 - t0), bz,
                                -SW * 0.55 + t1 * SW * 1.1, wy + yo - 4 * sag * t1 * (1 - t1), bz,
                            ])
                        }
                    }
                }
            }
            return s
        }

        // ── sink → DrawItems ─────────────────────────────────────────────────────
        func line(_ a: [Float], _ op: Float) -> DrawItem {
            DrawItem(positions: Geo.buffer(device, a.isEmpty ? [0, 0, 0, 0, 0, 0] : a), indices: nil,
                     count: a.count / 3, vertexCount: a.count / 3, primitive: .line, opacity: op)
        }
        func chunk(_ s: Sink, _ z0: Float, _ r: inout LCG) -> Chunk {
            var its: [DrawItem] = [line(s.ground, 0.1), line(s.streets, 0.25),
                                   line(s.edges, 0.5), line(s.wires, 0.22), line(s.antennas, 0.88)]
            for k in 0..<bucketCount {
                let a = s.windows[k]
                if a.isEmpty { continue }
                let it = DrawItem(positions: Geo.buffer(device, a), indices: nil, count: a.count / 3,
                                  vertexCount: a.count / 3, primitive: .triangle, opacity: 0.9)
                it.infectable = r.nextF() < 0.3      // enemy infection with rising threat
                its.append(it)
                buckets.append(Bucket(item: it, phase: r.nextF() * 2 * .pi,
                                      speed: 0.15 + r.nextF() * 3.5, hi: 0.9, lo: 0.03))
            }
            if !s.beacons.isEmpty {
                its.append(DrawItem(positions: Geo.buffer(device, s.beacons), indices: nil,
                                    count: s.beacons.count / 3, vertexCount: s.beacons.count / 3,
                                    primitive: .point, opacity: 0.9, isPoint: true, pointSizeWorld: 0.5))
            }
            return Chunk(z: z0, items: its)
        }

        var rA = LCG(seed: baseSeed &+ 4242), rB = LCG(seed: baseSeed &+ 1373)
        chunks = [chunk(buildDistrictChunk(42), -CL / 2, &rA),
                  chunk(buildProcChunk(137), -CL / 2 - CL, &rB)]
        for c in chunks { for it in c.items { it.model = Mathx.translation(SIMD3(0, 0, c.z)) } }

        // ── stars, skyline silhouette, dust ───────────────────────────────────────
        var sv = [Float]()
        for _ in 0..<1200 {
            sv.append((base.nextF() - 0.5) * 700)
            sv.append(18 + base.nextF() * 200)
            sv.append(-(base.nextF() * 800 + 60))
        }
        let stars = DrawItem(positions: Geo.buffer(device, sv), indices: nil, count: 1200,
                             vertexCount: 1200, primitive: .point, opacity: 1.0,
                             isPoint: true, pointSizeWorld: 0.14)

        // Skyline: the web displaces a plane; batched, it is the horizon polyline.
        var sil = [Float]()
        let sw: Float = 550, sn = 85
        var prevX = -sw / 2
        var prevY = abs(sin(prevX * 0.024) * cos(prevX * 0.006)) * 76 + base.nextF() * 3
        for i in 1...sn {
            let x = -sw / 2 + sw * Float(i) / Float(sn)
            let y = abs(sin(x * 0.024) * cos(x * 0.006)) * 76 + base.nextF() * 3
            sil.append(contentsOf: [prevX, prevY, -900, x, y, -900])
            sil.append(contentsOf: [x, 0, -900, x, y, -900])
            prevX = x; prevY = y
        }
        let skyline = DrawItem(positions: Geo.buffer(device, sil), indices: nil, count: sil.count / 3,
                               vertexCount: sil.count / 3, primitive: .line, opacity: 0.12)

        var dv = [Float]()
        for _ in 0..<MetroScene.dustCount {
            dv.append((base.nextF() - 0.5) * 80)
            dv.append(base.nextF() * 55)
            dv.append(-(base.nextF() * 700 + 20))
        }
        dustItem = DrawItem(positions: Geo.buffer(device, dv), indices: nil,
                            count: MetroScene.dustCount, vertexCount: MetroScene.dustCount,
                            primitive: .point, opacity: 0.7, isPoint: true, pointSizeWorld: 0.065)

        items = chunks.flatMap { $0.items } + [stars, skyline, dustItem]
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t)
        let spd = speedPerSec * Float(dt)

        let n = MetroScene.dustCount
        let dptr = dustItem.positions.contents().bindMemory(to: Float.self, capacity: n * 3)
        for i in 0..<n {
            var dz = dptr[i * 3 + 2] + spd
            if dz > 10 { dz -= 720 }
            dptr[i * 3 + 2] = dz
        }

        for i in chunks.indices {
            chunks[i].z += spd
            if chunks[i].z > MetroScene.CL / 2 + 8 { chunks[i].z -= MetroScene.CL * 2 }
            let m = Mathx.translation(SIMD3(0, 0, chunks[i].z))
            for it in chunks[i].items { it.model = m }
        }
        for b in buckets {
            b.item.opacity = sin(tf * b.speed + b.phase) > 0 ? b.hi : b.lo
        }

        let f = fly.update(t: t, forwardSpeed: speedPerSec)
        camera.position = SIMD3(f.x, max(1.8, f.y), 0)      // clamp above the street
        camera.rotation = SIMD3(f.pitch, f.yaw, f.roll)
    }
}
