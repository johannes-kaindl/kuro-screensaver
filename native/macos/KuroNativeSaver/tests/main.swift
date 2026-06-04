// Assert-based logic tests for the renderer Core. Run via
// scripts/run-native-tests.sh — exits non-zero if any assertion fails.
// Reference values for LCG + height computed from the web engine (Python/JS).

import Foundation
import simd
import Metal

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

// --- scene registry ---------------------------------------------------------
// Guards against scene drift (e.g. a scene added to the web SCENE_REGISTRY but not
// here, or vice versa). Keep in sync with src/engine/engine/core.ts SCENE_REGISTRY.
do {
    check(SceneRegistry.ids.count == 6, "6 scenes")
    check(Set(SceneRegistry.ids).count == SceneRegistry.ids.count, "scene ids unique")
    check(SceneRegistry.ids.contains("matrix"), "matrix scene registered")
}

// --- FlightDirector: envelope math (mirrors src/engine/modes/flight-director.ts) --
// sin²(πp): value AND slope are 0 at both ends, peak 1 at the middle → no roll snap.
do {
    approx(Double(FlightDirector.envelope(0.0)), 0.0, 1e-12, "env(0)=0")
    approx(Double(FlightDirector.envelope(1.0)), 0.0, 1e-12, "env(1)=0")
    approx(Double(FlightDirector.envelope(0.5)), 1.0, 1e-9,  "env(0.5)=1")
    check(FlightDirector.envelope(0.001) < 1e-3, "env slope→0 at start")
    check(FlightDirector.envelope(0.999) < 1e-3, "env slope→0 at end")
}

// --- FlightDirector: same seed ⇒ identical kick result (the regenerating film) ----
do {
    let a = FlightDirector(seed: 1337); let b = FlightDirector(seed: 1337)
    a.enqueue(Manoeuvre(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    b.enqueue(Manoeuvre(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    var ca = Camera(); ca.position.x = 1
    var cb = Camera(); cb.position.x = 1
    for _ in 0..<10 { a.update(t: 0, dt: 0.05); a.apply(&ca); b.update(t: 0, dt: 0.05); b.apply(&cb) }
    approx(Double(ca.position.x), Double(cb.position.x), 1e-12, "director deterministic x")
    check(ca.position.x < 1.0, "kick dampened cam.x")
}

// --- FlightDirector warp transition: stage clock, ramp C1, swap-once ------------
do {
    let d = FlightDirector(seed: 7)
    var swaps = 0
    let p = TransitionProfile(windupDur: 0.5, warpDur: 1.0, emergeDur: 0.5,
                              warpSpeed: 6, fovPush: 30)
    d.beginTransition(p, baseFov: 72) { swaps += 1 }
    check(d.inTransition, "inTransition true after begin")
    var maxSpeed: Float = 0
    for _ in 0..<100 { d.update(t: 0, dt: 0.02); maxSpeed = max(maxSpeed, d.speedMul) }  // 2.0s total
    check(swaps == 1, "swap fired exactly once")
    check(maxSpeed > 5.5 && maxSpeed <= 6.0, "speedMul ramped to ~warpSpeed")
    check(!d.inTransition, "inTransition false after total duration")
    approx(Double(d.speedMul), 1.0, 1e-6, "speedMul back to 1 after transition")
}

// --- FilmDirector: deterministic, tier-matched, no immediate repeat ---------------
do {
    let f = FilmDirector(seed: 99)
    let cands: [ShiftPhase: [String]] = [
        .routine: ["terrain","city"], .intrusion: ["city","rift"], .alarm: ["rift","tunnel"],
        .panic: ["tunnel","void"], .silence: ["void"]]
    let a = f.sceneAt(3, phase: .alarm, prev: nil)
    let b = FilmDirector(seed: 99).sceneAt(3, phase: .alarm, prev: nil)
    check(a == b, "FilmDirector deterministic")
    check(cands[.alarm]!.contains(a), "alarm pick in candidates")
    let prev = f.sceneAt(5, phase: .intrusion, prev: nil)
    let nextPick = f.sceneAt(5, phase: .intrusion, prev: prev)
    check(nextPick != prev, "no immediate repeat when alt exists")
}

// --- CombatDirector: antagonist threshold + no duplicate ------------------------
if let device = MTLCreateSystemDefaultDevice() {
    func mkHost(_ add: @escaping (Actor) -> Void) -> ActorHost {
        ActorHost(device: device, add: add, accentRGB: { SIMD3(0, 1, 0) }, enemyRGB: { SIMD3(1, 0, 0.25) })
    }
    var n1 = 0
    let c1 = CombatDirector(seed: 5, bus: EventBus(), host: mkHost { _ in n1 += 1 })
    c1.update(t: 1, threat: 0.2)
    check(n1 == 0, "no antagonist below threat 0.35")
    var n2 = 0
    let c2 = CombatDirector(seed: 5, bus: EventBus(), host: mkHost { _ in n2 += 1 })
    c2.update(t: 1, threat: 0.5)
    check(n2 == 1, "antagonist spawns above threat 0.35")
    c2.update(t: 1.1, threat: 0.5)
    check(n2 == 1, "no duplicate antagonist while alive")
} else {
    print("ok   - (combat test skipped — no Metal device)")
}

if failures > 0 { print("\n\(failures) FAILURE(S)"); exit(1) }
print("\nALL PASS (\(failures == 0))")
