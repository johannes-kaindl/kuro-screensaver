// Combat actors — Swift mirror of src/engine/modes/actors.ts. DrawItem-based agents in
// the renderer's persistent `actors` list (survive scene swaps). Cinematic: they emit
// events + react, no damage model. Colour via DrawItem.colorOverride (no MaterialPool).

import Foundation
import Metal
import simd

protocol Actor: AnyObject {
    var items: [DrawItem] { get }
    var alive: Bool { get }
    /// advance; return false when finished (renderer culls it).
    func update(t: Double, dt: Double, cam: Camera, threat: Float) -> Bool
}

/// Camera world-space basis (forward = local -Z), from its euler rotation.
private func camBasis(_ cam: Camera) -> (fwd: SIMD3<Float>, right: SIMD3<Float>, up: SIMD3<Float>) {
    let r = Mathx.rotationX(cam.rotation.x) * Mathx.rotationY(cam.rotation.y) * Mathx.rotationZ(cam.rotation.z)
    func ax(_ x: Float, _ y: Float, _ z: Float) -> SIMD3<Float> {
        let o = r * SIMD4<Float>(x, y, z, 0); return SIMD3(o.x, o.y, o.z)
    }
    return (ax(0, 0, -1), ax(1, 0, 0), ax(0, 1, 0))
}

private func icoItem(_ device: MTLDevice, detail: Int) -> DrawItem {
    let g = Geo.icosahedron(detail: detail)
    let flat = g.pos.flatMap { [$0.x, $0.y, $0.z] }
    return DrawItem(positions: Geo.buffer(device, flat), indices: Geo.buffer(device, g.idx),
                    count: g.idx.count, vertexCount: g.pos.count, primitive: .line)
}

/// Lurking hunter: weaves at the edge of view, fires tracers toward the camera.
final class AntagonistDrone: Actor {
    private(set) var items: [DrawItem]
    var alive = true
    private var rng: LCG
    private var t0 = -1.0
    private var nextFire: Double
    private let side: Float
    private let enemyRGB: SIMD3<Float>
    private let device: MTLDevice
    private let onFire: () -> Void
    private let body: DrawItem
    private var tracer: DrawItem?
    private var tracerBorn = -1.0

    init(device: MTLDevice, enemyRGB: SIMD3<Float>, seed: Int32, onFire: @escaping () -> Void) {
        self.device = device; self.enemyRGB = enemyRGB; self.onFire = onFire
        rng = LCG(seed: seed ^ Int32(bitPattern: 0x0bad_5eed))
        side = rng.nextF() < 0.5 ? -1 : 1
        nextFire = 2 + Double(rng.nextF()) * 2
        body = icoItem(device, detail: 0)
        body.colorOverride = enemyRGB
        items = [body]
    }

    func update(t: Double, dt: Double, cam: Camera, threat: Float) -> Bool {
        if t0 < 0 { t0 = t }
        let lt = Float(t - t0)
        if threat < 0.05 { alive = false; return false }            // exhale at the crash
        let (fwd, right, up) = camBasis(cam)
        let dist = 26 + (1 - threat) * 18
        let lat = side * (10 + sin(lt * 0.5) * 3)
        let vert = 5 + sin(lt * 0.37) * 2.5
        let pos = cam.position + fwd * dist + right * lat + up * vert
        let spin = lt * 0.6
        body.model = Mathx.translation(pos) * Mathx.rotationY(spin) * Mathx.rotationX(spin * 0.5)
        if Double(lt) > nextFire {
            nextFire = Double(lt) + Double(4 - threat * 3) + Double(rng.nextF()) * 1.5
            fire(from: pos, cam: cam, t: t)
            onFire()
        }
        if let tr = tracer {
            let age = t - tracerBorn
            if age > 0.3 { items = [body]; tracer = nil }
            else { tr.opacity = 1 - Float(age / 0.3) }
        }
        return true
    }

    private func fire(from pos: SIMD3<Float>, cam: Camera, t: Double) {
        let verts: [Float] = [pos.x, pos.y, pos.z, cam.position.x, cam.position.y, cam.position.z]
        let idx: [UInt32] = [0, 1]                                  // world-space line, model = identity
        let tr = DrawItem(positions: Geo.buffer(device, verts), indices: Geo.buffer(device, idx),
                          count: 2, vertexCount: 2, primitive: .line)
        tr.colorOverride = enemyRGB
        tracer = tr; tracerBorn = t
        items = [body, tr]
    }
}

/// CORP support unit: arrive → hold → flee or crash.
final class SupportUnit: Actor {
    private(set) var items: [DrawItem]
    var alive = true
    private var t0 = -1.0
    private let side: Float
    private let crash: Bool
    private var crashFired = false
    private let onCrash: () -> Void
    private let body: DrawItem
    private var spin: Float = 0

    init(device: MTLDevice, accentRGB: SIMD3<Float>, seed: Int32, crash: Bool, onCrash: @escaping () -> Void) {
        self.crash = crash; self.onCrash = onCrash
        var rng = LCG(seed: seed ^ Int32(bitPattern: 0x0000_600d))
        side = rng.nextF() < 0.5 ? -1 : 1
        body = icoItem(device, detail: 0)            // accent colour (no override → uses scene accent)
        items = [body]
    }

    func update(t: Double, dt: Double, cam: Camera, threat: Float) -> Bool {
        if t0 < 0 { t0 = t }
        let lt = Float(t - t0)
        let (fwd, right, up) = camBasis(cam)
        let arrive = min(1, lt / 2.5)
        let ease = 1 - (1 - arrive) * (1 - arrive)
        var lateral = side * (28 * (1 - ease) + 12 * ease)
        var along: Float = 30
        var rise: Float = 6
        if lt > 6 {
            let d = lt - 6
            if crash {
                rise -= d * d * 1.4
                lateral += side * d * 2
                spin += Float(dt) * 7
                if d > 2.5 { if !crashFired { crashFired = true; onCrash() }; alive = false; return false }
            } else {
                along -= d * 16
                if d > 3 { alive = false; return false }
            }
        }
        let pos = cam.position + fwd * along + right * lateral + up * rise
        body.model = Mathx.translation(pos) * Mathx.rotationY(lt * 0.8) * Mathx.rotationZ(spin)
        return true
    }
}
