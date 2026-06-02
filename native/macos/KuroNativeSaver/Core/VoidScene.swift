// VoidScene — flythrough an asteroid belt: a recycled pool of wireframe
// polyhedra, a static starfield, and streaming speed particles. Ported from
// scenes/void.ts. Layout uses our LCG (web-seed parity is a non-goal).

import Metal
import simd
import Foundation

final class VoidScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.006

    private let spdMul: Float
    private var rng: LCG

    private struct Roid { var item: DrawItem; var pos: SIMD3<Float>; var rot: SIMD3<Float>; var scale: Float; var spin: SIMD3<Float> }
    private var roids: [Roid] = []
    private let speed: DrawItem
    private let spvCount = 56

    // field constants (void.ts)
    private let FIELD_W: Float = 44, NOSPAWN: Float = 5.5, BELT_S: Float = 14
    private let OFFBELT_P: Float = 0.08, FAR: Float = -68, FAR_VAR: Float = 45, BEHIND: Float = 10

    init(ctx: SceneContext) {
        let device = ctx.device
        spdMul = ctx.settings.speed.multiplier
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
        let tpls = [
            tpl(Geo.icosahedron(detail: 2)),
            tpl(Geo.icosahedron(detail: 1)),
            tpl(Geo.icosahedron(detail: 0)),
            tpl(Geo.dodecahedron()),
            tpl(irr),
        ]
        let cumW: [Float] = [0.20, 0.52, 0.70, 0.85, 1.00]
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
            let dx = x - cx, dy = y - cy; return dx * dx + dy * dy < 5.5 * 5.5
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

        // --- 90 asteroids ---
        for _ in 0..<90 {
            let t = pickTpl()
            let opacity = 0.60 + r.nextF() * 0.30
            let it = DrawItem(positions: t.pos, indices: t.idx, count: t.ic, vertexCount: t.vc,
                              primitive: .line, opacity: opacity)
            let scale = 0.9 + r.nextF() * 3.0
            let pos = seedInitial()
            let rot = SIMD3(r.nextF() * .pi, r.nextF() * .pi, r.nextF() * .pi)
            let spin = SIMD3((r.nextF() - 0.5) * 0.024, (r.nextF() - 0.5) * 0.024, (r.nextF() - 0.5) * 0.020)
            roids.append(Roid(item: it, pos: pos, rot: rot, scale: scale, spin: spin))
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
    private func inTube(_ x: Float, _ y: Float, _ cx: Float, _ cy: Float) -> Bool {
        let dx = x - cx, dy = y - cy; return dx * dx + dy * dy < NOSPAWN * NOSPAWN
    }
    private func respawn(_ cx: Float, _ cy: Float, _ cz: Float) -> SIMD3<Float>? {
        for _ in 0..<5 {
            let x = (rng.nextF() - 0.5) * 2 * FIELD_W
            let y = sampleBeltY()
            if !inTube(x, y, cx, cy) { return SIMD3(x, y, cz + FAR - rng.nextF() * FAR_VAR) }
        }
        return nil
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t), dtf = Float(dt)
        // camera flythrough
        camera.position.z -= spdMul * 14 * dtf
        let dx = sin(tf * 0.13) * 1.4 + sin(tf * 0.31) * 0.55
        let dy = cos(tf * 0.09) * 0.75 + sin(tf * 0.27) * 0.30
        camera.position.x = camera.position.x * 0.993 + dx * dtf * 1.2
        camera.position.y = camera.position.y * 0.993 + dy * dtf * 1.2
        camera.rotation = SIMD3(cos(tf * 0.11) * 0.06, sin(tf * 0.07) * 0.10, 0)

        let camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z
        let recycleZ = camZ + BEHIND
        let spinStep = spdMul * dtf * 60   // web spin is per-frame*spd; normalize to 60fps

        for i in roids.indices {
            roids[i].rot += roids[i].spin * spinStep
            if roids[i].pos.z > recycleZ, let p = respawn(camX, camY, camZ) {
                roids[i].pos = p
                roids[i].scale = 0.9 + rng.nextF() * 3.0
                roids[i].rot = SIMD3(rng.nextF() * .pi, rng.nextF() * .pi, rng.nextF() * .pi)
            }
            roids[i].item.model = model(roids[i])
        }

        // speed particles (mutate buffer in place)
        let ptr = speed.positions.contents().bindMemory(to: Float.self, capacity: spvCount * 3)
        for i in 0..<spvCount {
            let zi = i * 3 + 2
            if ptr[zi] > camZ + 2 {
                ptr[zi] = camZ - 40 - rng.nextF() * 30
                ptr[i * 3] = (rng.nextF() - 0.5) * 24 + camX
                ptr[i * 3 + 1] = (rng.nextF() - 0.5) * 16 + camY
            }
        }
    }
}
