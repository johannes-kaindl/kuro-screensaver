// CameraFly — reusable "banked weaving flight": multi-frequency lateral + vertical
// sway with roll/yaw that bank INTO the turn, plus occasional eased maneuvers
// (hard-bank / dive / climb). Designed to be CONTINUOUS (C1): the bank is derived
// only from the smooth weave velocity, and maneuvers use a sin²(πp) envelope whose
// value AND slope are zero at both ends — so events never snap the roll (no "hard
// cuts"). Uses a per-instance LOCAL clock so every scene starts centered + LEVEL
// and eases the bank in. bankScale exposes the user's bank-strength slider.

import simd

struct CameraFly {
    var latAmp: Float = 10
    var vertAmp: Float = 2.4
    var vertBase: Float = 6.5
    var pitchBase: Float = -0.2
    var bankGain: Float = 2.2
    var yawGain: Float = 0.8
    var bankScale: Float = 1        // user bank-strength multiplier

    private var rng: LCG
    private var t0: Double = -1      // local clock origin (first update)
    private var nextEventT: Double
    private var event: (kind: Int, start: Double, dur: Double, dir: Float)?

    init(seed: Int32, latAmp: Float = 10, vertAmp: Float = 2.4, vertBase: Float = 6.5,
         pitchBase: Float = -0.2, bankScale: Float = 1) {
        rng = LCG(seed: seed)
        nextEventT = 6 + Double(rng.nextF()) * 8
        self.latAmp = latAmp; self.vertAmp = vertAmp; self.vertBase = vertBase
        self.pitchBase = pitchBase; self.bankScale = bankScale
    }

    struct Sample { var x: Float; var y: Float; var pitch: Float; var yaw: Float; var roll: Float }

    private func smooth01(_ u: Float) -> Float { let c = max(0, min(1, u)); return c * c * (3 - 2 * c) }

    mutating func update(t: Double, forwardSpeed: Float) -> Sample {
        if t0 < 0 { t0 = t }
        let lt = t - t0                 // local time → scene starts centered + level
        let tf = Float(lt)

        // continuous weave (position + analytic velocity, both C∞)
        var x = sin(tf * 0.11) * latAmp + sin(tf * 0.043) * latAmp * 0.5
        let xv = 0.11 * latAmp * cos(tf * 0.11) + 0.043 * latAmp * 0.5 * cos(tf * 0.043)
        var y = vertBase + sin(tf * 0.17) * vertAmp + sin(tf * 0.063) * vertAmp * 0.5
        var pitch = pitchBase + sin(tf * 0.13) * 0.045
        var extraRoll: Float = 0

        // occasional eased maneuver (sin²(πp): zero value AND zero slope at both ends)
        if event == nil, lt > nextEventT {
            let kind = Int(rng.nextF() * 3)             // 0 hard-bank · 1 dive · 2 climb
            let dir: Float = rng.nextF() < 0.5 ? 1 : -1
            event = (kind, lt, Double(2.8 + rng.nextF() * 2.4), dir)
            nextEventT = lt + Double(12 + rng.nextF() * 16)
        }
        if let e = event {
            let p = Float((lt - e.start) / e.dur)
            if p >= 1 { event = nil }
            else {
                let s = sin(p * .pi); let env = s * s   // C1
                switch e.kind {
                case 0: x += e.dir * latAmp * 0.5 * env; extraRoll += e.dir * 0.3 * env   // lean direct (no vel-bank → no snap)
                case 1: y -= 3.2 * env; pitch -= 0.13 * env
                default: y += 4.0 * env; pitch += 0.10 * env
                }
            }
        }

        let turn = max(-0.4, min(0.4, -xv / max(1, forwardSpeed)))
        let ramp = smooth01(tf / 3.5)                   // start LEVEL, ease the bank in
        let bank = bankScale * ramp
        return Sample(x: x, y: y, pitch: pitch, yaw: turn * yawGain * bank, roll: (turn * bankGain + extraRoll) * bank)
    }
}
