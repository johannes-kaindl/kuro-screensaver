// Assert-based logic tests for the renderer Core. Run via
// scripts/run-native-tests.sh — exits non-zero if any assertion fails.
// Reference values for LCG + height computed from the web engine (Python/JS).

import Foundation
import simd

var failures = 0
func check(_ cond: Bool, _ msg: String) {
    if cond { print("ok   - \(msg)") } else { print("FAIL - \(msg)"); failures += 1 }
}
func approx(_ a: Double, _ b: Double, _ tol: Double, _ msg: String) {
    check(abs(a - b) <= tol, "\(msg) (got \(a), want \(b), tol \(tol))")
}

// --- LCG: bit-for-bit vs web mkRng -----------------------------------------
do {
    var r = LCG(seed: 1)
    let exp1 = [0.236455525271595, 0.369270673720166, 0.504242032300681,
                0.704883263679221, 0.050543628633022]
    for (i, e) in exp1.enumerated() { approx(r.next(), e, 1e-12, "LCG seed1 [\(i)]") }

    var r2 = LCG(seed: 1337)
    let exp2 = [0.754225567914546, 0.549500931752846, 0.274493878241628,
                0.158748119371012, 0.449464006349444]
    for (i, e) in exp2.enumerated() { approx(r2.next(), e, 1e-12, "LCG seed1337 [\(i)]") }
}

// --- terrain height field vs web heightAt ----------------------------------
do {
    approx(Double(terrainHeight(0, 0)), 1.8, 2e-3, "height(0,0)")
    approx(Double(terrainHeight(5, -12)), -2.702330068427646, 2e-3, "height(5,-12)")
    approx(Double(terrainHeight(-3.5, 7.25)), -0.873893886150996, 2e-3, "height(-3.5,7.25)")
}

// --- camera FOV breakpoints -------------------------------------------------
do {
    check(Camera.defaultFovDeg(width: 2560, height: 1440) == 62, "fov 16:9 = 62")
    check(Camera.defaultFovDeg(width: 600, height: 800) == 95, "fov portrait = 95")
    check(Camera.defaultFovDeg(width: 1280, height: 1024) == 72, "fov ~5:4 = 72")
}

// --- terrain seam continuity ------------------------------------------------
do {
    check(abs(Terrain.startB - Terrain.startA) == Terrain.D, "|startB-startA| == D")
    let la = Terrain.startA, lb = Terrain.startB
    // The meeting edges sample the SAME logical z: (-90 + la) == (90 + lb).
    for x: Float in [-50, -10, 0, 10, 50] {
        approx(Double(terrainHeight(x, -90 + la)),
               Double(terrainHeight(x, 90 + lb)), 1e-6, "seam continuity x=\(x)")
    }
    // After a wrap (both offsets -= 2D) the relation still holds.
    let la2 = la - 2 * Terrain.D, lb2 = lb - 2 * Terrain.D
    approx(Double(terrainHeight(0, -90 + la2)),
           Double(terrainHeight(0, 90 + lb2)), 1e-6, "seam continuity after wrap")
}

// --- palette sanity ---------------------------------------------------------
do {
    check(Palette.presets.count == 13, "13 presets")
    let p = Palette.preset("phosphor")
    check(p.accentHex == 0x39ff7a, "phosphor accent hex")
    // glow*4 = 2.8, capped at 1.8 (2026-06-03 colour tuning — keeps the hue vs blowing to white)
    approx(Double(p.bloomStrength), 1.8, 1e-6, "phosphor bloomStrength (capped at 1.8)")
    check(Palette.preset("nope").id == "toxic-haze", "unknown preset falls back to toxic-haze")
}

if failures > 0 { print("\n\(failures) FAILURE(S)"); exit(1) }
print("\nALL PASS (\(failures == 0))")
