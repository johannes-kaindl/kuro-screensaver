// CrashFx — the diegetic CRT crash→reboot loop-seam: collapse the image to a
// bright horizontal line, hold black (scene swap happens here), then a reboot
// flicker. Drives the composite shader's collapse/flash uniforms. Ported from
// crt-sim.ts playCrash (collapseToBlack + rebootFlicker).

import simd

struct CrashFx {
    private(set) var active = false
    private var phase = 0          // 0 collapse, 1 black-hold, 2 reboot
    private var time: Double = 0
    private var collapse: Float = 0
    private var flash: Float = 0
    private var swapped = false
    private var debug = false

    private let flicker: [Float] = [0.45, 1.0, 0.12, 0.8, 0.05, 0.0]

    mutating func trigger() {
        active = true; phase = 0; time = 0; collapse = 0; flash = 0; swapped = false; debug = false
    }

    /// Advance the sequence; returns true exactly once, at the black point, so
    /// the caller can swap the scene behind the blackout.
    mutating func update(dt: Double) -> Bool {
        if debug { return false }
        guard active else { collapse = 0; flash = 0; return false }
        time += dt
        var doSwap = false
        switch phase {
        case 0:                                   // collapse to a line (0.21s)
            collapse = min(1, Float(time / 0.21))
            if time >= 0.21 { phase = 1; time = 0 }
        case 1:                                    // black hold (0.45s); swap at start
            collapse = 1
            if !swapped { doSwap = true; swapped = true }
            if time >= 0.45 { phase = 2; time = 0 }
        default:                                   // reboot: expand + flicker (0.45s)
            collapse = max(0, 1 - Float(time / 0.18))
            let step = Int(time / 0.065)
            flash = step < flicker.count ? flicker[step] : 0
            if time >= 0.45 { active = false; collapse = 0; flash = 0 }
        }
        return doSwap
    }

    /// Debug: freeze a fixed collapse amount for single-frame verification.
    mutating func debugSet(collapse c: Float) { debug = true; active = true; collapse = c; flash = 0 }

    func uniforms() -> SIMD4<Float> { SIMD4(collapse, flash, 0, 0) }
}
