// Combat actors — Swift mirror of src/engine/modes/actors.ts. DrawItem-based agents in
// the renderer's persistent `actors` list (survive scene swaps). Cinematic: they emit
// events + react, no damage model. Colour via DrawItem.colorOverride (no MaterialPool).
//
// Redo (2026-06-05): box-built craft with a clear silhouette (interceptor vs corvette),
// banking instead of tumbling, and a bright bolt that flies AT the camera growing as it
// nears (+ muzzle flash). Was bare icosahedra in line mode → read as glitches at range.

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
private func camRot(_ cam: Camera) -> matrix_float4x4 {
    Mathx.rotationX(cam.rotation.x) * Mathx.rotationY(cam.rotation.y) * Mathx.rotationZ(cam.rotation.z)
}
private func camBasis(_ cam: Camera) -> (fwd: SIMD3<Float>, right: SIMD3<Float>, up: SIMD3<Float>) {
    let r = camRot(cam)
    func ax(_ x: Float, _ y: Float, _ z: Float) -> SIMD3<Float> {
        let o = r * SIMD4<Float>(x, y, z, 0); return SIMD3(o.x, o.y, o.z)
    }
    return (ax(0, 0, -1), ax(1, 0, 0), ax(0, 1, 0))
}

/// Rotation so local -Z points from `pos` toward `target` (three.js Object3D.lookAt parity:
/// +Z away from the target, -Z toward it).
private func lookRot(from pos: SIMD3<Float>, to target: SIMD3<Float>) -> matrix_float4x4 {
    let z = simd_normalize(pos - target)            // +Z away from target → -Z toward it
    var x = simd_cross(SIMD3<Float>(0, 1, 0), z)
    if simd_length(x) < 1e-5 { x = simd_cross(SIMD3<Float>(1, 0, 0), z) }
    x = simd_normalize(x)
    let y = simd_cross(z, x)
    return matrix_float4x4(columns: (
        SIMD4(x.x, x.y, x.z, 0), SIMD4(y.x, y.y, y.z, 0), SIMD4(z.x, z.y, z.z, 0), SIMD4(0, 0, 0, 1)))
}

/// A wireframe box with its local offset baked into the vertices, coloured via override.
private func boxItem(_ device: MTLDevice, _ w: Float, _ h: Float, _ d: Float,
                     _ off: SIMD3<Float>, _ color: SIMD3<Float>) -> DrawItem {
    let g = Geo.box(w, h, d)
    var flat = [Float](); flat.reserveCapacity(g.pos.count * 3)
    for p in g.pos { flat.append(p.x + off.x); flat.append(p.y + off.y); flat.append(p.z + off.z) }
    let it = DrawItem(positions: Geo.buffer(device, flat), indices: Geo.buffer(device, g.idx),
                      count: g.idx.count, vertexCount: g.pos.count, primitive: .line)
    it.colorOverride = color
    return it
}

