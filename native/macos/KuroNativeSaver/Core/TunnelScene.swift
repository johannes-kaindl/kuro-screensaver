// TunnelScene — flight through a closed wireframe ring-tunnel along a
// Catmull-Rom spine, with parallel-transport frames, banking, auto-boost on
// straight sections, a neon floor strip and streaming particles. Ported from
// scenes/tunnel.ts (layout via our LCG; web-seed parity is a non-goal).

import Metal
import simd
import Foundation

// Closed uniform Catmull-Rom spline (tension 0.5) with arc-length reparam.
private struct Spline {
    let pts: [SIMD3<Float>]
    private var lutT: [Float] = []      // t at cumulative-length samples
    private var lutLen: [Float] = []
    private var total: Float = 0

    init(_ pts: [SIMD3<Float>]) {
        self.pts = pts
        let samples = max(400, pts.count * 12)
        var prev = point(0)
        lutT.append(0); lutLen.append(0)
        for k in 1...samples {
            let t = Float(k) / Float(samples)
            let p = point(t)
            total += simd_distance(p, prev); prev = p
            lutT.append(t); lutLen.append(total)
        }
    }

    /// Uniform Catmull-Rom over the closed control polygon, tg in [0,1).
    func point(_ tg: Float) -> SIMD3<Float> {
        let n = pts.count
        let seg = tg * Float(n)
        let i = Int(seg.rounded(.down))
        let f = seg - Float(i)
        let p0 = pts[((i - 1) % n + n) % n], p1 = pts[i % n]
        let p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
        let t2 = f * f, t3 = t2 * f
        // Catmull-Rom basis — broken into pairwise SIMD ops with explicit Float
        // scalars so swiftc can't time out type-checking the combined expression.
        let c0 = p1 * Float(2)
        let c1 = (p2 - p0) * f
        let c2v = (p0 * Float(2) - p1 * Float(5)) + (p2 * Float(4) - p3)
        let c2 = c2v * t2
        let c3v = (p1 * Float(3) - p2 * Float(3)) + (p3 - p0)
        let c3 = c3v * t3
        return (c0 + c1 + c2 + c3) * Float(0.5)
    }

    /// Arc-length parameterized point, u in [0,1).
    func pointAt(_ u: Float) -> SIMD3<Float> {
        let target = u * total
        var lo = 0, hi = lutLen.count - 1
        while lo < hi { let mid = (lo + hi) / 2; if lutLen[mid] < target { lo = mid + 1 } else { hi = mid } }
        let i = max(1, lo)
        let l0 = lutLen[i - 1], l1 = lutLen[i]
        let frac = l1 > l0 ? (target - l0) / (l1 - l0) : 0
        return point(lutT[i - 1] + (lutT[i] - lutT[i - 1]) * frac)
    }
}

private func wrap(_ v: Float) -> Float { let m = v.truncatingRemainder(dividingBy: 1); return (m + 1).truncatingRemainder(dividingBy: 1) }

