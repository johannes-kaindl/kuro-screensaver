// Transition profiles — Swift mirror of src/engine/modes/transition-profiles.ts.
// The choreography for a warp scene change. Brick B: generic DEFAULT + terrain→city hero.

struct TransitionProfile {
    var windupDur: Double   // s — wind-up (climb / centre)
    var warpDur: Double     // s — accelerate, streak, swap at the peak (mid-warp)
    var emergeDur: Double   // s — ease back, descend, hand to the scene
    var warpSpeed: Float    // peak speedMul during the warp
    var fovPush: Float      // degrees added to base FOV at the warp peak
    var climbPitch: Float? = nil      // windup nose-up (radians); hero only
    var entryAltitude: Float? = nil   // emerge starts cam.y here, eases to the scene's natural y
}

enum TransitionProfiles {
    static let DEFAULT = TransitionProfile(windupDur: 0.6, warpDur: 1.4, emergeDur: 1.0,
                                           warpSpeed: 6, fovPush: 28)
    /// calm mode: a short, motion-light transition that still swaps.
    static let CALM = TransitionProfile(windupDur: 0.2, warpDur: 0.5, emergeDur: 0.4,
                                        warpSpeed: 1.6, fovPush: 0)

    private static let hero: [String: TransitionProfile] = [
        "terrain>city": TransitionProfile(windupDur: 1.2, warpDur: 1.6, emergeDur: 2.2,
                                          warpSpeed: 7, fovPush: 32, climbPitch: 0.28,
                                          entryAltitude: 60),
    ]

    static func profileFor(from: String, to: String, calm: Bool = false) -> TransitionProfile {
        if calm { return CALM }
        return hero["\(from)>\(to)"] ?? DEFAULT
    }
}
