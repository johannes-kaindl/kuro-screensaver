// FlightDirector — Swift mirror of src/engine/modes/flight-director.ts. Sequences
// camera manoeuvres on ONE continuous clock and owns the continuous speed
// multiplier. It POST-PROCESSES the camera the scene already wrote (additive, like
// the parallax/hesitation seam) and NEVER writes fog/bloom. In Brick A the director
// only overlays (ownsCamera=false); full ownership during transitions is Brick B.

import Foundation

enum ManoeuvreKind { case kick, roll, dive, climb, bank }

struct Manoeuvre {
    var kind: ManoeuvreKind
    var dur: Double            // seconds
    var dir: Float             // -1 | 0 | +1
    var intensity: Float       // unit-ish amplitude
    var start: Double = -1     // filled when dequeued (continuous director clock)
}

final class FlightDirector {
    private var clock: Double = 0
    private var active: [Manoeuvre] = []
    private(set) var speedMul: Float = 1     // 1 outside a transition; ramped by the warp
    var ownsCamera = false
    private var rng: LCG                      // seeded warp shake + reserved for Brick C
    private struct Trans { var p: TransitionProfile; var t0: Double; var swapped: Bool; var onSwap: () -> Void; var baseFov: Float }
    private var trans: Trans?
    var inTransition: Bool { trans != nil }

    init(seed: Int32, bus: EventBus? = nil) {
        rng = LCG(seed: seed ^ Int32(bitPattern: 0x9e37_79b9))
        bus?.subscribe(.intrusion) { [weak self] e in
            self?.enqueue(Manoeuvre(kind: .kick, dur: max(0.3, e.intensity), dir: 0, intensity: 0.55))
        }
    }

    /// sin²(πp): value AND slope are 0 at p=0 and p=1 → chained manoeuvres never snap.
    static func envelope(_ p: Double) -> Float {
        if p <= 0 || p >= 1 { return 0 }
        let s = sin(Double.pi * p)
        return Float(s * s)
    }

    /// continuous forward-speed multiplier (enum base is applied by the caller).
    func speed() -> Float { speedMul }

    func enqueue(_ m: Manoeuvre) { active.append(m) }

    /// Start a warp transition; fires onSwap once at the warp peak (the scene swap).
    func beginTransition(_ p: TransitionProfile, baseFov: Float, onSwap: @escaping () -> Void) {
        trans = Trans(p: p, t0: clock, swapped: false, onSwap: onSwap, baseFov: baseFov)
        ownsCamera = true
    }

    /// advance the director clock and retire finished manoeuvres. Call once/frame.
    func update(t: Double, dt: Double) {
        clock += dt
        for i in active.indices where active[i].start < 0 { active[i].start = clock }
        active.removeAll { (clock - $0.start) / $0.dur >= 1 }

        if var tr = trans {
            let el = clock - tr.t0
            let total = tr.p.windupDur + tr.p.warpDur + tr.p.emergeDur
            if el >= tr.p.windupDur && el < tr.p.windupDur + tr.p.warpDur {
                let pw = (el - tr.p.windupDur) / tr.p.warpDur
                speedMul = 1 + (tr.p.warpSpeed - 1) * FlightDirector.envelope(pw)   // sin² hump (C1)
                if !tr.swapped && pw >= 0.5 { tr.swapped = true; tr.onSwap() }      // swap at the peak
            } else {
                speedMul = 1
            }
            if el >= total { trans = nil; ownsCamera = false; speedMul = 1 } else { trans = tr }
        }
    }

    /// additive overlay on the pose the scene just wrote (modifies in place).
    func apply(_ cam: inout Camera) {
        for m in active {
            let p = (clock - m.start) / m.dur
            let env = FlightDirector.envelope(p)
            if env == 0 { continue }
            switch m.kind {
            case .kick:  cam.position.x *= 1 - m.intensity * env       // lateral steadying (== old hesitation)
            case .roll:  cam.rotation.z += m.dir * m.intensity * env   // barrel-roll
            case .bank:  cam.position.x += m.dir * m.intensity * env; cam.rotation.z += m.dir * 0.3 * env
            case .dive:  cam.position.y -= m.intensity * env
            case .climb: cam.position.y += m.intensity * env
            }
        }
    }

    /// Override the scene-written pose during a transition. Returns true if FOV changed.
    /// Reads the scene's just-written pose as the emerge blend target (smooth hand-back).
    func applyTransition(_ cam: inout Camera) -> Bool {
        guard let tr = trans else { return false }
        let el = clock - tr.t0
        let w = tr.p.windupDur, wa = tr.p.warpDur, em = tr.p.emergeDur
        if el < w {
            let e = FlightDirector.envelope(0.5 + 0.5 * (el / w))   // ramp the climb in, hold near peak
            if let cp = tr.p.climbPitch { cam.rotation.x += cp * e }
            return false
        }
        if el < w + wa {
            let h = FlightDirector.envelope((el - w) / wa)
            cam.fovDegrees = tr.baseFov + tr.p.fovPush * h
            cam.position.x += (rng.nextF() - 0.5) * 0.06 * h        // seeded warp shake
            cam.position.y += (rng.nextF() - 0.5) * 0.06 * h
            return true
        }
        let pe = min(1, (el - w - wa) / em)
        let k = Float(1 - (1 - pe) * (1 - pe))                      // easeOut
        if let ea = tr.p.entryAltitude { cam.position.y = ea + (cam.position.y - ea) * k }
        cam.fovDegrees = tr.baseFov
        return true
    }
}