final class TunnelScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.024

    private let spline: Spline
    private let autoBoost: Bool
    private let sceneSpeed: Float

    // camera/traversal state
    private var u: Float = 0
    private var currentRoll: Float = 0
    private var speedMul: Float = 1, speedMulTarget: Float = 1
    private var straightFrames = 0
    private var inBoost = false
    private var fov: Float = 0   // own fov ease state (renderer resets camera.fovDegrees each frame)

    // beacons (batched point cloud, pulsed as a whole)
    private let beacons: DrawItem?

    // particles
    private let particles: DrawItem
    private let pCount = 200
    private var pU: [Float] = []
    private var pOff: [(Float, Float)] = []
    private var rng: LCG

    init(ctx: SceneContext) {
        let device = ctx.device
        autoBoost = ctx.settings.tunnelAutoBoost
        sceneSpeed = ctx.settings.speed.multiplier
        var r = ctx.rng

        // --- build spine (random walk of straight/curve segments) ---
        var sp: [SIMD3<Float>] = [SIMD3(0, 0, 0)]
        var cursor = SIMD3<Float>(0, 0, 0)
        var dir = SIMD3<Float>(0, 0, -1)
        var totalRings = 1
        func applyEuler(_ v: SIMD3<Float>, _ x: Float, _ y: Float) -> SIMD3<Float> {
            let m = Mathx.rotationX(x) * Mathx.rotationY(y)
            let rr = m * SIMD4<Float>(v, 0); return simd_normalize(SIMD3(rr.x, rr.y, rr.z))
        }
        while totalRings < 140 {
            if r.nextF() < 0.55 {
                let len = 5 + Int(r.nextF() * 4)
                let turn = (r.nextF() - 0.5) * 0.9
                let climb = (r.nextF() - 0.5) * 0.45
                for _ in 0..<len { dir = applyEuler(dir, climb / Float(len), turn / Float(len)); cursor += dir * 5; sp.append(cursor); totalRings += 1 }
            } else {
                let len = 4 + Int(r.nextF() * 4)
                for _ in 0..<len { cursor += dir * 5; sp.append(cursor); totalRings += 1 }
            }
        }
        // close the loop smoothly (cubic bezier from last back toward first)
        if sp.count >= 4 {
            let last = sp[sp.count - 1], lastPrev = sp[sp.count - 2], first = sp[0], second = sp[1]
            let lastDir = simd_normalize(last - lastPrev), firstDir = simd_normalize(second - first)
            let gap = simd_distance(last, first)
            let cs = max(20, Int(gap / 5) + 12)
            let d = gap * 0.35
            let p1 = last + lastDir * d, p2 = first - firstDir * d
            for i in 1..<cs {
                let t = Float(i) / Float(cs), it = 1 - t
                sp.append(it * it * it * last + 3 * it * it * t * p1 + 3 * it * t * t * p2 + t * t * t * first)
            }
        }
        spline = Spline(sp)

        // --- parallel-transport frames at 140 samples ---
        let samples = 140
        var P = [SIMD3<Float>](repeating: .zero, count: samples)
        var T = [SIMD3<Float>](repeating: .zero, count: samples)
        var N = [SIMD3<Float>](repeating: .zero, count: samples)
        var B = [SIMD3<Float>](repeating: .zero, count: samples)
        for i in 0..<samples {
            let uu = Float(i) / Float(samples - 1)
            P[i] = spline.pointAt(uu)
            T[i] = simd_normalize(spline.pointAt(wrap(uu + 0.002)) - spline.pointAt(wrap(uu - 0.002)))
        }
        // initial normal: pick an axis least aligned with T[0]
        let a = abs(T[0])
        let seed = a.x <= a.y && a.x <= a.z ? SIMD3<Float>(1, 0, 0) : (a.y <= a.z ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(0, 0, 1))
        N[0] = simd_normalize(simd_cross(seed, T[0])); B[0] = simd_cross(T[0], N[0])
        for i in 1..<samples {
            let v = simd_cross(T[i - 1], T[i]); let len = simd_length(v)
            if len < 1e-6 { N[i] = N[i - 1] } else {
                let axis = v / len; let ang = acos(max(-1, min(1, simd_dot(T[i - 1], T[i]))))
                N[i] = Mathx.rotate(N[i - 1], axis: axis, angle: ang)
            }
            B[i] = simd_normalize(simd_cross(T[i], N[i])); N[i] = simd_cross(B[i], T[i])
        }

        // --- ring + secondary torus templates (scaled per ring by r/4) ---
        let primG = Geo.torus(R: 4, tube: 0.07, radial: 6, tubular: 64)
        let secG = Geo.torus(R: 4 * 1.35, tube: 0.04, radial: 4, tubular: 32)
        let primPos = Geo.buffer(device, primG.pos), primIdx = Geo.buffer(device, primG.idx)
        let secPos = Geo.buffer(device, secG.pos), secIdx = Geo.buffer(device, secG.idx)
        let primVC = primG.pos.count / 3, secVC = secG.pos.count / 3

        func orient(_ n: SIMD3<Float>, _ b: SIMD3<Float>, _ t: SIMD3<Float>, _ p: SIMD3<Float>, _ s: Float) -> matrix_float4x4 {
            let rot = float4x4(columns: (SIMD4(n, 0), SIMD4(b, 0), SIMD4(t, 0), SIMD4<Float>(0, 0, 0, 1)))
            return Mathx.translation(p) * rot * Mathx.scale(s)
        }

        var ringItems: [DrawItem] = []
        var floorPts = [Float](); floorPts.reserveCapacity(samples * 3)
        var beaconPts = [Float]()
        for i in 0..<samples {
            let rRad = 4 + sin(Float(i) * 0.4) * 0.7
            let s = rRad / 4
            ringItems.append(DrawItem(positions: primPos, indices: primIdx, count: primG.idx.count,
                                      vertexCount: primVC, primitive: .line,
                                      model: orient(N[i], B[i], T[i], P[i], s), opacity: 0.78))
            if i % 8 == 0 && i > 0 {
                ringItems.append(DrawItem(positions: secPos, indices: secIdx, count: secG.idx.count,
                                          vertexCount: secVC, primitive: .line,
                                          model: orient(N[i], B[i], T[i], P[i], s), opacity: 0.4))
            }
            if i % 4 == 0 && i > 0 {
                for dx in [Float(-1), Float(1)] {
                    let wpos = P[i] + N[i] * (dx * (rRad - 0.4))
                    beaconPts.append(wpos.x); beaconPts.append(wpos.y); beaconPts.append(wpos.z)
                    _ = r.nextF(); _ = r.nextF()   // (web consumes phase+speed here)
                }
            }
            let fp = P[i] - B[i] * 3.6
            floorPts.append(fp.x); floorPts.append(fp.y); floorPts.append(fp.z)
        }

        let floor = DrawItem(positions: Geo.buffer(device, floorPts), indices: nil, count: samples,
                             vertexCount: samples, primitive: .lineStrip, opacity: 0.62)
        beacons = DrawItem(positions: Geo.buffer(device, beaconPts), indices: nil,
                           count: beaconPts.count / 3, vertexCount: beaconPts.count / 3,
                           primitive: .point, opacity: 0.9, isPoint: true, pointSizeWorld: 0.4)

        // --- particles ---
        var pv = [Float](repeating: 0, count: pCount * 3)
        for _ in 0..<pCount { pU.append(r.nextF()); pOff.append(((r.nextF() - 0.5) * 6, (r.nextF() - 0.5) * 6)) }
        particles = DrawItem(positions: Geo.buffer(device, pv), indices: nil, count: pCount,
                             vertexCount: pCount, primitive: .point, opacity: 1.0,
                             isPoint: true, pointSizeWorld: 0.08)
        _ = pv

        rng = r
        items = ringItems + [floor, beacons!, particles]

        // initial camera
        camera.position = spline.pointAt(0)
        camera.viewOverride = Mathx.lookAt(eye: spline.pointAt(0), center: spline.pointAt(0.001), up: SIMD3(0, 1, 0))
    }

    func update(t: Double, dt: Double) {
        let baseStep = sceneSpeed * 0.028 * Float(dt) * speedMul   // 0.000028 * dt_ms (dt_ms = dt*1000)
        u = wrap(u + baseStep)
        let here = spline.pointAt(u)
        let ahead = spline.pointAt(wrap(u + 0.005))
        let farr = spline.pointAt(wrap(u + 0.025))
        let tan1 = simd_normalize(ahead - here), tan2 = simd_normalize(farr - ahead)
        let curveDelta = tan2 - tan1
        let curvLat = curveDelta.x, curvMag = simd_length(curveDelta)

        if autoBoost && curvMag < 0.0015 {
            straightFrames += 1
            if straightFrames > 30 && !inBoost { inBoost = true; speedMulTarget = 2.5 }
        } else {
            straightFrames = 0
            if inBoost { inBoost = false; speedMulTarget = 1 }
        }
        speedMul += (speedMulTarget - speedMul) * 0.05

        // banking roll + lookAt view
        let targetRoll = -curvLat * 8
        currentRoll += (targetRoll - currentRoll) * 0.04
        var view = Mathx.lookAt(eye: here, center: ahead, up: SIMD3(0, 1, 0))
        view = Mathx.rotationZ(currentRoll) * view
        camera.position = here
        camera.viewOverride = view

        // fov boost: ease our own fov state toward (base + boost). The renderer
        // set camera.fovDegrees to the aspect-aware base just before this call.
        let baseFov = camera.fovDegrees
        if fov == 0 { fov = baseFov }
        let boostFov: Float = inBoost ? 10 : 0
        fov += (baseFov + boostFov - fov) * 0.07
        camera.fovDegrees = fov

        // beacon pulse (whole cloud)
        beacons?.opacity = 0.2 + ((sin(Float(t) * 1.1) + 1) / 2) * 0.75

        // particle stream
        let ptr = particles.positions.contents().bindMemory(to: Float.self, capacity: pCount * 3)
        for i in 0..<pCount {
            pU[i] -= baseStep * 26
            if pU[i] < 0 { pU[i] += 1 }
            let targetU = wrap(u + pU[i] * 0.05)
            let pp = spline.pointAt(targetU)
            ptr[i * 3] = pp.x + pOff[i].0; ptr[i * 3 + 1] = pp.y + pOff[i].1; ptr[i * 3 + 2] = pp.z
        }
    }
}
