// Looks — curated one-click bundles of the CRT/effect knobs. Picking a Look sets
// every effect slider (and a matching color) at once, so users get a coherent
// vibe without tuning ~10 controls. Scene + terminal size stay user-controlled.
// Pure data → lives in Core (shared, testable). The config window applies these.

struct Look {
    let id: String
    let label: String
    let preset: String        // color preset id (Palette)
    let curvature: Float
    let apertureMask: Float
    let trails: Float
    let ntsc: Float
    let halation: Float
    let bloomScale: Float
    let intensity: Float      // crtIntensity → glitch cadence
    let matrix: Bool
}

enum Looks {
    static let all: [Look] = [
        // Sauber: a clean, crisp render — every degradation effect off (flat, no grille,
        // no smear/glitch/bleed), only a touch of bloom so wireframes still glow.
        Look(id: "clean",  label: "Sauber",            preset: "kuro",     curvature: 0.0,  apertureMask: 0.0,  trails: 0.0,  ntsc: 0.0, halation: 0.0,  bloomScale: 0.45, intensity: 0.0,  matrix: false),
        // The full vintage tube: heavy curve, visible grille, green glow.
        Look(id: "heavy",  label: "Voll-CRT",          preset: "phosphor", curvature: 0.22, apertureMask: 0.45, trails: 0.50, ntsc: 0.6, halation: 0.40, bloomScale: 1.4, intensity: 0.50, matrix: false),
        // Damaged signal: frequent glitches, strong NTSC shimmer, crimson.
        Look(id: "broken", label: "Defektes Terminal", preset: "crimson",  curvature: 0.17, apertureMask: 0.32, trails: 0.42, ntsc: 0.9, halation: 0.50, bloomScale: 1.2, intensity: 0.85, matrix: false),
        // Dreamy neon: long persistence, heavy halation bloom, purple.
        Look(id: "vapor",  label: "Vaporwave",         preset: "spectre",  curvature: 0.14, apertureMask: 0.18, trails: 0.70, ntsc: 0.4, halation: 0.60, bloomScale: 1.8, intensity: 0.20, matrix: false),
        // Code rain forward: matrix on, green, moderate tube.
        Look(id: "matrix", label: "Matrix",            preset: "phosphor", curvature: 0.12, apertureMask: 0.22, trails: 0.45, ntsc: 0.3, halation: 0.35, bloomScale: 1.2, intensity: 0.25, matrix: true),
    ]

    static func find(_ id: String) -> Look? { all.first { $0.id == id } }
}
