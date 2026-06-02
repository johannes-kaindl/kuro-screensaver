// MatrixRain — cinematic "digital rain". Smoothness comes from CONTINUOUS
// sub-pixel fall (the old version snapped each stream to integer rows → stutter);
// 3D depth comes from several layers whose size, brightness, fall speed, tail
// length and density grade from FAR (small, dim, slow, soft) to NEAR (large,
// bright, fast, glowing). Near-white heads cross the bloom threshold (~0.05 luma)
// and glow; long green tails fade to nothing; glyphs mutate at scattered
// per-glyph rates (shimmer, not per-frame noise). Drawn back→front so near
// streams composite over distant ones.
//
// A PURE DETERMINISTIC function of (t, width, height): motion depends only on
// wall-clock t (never a frame counter), so it is frame-rate independent and
// reproducible in the headless PNG harness. Design vetted by an adversarial
// panel; the bloom threshold (0.05, ramp to 0.20), the continuous-fall math, and
// the long-idle Float guard were all verified against the real pipeline.

import simd
import Foundation

enum MatrixRain {
    // Katakana-dominant pool (+ digits + a few symbols); every glyph exists in
    // FontAtlas (a missing char would silently leave a gap, so do not add others).
    private static let kata = Array("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー")
    private static let glyphs: [Character] = kata + kata + Array("0123456789") + Array("=+-*<>:.?")

    private static func hash(_ x: Int) -> Int {
        var v = x &* 2_654_435_761
        v ^= (v >> 15); v = v &* 2_246_822_519; v ^= (v >> 13)
        return v & 0x7fff_ffff
    }
    private static func lerp(_ a: Float, _ b: Float, _ t: Float) -> Float { a + (b - a) * t }
    private static func mix3(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ t: Float) -> SIMD3<Float> { a + (b - a) * t }

    private static let layers = 5

    /// Draw the rain. `opacity` scales the whole effect (keep it a background).
    static func render(_ tr: TextRenderer, width: Int, height: Int,
                       accent: SIMD3<Float>, t: Double, opacity: Float) {
        let W = Float(width), H = Float(height)
        let baseCell = H / 42
        let leadIn: Float = 2.0
        let headBase = mix3(accent, SIMD3<Float>(1, 1, 1), 0.72)  // near-white, tinted by the theme
        // Long-idle Float guard: bound the time magnitude before *speed so the
        // per-frame delta keeps sub-pixel resolution even after hours of uptime.
        let tw = t.truncatingRemainder(dividingBy: 100_000)

        for L in 0..<layers {                                    // BACK → FRONT (overdraw = depth)
            let zf = layers > 1 ? Float(L) / Float(layers - 1) : 1
            let cell = baseCell * lerp(0.62, 1.5, zf)
            let cw = tr.charWidth(pxHeight: cell)
            let bright = lerp(0.34, 0.98, zf)
            let tailN = max(8, Int(lerp(15, 30, zf)))
            let colGap = lerp(1.4, 2.1, zf)                      // ≥ ~1 + 2·jitter → no in-layer overlap
            let maxCols = Int(lerp(170, 64, zf))
            let nCols = min(maxCols, max(1, Int(W / (cw * colGap))))
            let colW = W / Float(nCols)
            let spMin = lerp(20, 80, zf), spMax = lerp(46, 168, zf)
            let span = H + (Float(tailN) + leadIn) * cell
            let fadeBand = 2 * cell
            let mutPerMille = Int(lerp(120, 240, zf))

            for c in 0..<nCols {
                let key: Int = L &* 100_003 &+ c
                let h0 = hash(key), h1 = hash(key ^ 0x9E37_79B9), h2 = hash(key &* 131 &+ 7)
                let speed = spMin + Float(h0 % 1000) / 1000 * (spMax - spMin)
                let phase = Float(h1 % 100_000) / 100_000 * span
                let jitter = (Float(h2 % 1000) / 1000 - 0.5) * cw * 0.4   // ±0.2·cw
                let x = (Float(c) + 0.5) * colW - cw * 0.5 + jitter

                // Continuous head position (Double, then cast) — no integer-row quantization.
                let p = tw * Double(speed) + Double(phase)
                let cyc = (p / Double(span)).rounded(.down)
                let headY = p - cyc * Double(span) - Double(leadIn) * Double(cell)
                let slotHead = Int((p / Double(cell)).rounded(.down))     // monotone identity index

                for k in 0..<tailN {
                    let y = Float(headY - Double(k) * Double(cell))       // continuous sub-pixel y
                    if y <= -cell || y >= H { continue }

                    // Identity keyed by the absolute cell slot (decoupled from y): a physical
                    // glyph keeps its character as it scrolls, re-rolling once per cell crossed.
                    let slot = slotHead - k
                    let baseKey: Int = key &* 977 &+ slot &* 131
                    var idx = hash(baseKey) % glyphs.count
                    // Scattered in-place mutation: only some glyphs ever flip, each on its own
                    // phase, at quantized time steps → shimmer, not per-frame noise.
                    let mk: Int = key &* 40_009 &+ slot &* 89
                    let mh = hash(mk)
                    if mh % 1000 < mutPerMille {
                        let mstep = Int((Float(tw) * 5.5 + Float(mh % 1000) / 1000 * 17).rounded(.down))
                        idx = hash(baseKey &+ mstep &* 7919) % glyphs.count
                    }
                    let g = glyphs[idx]

                    // Shade: white-hot head → green neck → long quadratic green fade.
                    var col: SIMD3<Float>; var op: Float
                    if k == 0 {
                        col = headBase * bright; op = min(1, 0.95 * bright)
                    } else if k <= 2 {
                        let m = Float(k) / 3
                        col = mix3(headBase, accent, m) * bright
                        op = min(1, lerp(0.9, 0.7, m) * bright)
                    } else {
                        let f = 1 - Float(k - 2) / Float(tailN - 2)       // 1 → 0 down the tail
                        let fade = f * f                                  // quadratic → long dark fade
                        col = accent * (0.30 + 0.70 * fade)
                        op = 0.62 * fade * bright
                    }
                    // Rare bright sparkle in the tail (deterministic, frame-rate independent).
                    if k >= 3 {
                        let sk: Int = key &* 60_013 &+ slot &* 97 &+ Int((Float(tw) * 3).rounded(.down))
                        if hash(sk) % 1000 < 6 { col = col * 1.9; op = min(1, op * 2 + 0.3) }
                    }
                    // Soft fade-in at the top + fade-OUT at the bottom (kills the head pop on exit).
                    let eIn = min(1, max(0, (y + cell) / (leadIn * cell)))
                    let eOut = min(1, max(0, (H - y) / fadeBand))
                    op *= eIn * eOut * opacity
                    if op <= 0.003 { continue }
                    tr.add(String(g), xPx: x, yPx: y, pxHeight: cell, color: col, opacity: op)
                }
            }
        }
    }
}
