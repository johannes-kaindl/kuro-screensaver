// MatrixRain — falling katakana columns (bright head + fading tail), drawn via
// the text overlay behind the HUD. Time-based + deterministic (no per-frame
// state), so it composites with the CRT post like everything else.

import simd
import Foundation

enum MatrixRain {
    private static let glyphs = Array("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789")

    private static func hash(_ x: Int) -> Int {
        var v = x &* 2_654_435_761
        v ^= (v >> 15); v = v &* 2_246_822_519; v ^= (v >> 13)
        return v & 0x7fff_ffff
    }

    /// Draw the rain. `opacity` scales the whole effect (keep it a background).
    static func render(_ tr: TextRenderer, width: Int, height: Int,
                       accent: SIMD3<Float>, t: Double, opacity: Float) {
        let W = Float(width), H = Float(height)
        let size = H / 42                       // glyph cell height
        let cw = tr.charWidth(pxHeight: size)
        let ncols = max(1, Int(W / cw))
        let tail = 16
        let span = H + Float(tail) * size
        let head = (accent * 0.5) + SIMD3<Float>(0.45, 0.45, 0.45)   // whiter-bright head

        for c in 0..<ncols {
            let speed = 45 + Float(hash(c) % 90)              // px/s, per column
            let phase = Float(hash(c &* 7) % Int(max(1, H)))
            let p = Float(t) * speed + phase
            let cycle = Int(p / span)
            let headY = p.truncatingRemainder(dividingBy: span)
            let headRow = Int(headY / size)
            let x = Float(c) * cw
            for k in 0..<tail {
                let row = headRow - k
                if row < 0 { continue }
                let y = Float(row) * size
                if y > H { continue }
                let g = glyphs[hash(c &* 131 &+ row &* 17 &+ cycle &* 977) % glyphs.count]
                let op = (k == 0 ? 0.9 : max(0, 0.5 - Float(k) * 0.032)) * opacity
                let col = k == 0 ? head : accent
                tr.add(String(g), xPx: x, yPx: y, pxHeight: size, color: col, opacity: op)
            }
        }
    }
}
