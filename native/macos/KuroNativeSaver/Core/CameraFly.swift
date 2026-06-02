// CameraFly — reusable "banked weaving flight" choreography that turns a static
// forward drift into dynamic, cinematic motion. Multi-frequency lateral + vertical
// sway with roll/yaw that bank INTO the turn (analytic velocity → correct lean),
// plus occasional eased maneuvers (hard S-bank, dive, climb) for drama. A near-pure
// function of t (only the event schedule uses an LCG seeded once), so it stays
// smooth + deterministic and composites with the rest.

import simd

struct CameraFly {
    var latAmp: Float = 10          // lateral sway amplitude (world units)
    var vertAmp: Float = 2.4        // vertical sway amplitude
    var vertBase: Float = 6.5       // base altitude
    var pitchBase: Float = -0.2     // base look-down pitch
    var bankGain: Float = 2.2       // roll per turn-ratio
    var yawGain: Float = 0.8        // yaw per turn-ratio

    private var rng: LCG
    private var nextEventT: Double
    private var event: (kind: Int, start: Double, dur: Double, dir: Float)?

    init(seed: Int32, latAmp: Float = 10, vertAmp: Float = 2.4, vertBase: Float = 6.5, pitchBase: Float = -0.2) {
        rng = LCG(seed: seed)
        nextEventT = 7 + Double(rng.nextF()) * 8
        self.latAmp = latAmp; self.vertAmp = vertAmp; self.vertBase = vertBase; self.pitchBase = pitchBase
    }

    struct Sample { var x: Float; var y: Float; var pitch: Float; var yaw: Float; var roll: Float }

    mutating func update(t: Double, forwardSpeed: Float) -> Sample {
        let tf = Float(t)
        // --- continuous weave (position + analytic lateral velocity) ---
        var x  = sin(tf * 0.11) * latAmp + sin(tf * 0.043) * latAmp * 0.5
        var xv = 0.11 * latAmp * cos(tf * 0.11) + 0.043 * latAmp * 0.5 * cos(tf * 0.043)
        var y  = vertBase + sin(tf * 0.17) * vertAmp + sin(tf * 0.063) * vertAmp * 0.5
        var pitch = pitchBase + sin(tf * 0.13) * 0.045
        var extraRoll: Float = 0

        // --- occasional eased maneuver ---
        if event == nil, t > nextEventT {
            let kind = Int(rng.nextF() * 3)               // 0 hard-bank · 1 dive · 2 climb
            let dir: Float = rng.nextF() < 0.5 ? 1 : -1
            event = (kind, t, Double(2.6 + rng.nextF() * 2.4), dir)
            nextEventT = t + Double(13 + rng.nextF() * 16)
        }
        if let e = event {
            let p = Float((t - e.start) / e.dur)
            if p >= 1 { event = nil }
            else {
                let env = sin(p * .pi)                    // 0 → 1 → 0
                switch e.kind {
                case 0:                                    // hard S-bank: extra lateral push + lean
                    x += e.dir * latAmp * 0.85 * env
                    xv += e.dir * latAmp * 0.85 * (.pi / Float(e.dur)) * cos(p * .pi)   // d/dt of the env push
                    extraRoll += e.dir * 0.12 * env
                case 1: y -= 3.2 * env; pitch -= 0.13 * env                              // dive toward the surface
                default: y += 4.0 * env; pitch += 0.10 * env                             // climb + look up
                }
            }
        }

        let turn = max(-0.5, min(0.5, -xv / max(1, forwardSpeed)))   // lateral/forward ratio
        return Sample(x: x, y: y, pitch: pitch, yaw: turn * yawGain, roll: turn * bankGain + extraRoll)
    }
}
