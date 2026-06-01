// GlitchScheduler — the weighted CRT-artifact timeline. One artifact at a time,
// fired on a randomized cadence and auto-reverted after its duration; it writes
// distortion values the composite shader reads each frame. Ported from the web
// crt-sim.ts scheduler (slice set: h-tear, brightness flicker, chroma spike,
// scanline pulse — the full 12-artifact set + crash sequence come later).

import Foundation

final class GlitchScheduler {
    var intensity: Float
    private var rng: LCG

    private enum Kind { case none, hTear, flicker, chroma, scanPulse }
    private var kind: Kind = .none
    private var until: Double = 0
    private var nextAt: Double
    private var forced = false

    // current distortion values (read via uniforms()/chromaOffsetBump)
    private var hTearAmount: Float = 0
    private var hTearBandY: Float = 0
    private var brightness: Float = 1
    private var scanPulse: Float = 0
    private var chromaBump: Float = 0

    init(intensity: Float, seed: Int32) {
        self.intensity = intensity
        self.rng = LCG(seed: seed == 0 ? 1 : seed)
        self.nextAt = Double(max(200, 3500 - 3000 * intensity)) / 1000.0
    }

    func update(t: Double) {
        if forced { return }
        if t >= until { reset() }
        if t >= nextAt { fire(now: t); scheduleNext(now: t) }
    }

    private func reset() {
        kind = .none; hTearAmount = 0; brightness = 1; scanPulse = 0; chromaBump = 0
    }

    private func scheduleNext(now: Double) {
        let interval = Double(max(200, 3500 - 3000 * intensity))
        nextAt = now + (interval + rng.next() * 0.6 * interval) / 1000.0
    }

    private func fire(now: Double) {
        let i = intensity
        let r = rng.next() * 74          // weights: 28 + 20 + 12 + 14
        let dur: Double
        if r < 28 {                      // h-tear
            kind = .hTear
            hTearAmount = (Float(rng.next()) - 0.5) * (0.006 + 0.02 * i)
            hTearBandY = Float(rng.next())
            dur = 0.04 + rng.next() * 0.08
        } else if r < 48 {               // brightness flicker
            kind = .flicker
            if rng.next() < 0.6 {
                brightness = 1 - 0.3 * i - Float(rng.next()) * 0.2
            } else {
                brightness = 1 + 0.3 * i + Float(rng.next()) * 0.4
            }
            dur = 0.06 + rng.next() * 0.09
        } else if r < 60 {               // chroma spike
            kind = .chroma
            chromaBump = 0.003 + Float(rng.next()) * 0.006 * i
            dur = 0.08 + rng.next() * 0.12
        } else {                         // scanline pulse
            kind = .scanPulse
            scanPulse = 0.4 + Float(rng.next()) * 1.2 * i
            dur = 0.14 + rng.next() * 0.22
        }
        until = now + dur
    }

    func uniforms() -> SIMD4<Float> {
        SIMD4(hTearAmount, hTearBandY, brightness, scanPulse)
    }
    var chromaOffsetBump: Float { chromaBump }

    /// Debug: hold one artifact active indefinitely (for single-frame verification).
    func forceHold(_ name: String) {
        forced = true; reset()
        switch name {
        case "htear": kind = .hTear; hTearAmount = 0.03; hTearBandY = 0.5
        case "flicker": kind = .flicker; brightness = 1.7
        case "chroma": kind = .chroma; chromaBump = 0.012
        case "scanpulse": kind = .scanPulse; scanPulse = 1.6
        default: break
        }
    }
}
