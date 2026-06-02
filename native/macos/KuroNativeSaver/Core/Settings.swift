// Settings — the runtime config the renderer reads. The .saver host populates
// this from ScreenSaverDefaults; the harness from CLI args.

struct Settings {
    enum Speed: String, CaseIterable {
        case slow, norm, fast
        var multiplier: Float {
            switch self {
            case .slow: return 0.32
            case .norm: return 1
            case .fast: return 2.8
            }
        }
    }

    enum Altitude: String, CaseIterable {
        case low, mid, high
        var value: Float { switch self { case .low: return 4; case .mid: return 11; case .high: return 24 } }
    }
    enum Fog: String, CaseIterable {
        case clear, auto, dense
        var mul: Float { switch self { case .clear: return 0.45; case .auto: return 1; case .dense: return 2.2 } }
    }

    var scene: String = "terrain"
    var presetID: String = "toxic-haze"
    var speed: Speed = .norm
    var cityAltitude: Altitude = .low
    var showHud = true              // HUD + terminal overlay
    var bloomScale: Float = 1       // multiplier on the per-preset bloom strength (0 = off)
    var fog: Fog = .auto
    var crtIntensity: Float = 0.35     // 0..1, drives the glitch scheduler cadence
    var tunnelAutoBoost: Bool = true   // tunnel: speed surge on straight sections
    var seed: Int32? = nil             // nil → fresh per activation

    var preset: ColorPreset { Palette.preset(presetID) }
}