/// Lurking hunter: weaves at the edge of view, fires bright bolts toward the camera.
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
    private let bodyParts: [DrawItem]
    private var bolt: DrawItem?
    private var boltBorn = -1.0
    private var boltFrom = SIMD3<Float>(0, 0, 0)

    init(device: MTLDevice, enemyRGB: SIMD3<Float>, seed: Int32, onFire: @escaping () -> Void) {
        self.device = device; self.enemyRGB = enemyRGB; self.onFire = onFire
        rng = LCG(seed: seed ^ Int32(bitPattern: 0x0bad_5eed))
        side = rng.nextF() < 0.5 ? -1 : 1
        nextFire = 2 + Double(rng.nextF()) * 2
        // Interceptor silhouette: long fuselage, wide wing bar, tail fin, nose block.
        bodyParts = [
            boxItem(device, 1.0, 0.7, 4.6, SIMD3(0, 0, 0), enemyRGB),
            boxItem(device, 6.2, 0.18, 1.5, SIMD3(0, 0, 0.7), enemyRGB),
            boxItem(device, 0.18, 1.2, 1.0, SIMD3(0, 0.55, 1.9), enemyRGB),
            boxItem(device, 0.9, 0.5, 0.9, SIMD3(0, -0.1, -2.0), enemyRGB),
        ]
        items = bodyParts
    }

    func update(t: Double, dt: Double, cam: Camera, threat: Float) -> Bool {
        if t0 < 0 { t0 = t }
        let lt = Float(t - t0)
        if threat < 0.05 { alive = false; return false }            // exhale at the crash
        let (fwd, right, up) = camBasis(cam)
        let dist = 20 + (1 - threat) * 12                            // closer + bigger as threat rises
        let lat = side * (11 + sin(lt * 0.5) * 3)
        let vert = 4 + sin(lt * 0.37) * 2.5
        let pos = cam.position + fwd * dist + right * lat + up * vert
        // nose aims at the camera; bank with the weave (no tumble)
        let m = Mathx.translation(pos) * lookRot(from: pos, to: cam.position) * Mathx.rotationZ(sin(lt * 0.7) * 0.4)
        for part in bodyParts { part.model = m }
        if Double(lt) > nextFire {
            nextFire = Double(lt) + Double(4 - threat * 3) + Double(rng.nextF()) * 1.5
            fire(from: pos, t: t)
            onFire()
        }
        updateBolt(t: t, cam: cam)
        return true
    }

    private func fire(from pos: SIMD3<Float>, t: Double) {
        let g = Geo.icosahedron(detail: 0)
        let flat = g.pos.flatMap { [$0.x, $0.y, $0.z] }
        let b = DrawItem(positions: Geo.buffer(device, flat), indices: Geo.buffer(device, g.idx),
                         count: g.idx.count, vertexCount: g.pos.count, primitive: .line)
        b.colorOverride = enemyRGB
        bolt = b; boltBorn = t; boltFrom = pos
        items = bodyParts + [b]
    }

    /// Bolt flies from the muzzle to the camera in world space, growing as it nears.
    private func updateBolt(t: Double, cam: Camera) {
        guard let b = bolt else { return }
        let LIFE = 0.32
        let age = t - boltBorn
        if age >= LIFE { items = bodyParts; bolt = nil; return }
        let frac = Float(age / LIFE)
        let wpos = boltFrom + (cam.position - boltFrom) * frac
        b.model = Mathx.translation(wpos) * Mathx.scale(0.6 + frac * 2.4)
        b.opacity = 1 - frac * 0.35
    }
}

/// CORP support unit: arrive → hold → flee or crash. Broader "corvette" silhouette.
final class SupportUnit: Actor {
    private(set) var items: [DrawItem]
    var alive = true
    private var t0 = -1.0
    private let side: Float
    private let crash: Bool
    private var crashFired = false
    private let onCrash: () -> Void
    private let bodyParts: [DrawItem]
    private var crashSpin: Float = 0

    init(device: MTLDevice, accentRGB: SIMD3<Float>, seed: Int32, crash: Bool, onCrash: @escaping () -> Void) {
        self.crash = crash; self.onCrash = onCrash
        var rng = LCG(seed: seed ^ Int32(bitPattern: 0x0000_600d))
        side = rng.nextF() < 0.5 ? -1 : 1
        // Corvette silhouette: bulky hull, stub wings, twin engine pods — clearly not the hunter.
        bodyParts = [
            boxItem(device, 1.6, 1.2, 4.0, SIMD3(0, 0, 0), accentRGB),
            boxItem(device, 4.4, 0.2, 1.8, SIMD3(0, 0, 0.3), accentRGB),
            boxItem(device, 0.8, 0.8, 1.1, SIMD3(1.7, 0, 0.9), accentRGB),
            boxItem(device, 0.8, 0.8, 1.1, SIMD3(-1.7, 0, 0.9), accentRGB),
        ]
        items = bodyParts
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
                crashSpin += Float(dt) * 7
                if d > 2.5 { if !crashFired { crashFired = true; onCrash() }; alive = false; return false }
            } else {
                along -= d * 16
                if d > 3 { alive = false; return false }
            }
        }
        let pos = cam.position + fwd * along + right * lateral + up * rise
        // fly facing our direction of travel; slight inward yaw → 3/4 silhouette; bank / tumble
        let roll = crash ? crashSpin : sin(lt * 0.8) * 0.12
        let m = Mathx.translation(pos) * camRot(cam) * Mathx.rotationY(-side * 0.25) * Mathx.rotationZ(roll)
        for part in bodyParts { part.model = m }
        return true
    }
}
