// Hud — the tactical overlay (info panels, crosshair, scene-label slab, vault
// kanji) + the terminal scrollback, drawn via the TextRenderer into the HDR
// scene so the CRT post treats it. Faithful to the web hud/index.ts layout.

import simd
import Foundation

enum SceneMeta {
    static let label: [String: String] = [
        "terrain": "TERRAIN", "city": "CITY", "rift": "THE RIFT", "tunnel": "TUNNEL", "void": "VOID",
        "matrix": "MATRIX",
    ]
    static let modes: [String: [String]] = [
        "terrain": ["RECON", "SWEEP", "PATROL"], "city": ["LOW LEVEL", "URBAN", "HIGH PASS"],
        "rift": ["THE RIFT", "CHASM", "INVERSION"], "tunnel": ["INFIL", "TRANSIT", "BOOST"],
        "void": ["DRIFT", "BELT", "SWARM"], "matrix": ["DIGITAL RAIN", "CASCADE", "DECRYPT"],
    ]
}

final class Hud {
    let terminal = Terminal()
    private var fps: Double = 60

    func setFps(_ f: Double) { fps = f }

    func render(_ tr: TextRenderer, width: Int, height: Int, accent: SIMD3<Float>,
                kanji: String, t: Double, scene: String, terminalScale: Float = 1,
                matrix: Bool = false, matrixOpacity: Float = 0.4, showPanels: Bool = true) {
        let dim = accent * 0.72
        let s = Float(height) / 64                         // base cell height (px)
        let pad = s * 1.5
        let W = Float(width), H = Float(height)

        // matrix rain behind everything (drawn first → other text composites over)
        if matrix { MatrixRain.render(tr, width: width, height: height, accent: accent, t: t, opacity: matrixOpacity) }
        guard showPanels else { return }
        let mode = (SceneMeta.modes[scene]?.first) ?? scene.uppercased()
        let elapsed = t

        // --- HUD left ---
        let alt = 42 + Int((sin(elapsed * 0.3) * 12).rounded())
        let hdg = Int((270 + sin(elapsed * 0.12) * 15 + 360).truncatingRemainder(dividingBy: 360))
        let left = [
            "MODE  \(mode)",
            String(format: "ALT   %04dM", alt),
            "SPD   0.18",
            String(format: "HDG   %03d", hdg),
            String(format: "T+    %02d:%02d", Int(elapsed) / 60, Int(elapsed) % 60),
            "RT    \(clock())",
        ]
        for (i, line) in left.enumerated() {
            tr.add(line, xPx: pad, yPx: pad + Float(i) * s * 1.35, pxHeight: s, color: dim, opacity: 0.9)
        }

        // --- HUD right ---
        let right = ["SYS NOMINAL", "94% PWR", "SECURE LNK", String(format: "FPS  %3d", Int(fps))]
        for (i, line) in right.enumerated() {
            let w = tr.width(line, pxHeight: s)
            tr.add(line, xPx: W - w - pad, yPx: pad + Float(i) * s * 1.35, pxHeight: s, color: dim, opacity: 0.9)
        }

        // --- crosshair (center) ---
        let cross = "──┤ ✛ ├──"
        let cw = tr.width(cross, pxHeight: s)
        tr.add(cross, xPx: (W - cw) / 2, yPx: H / 2 - s / 2, pxHeight: s, color: dim, opacity: 0.4)

        // --- vault kanji (large, faint) ---
        tr.add(kanji, xPx: W - s * 5.5, yPx: H - s * 6, pxHeight: s * 4.5, color: accent, opacity: 0.18)

        // --- scene-label slab (upper-center) ---
        let label = SceneMeta.label[scene] ?? scene.uppercased()
        let lw = tr.width(label, pxHeight: s * 2)
        tr.add(label, xPx: (W - lw) / 2, yPx: pad, pxHeight: s * 2, color: accent, opacity: 0.55)

        // --- terminal scrollback (bottom-left, fading upward) ---
        // Keep clear of the curved glass edge: extra left/bottom margin, and cap
        // the line count to what fits so big text isn't clipped at the bottom.
        let ts = s * terminalScale                   // terminal cell height (user-scalable)
        let lh = ts * 1.3
        let leftPad = W * 0.03 + s
        let promptY = H - (H * 0.07 + ts * 1.6)      // bottom margin below the prompt
        let maxLines = max(2, min(10, Int((promptY - H * 0.06) / lh)))
        let lines = terminal.visibleLines(max: maxLines)
        for (i, ln) in lines.reversed().enumerated() {
            let op = max(0.05, pow(0.72, Float(i)))
            let col = ln.category == .quotes ? accent : dim
            tr.add(ln.text, xPx: leftPad, yPx: promptY - Float(i + 1) * lh, pxHeight: ts * 0.9, color: col, opacity: op)
        }
        tr.add(terminal.promptLine(t: t), xPx: leftPad, yPx: promptY, pxHeight: ts * 0.9, color: accent, opacity: 0.95)
    }

    private func clock() -> String {
        let d = Date(); var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        let h = c.component(.hour, from: d), m = c.component(.minute, from: d), sec = c.component(.second, from: d)
        return String(format: "%02d:%02d:%02d", h, m, sec)
    }
}
