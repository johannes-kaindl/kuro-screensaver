// MatrixField3D — the digital rain anchored in WORLD space: vertical strands of
// falling glyphs placed around the camera path; the camera flies forward through
// them, so depth comes from real perspective (near strands big + bright, far ones
// small + dim) and the motion matches the camera instead of fighting it (the
// screen-space 2D overlay's problem). Glyphs are CPU-projected through the scene
// camera and drawn via the existing TextRenderer. Strands recycle ahead once the
// camera passes them, for an endless field.

import simd
import Foundation

final class MatrixField3D {
    private struct Strand { var x: Float; var y0: Float; var z: Float; var phase: Float; var speed: Float; var len: Int; var seed: Int }
    private var strands: [Strand] = []
    private var rng: LCG

    private let count = 130
    private let spreadX: Float = 26          // lateral half-extent strands are scattered over
    private let vTop: Float = 24, vBot: Float = -24
    private let glyphH: Float = 1.0, spacing: Float = 1.2
    private let zNear: Float = 4, zFar: Float = 100

    private static let glyphs = Array("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー0123456789=+-<>:")

    init(seed: Int32) {
        rng = LCG(seed: seed)
        for _ in 0..<count { strands.append(spawn(camZ: 0, initial: true)) }
    }

    private func hash(_ x: Int) -> Int { var v = x &* 2_654_435_761; v ^= (v >> 15); v = v &* 2_246_822_519; v ^= (v >> 13); return v & 0x7fff_ffff }
    private func mix(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ t: Float) -> SIMD3<Float> { a + (b - a) * t }

    private func spawn(camZ: Float, initial: Bool) -> Strand {
        let x = (rng.nextF() * 2 - 1) * spreadX
        // camera looks down -z; place strands AHEAD (more negative z). Initial fill
        // spans the whole depth; recycled strands appear at the far plane.
        let z = initial ? camZ - zNear - rng.nextF() * (zFar - zNear)
                        : camZ - zFar - rng.nextF() * 8
        return Strand(x: x, y0: (rng.nextF() * 2 - 1) * 4, z: z,
                      phase: rng.nextF() * 1000, speed: 5 + rng.nextF() * 12,
                      len: 12 + Int(rng.nextF() * 18), seed: Int(rng.nextF() * 16_777_215))
    }

    /// Recycle strands the camera has flown past (z now behind it) to the far plane.
    func update(camPos: SIMD3<Float>) {
        for i in strands.indices where strands[i].z > camPos.z + 5 {
            strands[i] = spawn(camZ: camPos.z, initial: false)
        }
    }

    func draw(_ tr: TextRenderer, viewProj: matrix_float4x4, width: Int, height: Int,
              t: Double, accent: SIMD3<Float>, opacity: Float) {
        let W = Float(width), H = Float(height)
        let tf = Float(t)
        let white = mix(accent, SIMD3<Float>(1, 1, 1), 0.72)
        let vrange = vTop - vBot

        for s in strands {
            let total = vrange + Float(s.len) * spacing
            let fall = (tf * s.speed + s.phase).truncatingRemainder(dividingBy: total)
            let headY = s.y0 + vTop - fall
            let headRow = Int((tf * s.speed + s.phase) / spacing)
            for i in 0..<s.len {
                let wy = headY - Float(i) * spacing
                if wy > s.y0 + vTop + 1 || wy < s.y0 + vBot - 1 { continue }

                let c = viewProj * SIMD4<Float>(s.x, wy, s.z, 1)
                if c.w <= 0.06 { continue }                                   // behind camera
                let px = ((c.x / c.w) * 0.5 + 0.5) * W
                let py = (1 - ((c.y / c.w) * 0.5 + 0.5)) * H
                if px < -60 || px > W + 60 || py < -60 || py > H + 60 { continue }
                // perspective glyph height: project a point one glyphH higher
                let c2 = viewProj * SIMD4<Float>(s.x, wy + glyphH, s.z, 1)
                if c2.w <= 0.06 { continue }
                let pxH = abs(py - (1 - ((c2.y / c2.w) * 0.5 + 0.5)) * H)
                if pxH < 1.2 || pxH > H * 0.55 { continue }

                let row = headRow - i
                let g = MatrixField3D.glyphs[hash(s.seed &+ row &* 131) % MatrixField3D.glyphs.count]
                let depth = max(0, min(1, 16.0 / c.w))                        // near bright, far dim
                var col: SIMD3<Float>; var op: Float
                if i == 0 { col = white; op = 1 }
                else if i <= 2 { col = mix(white, accent, Float(i) / 3); op = 0.9 }
                else { let f = 1 - Float(i) / Float(s.len); col = accent * (0.3 + 0.7 * f); op = 0.18 + 0.72 * f }
                op *= depth * opacity
                if op < 0.02 { continue }
                tr.add(String(g), xPx: px - pxH * 0.3, yPx: py - pxH * 0.5, pxHeight: pxH, color: col, opacity: op)
            }
        }
    }
}
