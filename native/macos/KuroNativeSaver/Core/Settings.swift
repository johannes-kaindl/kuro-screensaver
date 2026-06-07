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
    var showHud = true              // HUD panels (flight data, crosshair, scene label)
    var flatHud = false             // draw HUD + terminal flat AFTER the CRT composite (crisp, uncurved) vs in-monitor
    var reducedMotion = false       // a11y: route scene transitions through the CALM profile (set by the app host from NSWorkspace)
    enum TerminalLayout: String, CaseIterable { case off, strip, stripDark = "stripdark", window }
    var terminalLayout: TerminalLayout = .strip   // narrative terminal: off / strip / full-width band / Lisa window
    var terminalBandHeight: Float = 0.24          // band layout: fraction of screen height it occupies
    var bloomScale: Float = 1       // multiplier on the per-preset bloom strength (0 = off)
    var fog: Fog = .auto
    var curvature: Float = 0.012    // CRT screen barrel curvature (0 = flat; gentle by design)
    var apertureMask: Float = 0.22  // RGB phosphor grille strength (0 = off)
    var trails: Float = 0.35        // phosphor persistence decay (0 = off, ~0.9 = long)
    var terminalScale: Float = 1    // terminal text size multiplier
    var ntsc: Float = 0             // NTSC/composite shimmer (0 = off)
    var halation: Float = 0.15      // warm glow bleed around bright areas
    var dayNight = false            // slow brightness/bloom day-night cycle
    var matrix = false              // matrix-rain background
    var reactiveWorld = true        // the 3D world reacts to the narrative shift phase (fog/CRT escalation)
    enum Weather: String, CaseIterable { case clear, storm, dust }
    var weather: Weather = .clear
    var bankStrength: Float = 1        // flight banking intensity (0 = level flight, 2 = aggressive)
    var crtIntensity: Float = 0.35     // 0..1, drives the glitch scheduler cadence
    var tunnelAutoBoost: Bool = true   // tunnel: speed surge on straight sections
    var seed: Int32? = nil             // nil → fresh per activation

    var preset: ColorPreset { Palette.preset(presetID) }
}
