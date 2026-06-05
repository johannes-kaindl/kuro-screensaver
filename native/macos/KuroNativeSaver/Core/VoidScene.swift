// VoidScene — flythrough an asteroid belt: a recycled pool of wireframe
// polyhedra, a static starfield, and streaming speed particles. Ported from
// scenes/void.ts. Layout uses our LCG (web-seed parity is a non-goal).

import Metal
import simd
import Foundation

final class VoidScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    private let debris: Bool
    var fogDensity: Float { debris ? 0.006 : 0.0045 }   // wreckage variant: denser haze

    private let spdMul: Float
    private var rng: LCG
    private var fly: CameraFly

    private struct Roid { var item: DrawItem; var pos: SIMD3<Float>; var rot: SIMD3<Float>; var scale: Float; var spin: SIMD3<Float>; var baseOpacity: Float }
    private var roids: [Roid] = []
    private var heading: Float = 0, headTarget: Float = 0, prevHeading: Float = 0
    private var nextTurnT: Double = 20
    private var camPath = SIMD3<Float>(0, 0, 0)
    private let speed: DrawItem
    var storm: Float = 0            // reactive-world PANIC storm (set by Renderer)
    private let spvCount = 56

    // field constants (void.ts)
    private let FIELD_W: Float = 44, NOSPAWN: Float = 16, BELT_S: Float = 14
    private let OFFBELT_P: Float = 0.08, FAR: Float = -100, FAR_VAR: Float = 55, BEHIND: Float = 10
    private let FADE_START: Float = 100, FADE_RANGE: Float = 24   // distance-based fade-in (no pop)

    init(ctx: SceneContext, debris: Bool = false) {
        self.debris = debris
        let device = ctx.device
        spdMul = ctx.speed()
        fly = CameraFly(seed: (ctx.settings.seed ?? freshSeed()) &+ 6262,
                        latAmp: 6, vertAmp: 3, vertBase: 0, pitchBase: 0, bankScale: ctx.settings.bankStrength)
        var r = ctx.rng

        camera.position = SIMD3(0, 0, 0)
        camera.rotation = SIMD3(0, 0, 0)

        // --- 5 shared geometry templates ---
        struct Tpl { let pos: MTLBuffer; let idx: MTLBuffer; let vc: Int; let ic: Int }
        func tpl(_ g: (pos: [SIMD3<Float>], idx: [UInt32])) -> Tpl {
            var flat = [Float](); flat.reserveCapacity(g.pos.count * 3)
            for p in g.pos { flat.append(p.x); flat.append(p.y); flat.append(p.z) }
            return Tpl(pos: Geo.buffer(device, flat), idx: Geo.buffer(device, g.idx),
                       vc: g.pos.count, ic: g.idx.count)
        }
        var irr = Geo.icosahedron(detail: 1)
        for i in irr.pos.indices { irr.pos[i] *= (0.62 + r.nextF() * 0.55) }
        let tpls: [Tpl]
        let cumW: [Float]
        if debris {
            tpls = [
                tpl(Geo.box(1.5, 1.0, 0.06)),    // hull panel
                tpl(Geo.box(0.7, 1.8, 0.06)),    // tall panel
                tpl(Geo.box(0.13, 0.13, 3.0)),   // strut / girder
                tpl(Geo.icosahedron(detail: 0)), // angular chunk
            ]
            cumW = [0.30, 0.52, 0.74, 1.00]
        } else {
            tpls = [
                tpl(Geo.icosahedron(detail: 2)),
                tpl(Geo.icosahedron(detail: 1)),
                tpl(Geo.icosahedron(detail: 0)),
                tpl(Geo.dodecahedron()),
                tpl(irr),
            ]
            cumW = [0.20, 0.52, 0.70, 0.85, 1.00]
        }
        let tum: Float = debris ? 2.2 : 1   // erratic wreckage tumble
        func pickTpl() -> Tpl {
            let x = r.nextF()
            for i in 0..<cumW.count where x < cumW[i] { return tpls[i] }
            return tpls[0]
        }

        func sampleBeltY() -> Float {
            if r.nextF() < 0.08 { return (r.nextF() - 0.5) * 50 }
            return ((r.nextF() - 0.5) + (r.nextF() - 0.5)) * 14 * 1.6
        }
        func inTube(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float) -> Bool {
            let dx = x - cx, dy = y - cy; return dx * dx + dy * dy < 16 * 16
        }
        func seedInitial() -> SIMD3<Float> {
            for _ in 0..<5 {
                let x = (r.nextF() - 0.5) * 2 * 44
                let y = sampleBeltY()
                let z = -18 - r.nextF() * 95
                if !inTube(x, y, 0, 0) { return SIMD3(x, y, z) }
            }
            return SIMD3((r.nextF() < 0.5 ? -1 : 1) * (8 + r.nextF() * 10), sampleBeltY(), -18 - r.nextF() * 95)
        }

        // --- asteroids (fewer; fade in from the far plane) ---
        for _ in 0..<60 {
            let t = pickTpl()
            let opacity = 0.60 + r.nextF() * 0.30
            let it = DrawItem(positions: t.pos, indices: t.idx, count: t.ic, vertexCount: t.vc,
                              primitive: .line, opacity: opacity)
            it.infectable = r.nextF() < 0.3   // ~30% crossfade to the enemy colour with threat
            let scale = 0.9 + r.nextF() * 3.0
            let pos = seedInitial()
            let rot = SIMD3(r.nextF() * .pi, r.nextF() * .pi, r.nextF() * .pi)
            let spin = SIMD3((r.nextF() - 0.5) * 0.024 * tum, (r.nextF() - 0.5) * 0.024 * tum, (r.nextF() - 0.5) * 0.020 * tum)
            roids.append(Roid(item: it, pos: pos, rot: rot, scale: scale, spin: spin, baseOpacity: opacity))
        }

        // --- starfield (2200 static) ---
        var sv = [Float](); sv.reserveCapacity(2200 * 3)
        for _ in 0..<2200 {
            sv.append((r.nextF() - 0.5) * 240)
            sv.append((r.nextF() - 0.5) * 140)
            sv.append((r.nextF() - 0.5) * 260 - 50)
        }
        let stars = DrawItem(positions: Geo.buffer(device, sv), indices: nil, count: 2200,
                             vertexCount: 2200, primitive: .point, opacity: 1.0,
                             isPoint: true, pointSizeWorld: 0.09)

        // --- speed particles (56 streamed) ---
        var pv = [Float](); pv.reserveCapacity(spvCount * 3)
        for _ in 0..<spvCount {
            pv.append((r.nextF() - 0.5) * 24); pv.append((r.nextF() - 0.5) * 16); pv.append(-r.nextF() * 60)
        }
        speed = DrawItem(positions: Geo.buffer(device, pv), indices: nil, count: spvCount,
                         vertexCount: spvCount, primitive: .point, opacity: 1.0,
                         isPoint: true, pointSizeWorld: 0.14)

        rng = r
        items = roids.map { $0.item } + [stars, speed]
    }

    private func model(_ a: Roid) -> matrix_float4x4 {
        Mathx.translation(a.pos)
        * Mathx.rotationY(a.rot.y) * Mathx.rotationX(a.rot.x) * Mathx.rotationZ(a.rot.z)
        * Mathx.scale(a.scale)
    }

    private func sampleBeltY() -> Float {
        if rng.nextF() < OFFBELT_P { return (rng.nextF() - 0.5) * 50 }
        return ((rng.nextF() - 0.5) + (rng.nextF() - 0.5)) * BELT_S * 1.6
    }
    private func respawnAhead(_ fwd: SIMD3<Float>, _ right: SIMD3<Float>) -> SIMD3<Float>? {
        for _ in 0..<5 {
            let lat = (rng.nextF() - 0.5) * 2 * FIELD_W, y = sampleBeltY()
            if lat * lat + y * y < NOSPAWN * NOSPAWN { continue }   // keep the path tube clear
            let d = -FAR + rng.nextF() * FAR_VAR                    // ahead along the heading
            return SIMD3(camPath.x + fwd.x * d + right.x * lat, y, camPath.z + fwd.z * d + right.z * lat)
        }
        return nil
    }

    func update(t: Double, dt: Double) {
        let dtf = Float(dt)
        // Course: occasionally pick a new heading; ease toward it (Void truly translates
        // through world-static rocks → a real heading change reads convincingly).
        if t > nextTurnT {
            headTarget += (rng.nextF() < 0.5 ? -1 : 1) * (0.5 + rng.nextF() * 0.9)
            nextTurnT = t + 8 + Double(rng.nextF()) * 12
        }
        prevHeading = heading
        heading += (headTarget - heading) * (1 - exp(-dtf / 2.6))
        let fwd = SIMD3<Float>(sin(heading), 0, -cos(heading))
        let right = SIMD3<Float>(cos(heading), 0, sin(heading))

        camPath += fwd * (spdMul * 14 * dtf)
        let f = fly.update(t: t, forwardSpeed: spdMul * 14)
        // Lateral weave kept small (it WAS the strafe); the heading is the real lateral motion.
        camera.position = SIMD3(camPath.x + right.x * f.x * 0.3, f.y, camPath.z + right.z * f.x * 0.3)
        let turnRate = (heading - prevHeading) / max(1e-4, dtf)
        camera.rotation = SIMD3(f.pitch, heading + f.yaw * 0.3, f.roll - turnRate * 2.6)

        let spinStep = spdMul * dtf * 60   // web spin is per-frame*spd; normalize to 60fps

        for i in roids.indices {
            roids[i].rot += roids[i].spin * spinStep
            let ahead = simd_dot(roids[i].pos - camPath, fwd)   // forward distance along heading
            if ahead < -BEHIND, let p = respawnAhead(fwd, right) {
                roids[i].pos = p
                roids[i].scale = 0.9 + rng.nextF() * 3.0
                roids[i].rot = SIMD3(rng.nextF() * .pi, rng.nextF() * .pi, rng.nextF() * .pi)
            }
            // distance-based fade-in so they don't pop into view at the far plane
            let dist = -simd_dot(roids[i].pos - camPath, fwd)
            roids[i].item.opacity = roids[i].baseOpacity * max(0, min(1, (FADE_START - dist) / FADE_RANGE))
            roids[i].item.model = model(roids[i])
        }

        // speed particles (mutate buffer in place); the PANIC storm widens + enlarges them.
        let spreadX = 24 * (1 + storm * 0.5), spreadY = 16 * (1 + storm * 0.5)
        speed.pointSizeWorld = 0.14 + storm * 0.12
        let ptr = speed.positions.contents().bindMemory(to: Float.self, capacity: spvCount * 3)
        for i in 0..<spvCount {
            let ahead = (ptr[i * 3] - camPath.x) * fwd.x + (ptr[i * 3 + 2] - camPath.z) * fwd.z
            if ahead < -2 {
                let d = 40 + rng.nextF() * 30, lat = (rng.nextF() - 0.5) * spreadX
                ptr[i * 3]     = camPath.x + fwd.x * d + right.x * lat
                ptr[i * 3 + 1] = (rng.nextF() - 0.5) * spreadY + f.y
                ptr[i * 3 + 2] = camPath.z + fwd.z * d + right.z * lat
            }
        }
    }
}
