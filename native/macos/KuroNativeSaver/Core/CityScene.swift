// CityScene — low flight down a procedural neon-wireframe city corridor with
// blinking windows + rooftop beacons. Ported from scenes/city.ts. Geometry is
// BATCHED per chunk (all building edges / windows / beacons into a few buffers)
// to keep draw-call count low. Layout via our LCG (web-seed parity is a non-goal).

import Metal
import simd
import Foundation

final class CityScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.008

    private let speedPerSec: Float
    private let altTarget: Float
    private var fly: CameraFly

    private static let CL: Float = 320, SW: Float = 22, BS: Float = 22

    private struct Chunk { var z: Float; let items: [DrawItem] }
    private var chunks: [Chunk] = []

    // window blink buckets (shared phase/speed per bucket)
    private struct Bucket { let item: DrawItem; let phase: Float; let speed: Float; let hi: Float; let lo: Float }
    private var buckets: [Bucket] = []
    private let bucketCount = 6

    init(ctx: SceneContext) {
        let device = ctx.device
        speedPerSec = ctx.settings.speed.multiplier * 0.24 * 60   // web *0.24 per frame@60
        altTarget = ctx.settings.cityAltitude.value
        // banking weave down the corridor (latAmp keeps it between the buildings ~±30)
        fly = CameraFly(seed: (ctx.settings.seed ?? freshSeed()) &+ 5151,
                        latAmp: 8, vertAmp: 1.6, vertBase: altTarget, pitchBase: -0.08)

        camera.position = SIMD3(0, altTarget, 0)
        camera.rotation = SIMD3(-0.08, 0, 0)

        var base = ctx.rng
        let baseSeed = Int32(truncatingIfNeeded: Int(base.next() * 2_000_000_000))

        func appendBoxEdges(_ buf: inout [Float], _ cx: Float, _ cy: Float, _ cz: Float, _ w: Float, _ h: Float, _ d: Float) {
            let x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2
            let c: [(Float, Float, Float)] = [
                (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
            ]
            let e = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
            for (a, b) in e {
                buf.append(c[a].0); buf.append(c[a].1); buf.append(c[a].2)
                buf.append(c[b].0); buf.append(c[b].1); buf.append(c[b].2)
            }
        }
        func appendWinQuad(_ buf: inout [Float], _ x: Float, _ y: Float, _ z: Float) {
            let hw: Float = 0.23, hh: Float = 0.28
            let v: [(Float, Float)] = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, -hh), (hw, hh), (-hw, hh)]
            for (dx, dy) in v { buf.append(x + dx); buf.append(y + dy); buf.append(z) }
        }

        func buildChunk(_ seedOff: Int32, _ z0: Float) -> Chunk {
            var r = LCG(seed: baseSeed &+ seedOff)
            let half = CityScene.CL / 2
            var ground = [Float](), streets = [Float](), edges = [Float](), antennas = [Float]()
            var winBuckets = [[Float]](repeating: [], count: bucketCount)
            var beacons = [Float]()
            var wb = 0   // window bucket round-robin

            // ground grid (plane 220 x CL, 22 x 44)
            let gw: Float = 220, segX = 11, segZ = 22
            for i in 0...segX {
                let x = -gw / 2 + gw * Float(i) / Float(segX)
                ground.append(x); ground.append(0); ground.append(-half)
                ground.append(x); ground.append(0); ground.append(half)
            }
            for i in 0...segZ {
                let z = -half + CityScene.CL * Float(i) / Float(segZ)
                ground.append(-gw / 2); ground.append(0); ground.append(z)
                ground.append(gw / 2); ground.append(0); ground.append(z)
            }
            // street lines
            for x in [-CityScene.SW * 0.55, -CityScene.SW * 0.27, 0, CityScene.SW * 0.27, CityScene.SW * 0.55] {
                streets.append(Float(x)); streets.append(0.08); streets.append(-half)
                streets.append(Float(x)); streets.append(0.08); streets.append(half)
            }
            var zc = -half + 18
            while zc < half {
                streets.append(-CityScene.SW * 0.6); streets.append(0.08); streets.append(zc)
                streets.append(CityScene.SW * 0.6); streets.append(0.08); streets.append(zc)
                zc += 36
            }

            // buildings
            let nb = Int(CityScene.CL / CityScene.BS)
            for b in 0..<nb {
                let bz = -half + Float(b) * CityScene.BS + CityScene.BS / 2
                for side in [Float(-1), Float(1)] {
                    let nBld = 1 + (r.nextF() > 0.45 ? 1 : 0)
                    for i in 0..<nBld {
                        let w = 10 + r.nextF() * 22, h = 14 + r.nextF() * 78, d = 10 + r.nextF() * 16
                        let gap = 3 + r.nextF() * 13
                        let xp = side * (CityScene.SW + gap + w / 2)
                        let zp = bz + (nBld > 1 ? (Float(i) - 0.5) * CityScene.BS * 0.42 : 0) + (r.nextF() - 0.5) * 4
                        appendBoxEdges(&edges, xp, h / 2, zp, w, h, d)
                        if h > 40 && r.nextF() > 0.45 {
                            let tw = w * 0.56, td = d * 0.56, th = h * 0.2
                            appendBoxEdges(&edges, xp, h + th / 2, zp, tw, th, td)
                        }
                        if h > 26 && r.nextF() > 0.4 {
                            let ah = 5 + r.nextF() * 20
                            antennas.append(xp); antennas.append(h); antennas.append(zp)
                            antennas.append(xp); antennas.append(h + ah); antennas.append(zp)
                            beacons.append(xp); beacons.append(h + ah); beacons.append(zp)
                        }
                        let fl = Int(h / 4.2), wc = max(1, Int(w / 3.2))
                        for f in 0..<fl {
                            for c in 0..<wc where r.nextF() < 0.35 {
                                let wx = xp - w / 2 + 0.55 + Float(c) * (w / Float(wc))
                                let wy = 2 + Float(f) * 4.2
                                let wz = zp + (r.nextF() > 0.5 ? d / 2 + 0.04 : -d / 2 - 0.04)
                                appendWinQuad(&winBuckets[wb % bucketCount], wx, wy, wz)
                                wb += 1
                            }
                        }
                    }
                }
            }

            func line(_ a: [Float], _ op: Float) -> DrawItem {
                DrawItem(positions: Geo.buffer(device, a.isEmpty ? [0, 0, 0, 0, 0, 0] : a), indices: nil,
                         count: a.count / 3, vertexCount: a.count / 3, primitive: .line, opacity: op)
            }
            var its: [DrawItem] = [line(ground, 0.12), line(streets, 0.25), line(edges, 0.5), line(antennas, 0.88)]
            // window buckets (solid triangles, animated opacity)
            for k in 0..<bucketCount {
                let a = winBuckets[k]
                if a.isEmpty { continue }
                let it = DrawItem(positions: Geo.buffer(device, a), indices: nil, count: a.count / 3,
                                  vertexCount: a.count / 3, primitive: .triangle, opacity: 0.9)
                its.append(it)
                buckets.append(Bucket(item: it, phase: r.nextF() * 2 * .pi, speed: 0.15 + r.nextF() * 3.5, hi: 0.9, lo: 0.03))
            }
            // beacons
            if !beacons.isEmpty {
                its.append(DrawItem(positions: Geo.buffer(device, beacons), indices: nil, count: beacons.count / 3,
                                    vertexCount: beacons.count / 3, primitive: .point, opacity: 0.9,
                                    isPoint: true, pointSizeWorld: 0.5))
            }
            // model offset: chunk z translate set per frame
            return Chunk(z: z0, items: its)
        }

        chunks = [buildChunk(42, -160), buildChunk(137, -480)]
        for c in chunks { for it in c.items { it.model = Mathx.translation(SIMD3(0, 0, c.z)) } }

        // stars + dust (direct in world, static)
        var sv = [Float](), dv = [Float]()
        for _ in 0..<700 { sv.append((base.nextF() - 0.5) * 360); sv.append(base.nextF() * 120 + 20); sv.append(-(base.nextF() * 500 + 40)) }
        for _ in 0..<400 { dv.append((base.nextF() - 0.5) * 80); dv.append(base.nextF() * 40 + 2); dv.append(-(base.nextF() * 240 + 5)) }
        let stars = DrawItem(positions: Geo.buffer(device, sv), indices: nil, count: 700, vertexCount: 700,
                             primitive: .point, opacity: 1.0, isPoint: true, pointSizeWorld: 0.14)
        let dust = DrawItem(positions: Geo.buffer(device, dv), indices: nil, count: 400, vertexCount: 400,
                            primitive: .point, opacity: 0.7, isPoint: true, pointSizeWorld: 0.065)

        items = chunks.flatMap { $0.items } + [stars, dust]
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t)
        let spd = speedPerSec * Float(dt)
        for i in chunks.indices {
            chunks[i].z += spd
            if chunks[i].z > CityScene.CL / 2 + 8 { chunks[i].z -= CityScene.CL * 2 }
            let m = Mathx.translation(SIMD3(0, 0, chunks[i].z))
            for it in chunks[i].items { it.model = m }
        }
        for b in buckets {
            b.item.opacity = sin(tf * b.speed + b.phase) > 0 ? b.hi : b.lo
        }

        let f = fly.update(t: t, forwardSpeed: speedPerSec)
        camera.position = SIMD3(f.x, max(1.8, f.y), 0)   // clamp above the street
        camera.rotation = SIMD3(f.pitch, f.yaw, f.roll)
    }
}
