// BootSequence — a BIOS-style boot overlay shown at startup: a centred column of
// system lines, each with a right-aligned [ OK ], revealed one at a time, then a
// scene-specific header. Web mirror (hud/boot.ts + DICT.BOOT_HEADERS). Drawn flat
// over the final composite via the TextRenderer; when it finishes, the renderer
// fires the CRT power-on so the scene expands into view ("machine just booted").

import simd
import Foundation

struct BootSequence {
    private let rows: [(text: String, ok: Bool, header: Bool)]
    private let lineDur: Double      // s between line reveals
    private let endHold: Double      // s held after the last line
    private var elapsed: Double = 0
    private(set) var finished = false

    private static let headers: [String: String] = [
        "terrain":  ">> TERRAIN SWEEP ENGAGED // RECON ALTITUDE",
        "city":     ">> CITY RECON ONLINE // LOW ALTITUDE APPROACH",
        "rift":     ">> RIFT INCURSION ACTIVE // INVERSION VECTOR ARMED",
        "tunnel":   ">> TUNNEL LOCK CONFIRMED // INFIL VECTOR PRIMED",
        "void":     ">> VOID DRIFT ACTIVE // DEEP SPACE ANCHOR",
        "wreckage": ">> WRECKAGE FIELD // CORP STATION DEBRIS — SALVAGE SWEEP",
        "matrix":   ">> MATRIX RAIN ENGAGED // DIGITAL DOWNPOUR",
    ]

    init(scene: String, speed: Settings.BootSpeed) {
        switch speed {
        case .fast:      lineDur = 0.06; endHold = 0.30
        case .normal:    lineDur = 0.16; endHold = 0.60
        case .cinematic: lineDur = 0.32; endHold = 1.00
        }
        var r: [(String, Bool, Bool)] = Script.boot.prefix(7).map { ($0, true, false) }
        r.append(("", false, false))                                     // spacer
        r.append((BootSequence.headers[scene] ?? ">> SYSTEM ONLINE", false, true))
        rows = r
    }

    /// Advance the reveal clock; returns true exactly once, when the boot finishes.
    mutating func advance(_ dt: Double) -> Bool {
        guard !finished else { return false }
        elapsed += dt
        if elapsed >= Double(rows.count) * lineDur + endHold { finished = true; return true }
        return false
    }

    func render(_ tr: TextRenderer, W: Float, H: Float, accent: SIMD3<Float>) {
        tr.fillRect(xPx: 0, yPx: 0, wPx: W, hPx: H, color: SIMD3(0, 0, 0), opacity: 1)   // opaque backdrop
        let cell = H / 64 * 1.1
        let lh = cell * 1.7
        let colW = min(W * 0.62, cell * 34)
        let x0 = (W - colW) / 2
        let y0 = (H - Float(rows.count) * lh) / 2
        let dim = accent * 0.85
        let revealed = min(rows.count, Int(elapsed / lineDur) + 1)
        for i in 0..<revealed {
            let row = rows[i]
            if row.text.isEmpty { continue }
            let y = y0 + Float(i) * lh
            tr.add(row.text, xPx: x0, yPx: y, pxHeight: cell,
                   color: row.header ? accent : dim, opacity: row.header ? 0.95 : 0.85)
            if row.ok {
                let ok = "[ OK ]"
                tr.add(ok, xPx: x0 + colW - tr.width(ok, pxHeight: cell), yPx: y,
                       pxHeight: cell, color: accent, opacity: 0.8)
            }
        }
    }
}
