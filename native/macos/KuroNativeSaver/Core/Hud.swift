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
                matrix: Bool = false, matrixOpacity: Float = 0.4,
                terminalLayout: Settings.TerminalLayout = .strip, showPanels: Bool = true) {
        let dim = accent * 0.72
        let s = Float(height) / 64                         // base cell height (px)
        let pad = s * 1.5
        let W = Float(width), H = Float(height)

        // matrix rain behind everything (drawn first → other text composites over)
        if matrix { MatrixRain.render(tr, width: width, height: height, accent: accent, t: t, opacity: matrixOpacity) }

        // narrative terminal — independent of the HUD flight panels
        switch terminalLayout {
        case .off: break
        case .strip: renderTerminalStrip(tr, W: W, H: H, s: s, accent: accent, dim: dim, t: t, scale: terminalScale, darken: false)
        case .stripDark: renderTerminalStrip(tr, W: W, H: H, s: s, accent: accent, dim: dim, t: t, scale: terminalScale, darken: true)
        case .window: renderTerminalWindow(tr, W: W, H: H, accent: accent, dim: dim, t: t, scale: terminalScale)
        }

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

        // --- scene-label slab (upper-center) ---
        let label = SceneMeta.label[scene] ?? scene.uppercased()
        let lw = tr.width(label, pxHeight: s * 2)
        tr.add(label, xPx: (W - lw) / 2, yPx: pad, pxHeight: s * 2, color: accent, opacity: 0.55)

    }

    // --- terminal: bottom-left strip, fading upward (the compact overlay) ---
    private func renderTerminalStrip(_ tr: TextRenderer, W: Float, H: Float, s: Float,
                                     accent: SIMD3<Float>, dim: SIMD3<Float>, t: Double, scale: Float, darken: Bool) {
        // Keep clear of the curved glass edge: extra left/bottom margin, cap lines.
        let ts = s * scale
        let lh = ts * 1.3
        let cell = ts * 0.9
        let leftPad = W * 0.03 + s
        let promptY = H - (H * 0.07 + ts * 1.6)
        let maxLines = max(2, min(10, Int((promptY - H * 0.06) / lh)))
        let lines = terminal.visibleLines(max: maxLines)
        // optional dark panel behind the whole text block (drawn first → text over it)
        if darken, !lines.isEmpty {
            var maxW = tr.width(terminal.promptLine(t: t), pxHeight: cell)
            for ln in lines { maxW = max(maxW, tr.width(ln.text, pxHeight: cell)) }
            let topY = promptY - Float(lines.count) * lh
            let px = leftPad - cell * 0.6, py = topY - lh * 0.25
            let pw = maxW + cell * 1.2, ph = (promptY - topY) + lh * 1.25
            tr.fillRect(xPx: px, yPx: py, wPx: pw, hPx: ph, color: SIMD3(0, 0, 0), opacity: 0.62)
            // faint accent edges so the panel reads even over dark areas
            let b = max(1, H * 0.0013), eop: Float = 0.16
            tr.fillRect(xPx: px, yPx: py, wPx: pw, hPx: b, color: accent, opacity: eop)
            tr.fillRect(xPx: px, yPx: py + ph - b, wPx: pw, hPx: b, color: accent, opacity: eop)
            tr.fillRect(xPx: px, yPx: py, wPx: b, hPx: ph, color: accent, opacity: eop)
            tr.fillRect(xPx: px + pw - b, yPx: py, wPx: b, hPx: ph, color: accent, opacity: eop)
        }
        for (i, ln) in lines.reversed().enumerated() {
            let op = max(0.05, pow(0.72, Float(i)))
            let col = ln.category == .quotes ? accent : dim
            tr.add(ln.text, xPx: leftPad, yPx: promptY - Float(i + 1) * lh, pxHeight: cell, color: col, opacity: op)
        }
        tr.add(terminal.promptLine(t: t), xPx: leftPad, yPx: promptY, pxHeight: cell, color: accent, opacity: 0.95)
    }

    // --- terminal: Apple-Lisa-style centered CORP OS window (the story mode) ---
    private func renderTerminalWindow(_ tr: TextRenderer, W: Float, H: Float,
                                      accent: SIMD3<Float>, dim: SIMD3<Float>, t: Double, scale: Float) {
        let winW = min(W * 0.84, H * 1.5)
        let winH = H * 0.64
        let winX = (W - winW) / 2, winY = (H - winH) / 2
        let border = max(2, H * 0.0028)
        let cell = (H / 52) * min(max(scale, 0.6), 1.8)        // text cell (terminalScale-aware)
        let lh = cell * 1.28
        let titleH = cell * 1.7
        let statusH = cell * 1.4
        let pad = cell * 0.85
        let bg = SIMD3<Float>(0.012, 0.022, 0.012)             // near-black green fill

        // backdrop dimmer + window background + a 4-edge border frame (NOT a full
        // accent fill behind — that washed the interior bright green).
        tr.fillRect(xPx: 0, yPx: 0, wPx: W, hPx: H, color: SIMD3(0, 0, 0), opacity: 0.52)
        tr.fillRect(xPx: winX, yPx: winY, wPx: winW, hPx: winH, color: bg, opacity: 0.97)
        let bop: Float = 0.55
        tr.fillRect(xPx: winX - border, yPx: winY - border, wPx: winW + 2 * border, hPx: border, color: accent, opacity: bop)   // top
        tr.fillRect(xPx: winX - border, yPx: winY + winH, wPx: winW + 2 * border, hPx: border, color: accent, opacity: bop)     // bottom
        tr.fillRect(xPx: winX - border, yPx: winY, wPx: border, hPx: winH, color: accent, opacity: bop)                          // left
        tr.fillRect(xPx: winX + winW, yPx: winY, wPx: border, hPx: winH, color: accent, opacity: bop)                           // right

        // titlebar — Lisa horizontal stripes
        let stripeN = 6
        let lineH1 = max(1, H * 0.0016)
        for i in 0..<stripeN {
            let sy = winY + titleH * (0.26 + 0.52 * Float(i) / Float(stripeN - 1))
            tr.fillRect(xPx: winX + pad, yPx: sy, wPx: winW - 2 * pad, hPx: lineH1, color: accent, opacity: 0.3)
        }
        // close box (top-left): accent square with a hollow dark centre
        let boxS = titleH * 0.42
        let boxX = winX + pad, boxY = winY + (titleH - boxS) / 2
        tr.fillRect(xPx: boxX, yPx: boxY, wPx: boxS, hPx: boxS, color: accent, opacity: 0.62)
        tr.fillRect(xPx: boxX + boxS * 0.22, yPx: boxY + boxS * 0.22, wPx: boxS * 0.56, hPx: boxS * 0.56, color: bg, opacity: 1)
        // centered title label on a dark patch (interrupts the stripes)
        let title = "CORP TERMINAL.APP v4.1"
        let titleCell = titleH * 0.5
        let titleW = tr.width(title, pxHeight: titleCell)
        let titleX = winX + (winW - titleW) / 2
        tr.fillRect(xPx: titleX - pad * 0.7, yPx: winY + titleH * 0.12, wPx: titleW + pad * 1.4, hPx: titleH * 0.76, color: bg, opacity: 1)
        tr.add(title, xPx: titleX, yPx: winY + (titleH - titleCell) / 2, pxHeight: titleCell, color: accent, opacity: 0.7)
        tr.fillRect(xPx: winX, yPx: winY + titleH, wPx: winW, hPx: max(1, border * 0.6), color: accent, opacity: 0.45)

        // status bar
        let statusY = winY + winH - statusH
        tr.fillRect(xPx: winX, yPx: statusY, wPx: winW, hPx: max(1, border * 0.6), color: accent, opacity: 0.35)
        let statusCell = statusH * 0.5
        let statusYMid = statusY + (statusH - statusCell) / 2
        tr.add("SECTOR 7 · UTC \(clock())", xPx: winX + pad, yPx: statusYMid, pxHeight: statusCell, color: dim, opacity: 0.6)
        let rightS = "SECURE LNK"
        let rw = tr.width(rightS, pxHeight: statusCell)
        tr.add(rightS, xPx: winX + winW - pad - rw, yPx: statusYMid, pxHeight: statusCell, color: dim, opacity: 0.6)

        // content: chronological scrollback + prompt, word-wrapped (no left-clip)
        let contentTop = winY + titleH + pad
        let contentBottom = statusY - pad
        let maxRows = max(3, Int((contentBottom - contentTop) / lh))
        let maxChars = max(8, Int((winW - 2 * pad) / tr.charWidth(pxHeight: cell)))
        let logical = terminal.visibleLines(max: maxRows + 6)   // extra: wrapping expands the count
        var rows: [(String, SIMD3<Float>, Float)] = []
        for ln in logical {
            let (col, op) = colorFor(ln.category, accent: accent, dim: dim)
            for r in wrap(ln.text, maxChars) { rows.append((r, col, op)) }
        }
        for r in wrap(terminal.promptLine(t: t), maxChars) { rows.append((r, accent, 0.95)) }
        let shown = rows.suffix(maxRows)
        let startI = maxRows - shown.count                      // bottom-align under the prompt
        for (i, row) in shown.enumerated() {
            tr.add(row.0, xPx: winX + pad, yPx: contentTop + Float(startI + i) * lh, pxHeight: cell, color: row.1, opacity: row.2)
        }
    }

    /// Word-wrap a line to ≤ maxChars per row (hard-splits overlong single tokens).
    private func wrap(_ s: String, _ maxChars: Int) -> [String] {
        if s.count <= maxChars { return [s] }
        var rows: [String] = [], cur = ""
        for word in s.split(separator: " ", omittingEmptySubsequences: false) {
            var w = String(word)
            while w.count > maxChars {                           // a single token longer than a row
                if !cur.isEmpty { rows.append(cur); cur = "" }
                rows.append(String(w.prefix(maxChars))); w = String(w.dropFirst(maxChars))
            }
            if cur.isEmpty { cur = w }
            else if cur.count + 1 + w.count <= maxChars { cur += " " + w }
            else { rows.append(cur); cur = w }
        }
        if !cur.isEmpty { rows.append(cur) }
        return rows
    }

    private func colorFor(_ c: Terminal.Cat, accent: SIMD3<Float>, dim: SIMD3<Float>) -> (SIMD3<Float>, Float) {
        // Kept dim — the window is drawn into the HDR scene, so bright text blooms
        // into haze. Low deposited luma keeps it crisp + readable.
        switch c {
        case .cmd, .deny, .warning: return (accent, 0.72)
        case .quotes: return (accent, 0.70)
        case .instr: return (accent, 0.66)
        case .ghost: return (dim * 0.85, 0.55)
        default: return (dim, 0.6)
        }
    }

    private func clock() -> String {
        let d = Date(); var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        let h = c.component(.hour, from: d), m = c.component(.minute, from: d), sec = c.component(.second, from: d)
        return String(format: "%02d:%02d:%02d", h, m, sec)
    }
}
