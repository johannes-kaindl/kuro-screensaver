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
    private(set) var speedMul: Float = 1     // ramps in Brick B (warp); 1 here
    var ownsCamera = false
    private var rng: LCG                      // reserved for Brick B procedural variation

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

    /// advance the director clock and retire finished manoeuvres. Call once/frame.
    func update(t: Double, dt: Double) {
        clock += dt
        for i in active.indices where active[i].start < 0 { active[i].start = clock }
        active.removeAll { (clock - $0.start) / $0.dur >= 1 }
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
}
