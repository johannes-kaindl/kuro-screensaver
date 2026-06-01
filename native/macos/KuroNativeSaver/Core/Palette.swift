// Palette — the 13 color presets from src/engine/data/presets.ts, plus the
// per-preset CRT parameter mapping (the web fxInheritFromTheme math).

import simd

struct ColorPreset {
    let id: String
    let label: String
    let kanji: String
    let accentHex: UInt32          // darkAccent.color (the only one the look uses)
    let glow: Float                // glowIntensity
    let scanline: Float            // scanlineOpacity
    let vignette: Float            // vignetteStrength

    var accentRGB: SIMD3<Float> {
        SIMD3(Float((accentHex >> 16) & 0xFF) / 255,
              Float((accentHex >> 8) & 0xFF) / 255,
              Float(accentHex & 0xFF) / 255)
    }

    // CRT mapping (fxInheritFromTheme): the intended bloom/scan/vignette per preset.
    var bloomStrength: Float { max(0.4, glow * 4) }
    var scanOpacity: Float { max(0.02, scanline * 5) }
    var vignetteStrength: Float { max(0.15, vignette + 0.15) }
}

enum Palette {
    static let presets: [ColorPreset] = [
        ColorPreset(id: "kuro",           label: "Kuro",           kanji: "黒", accentHex: 0xc4c0b4, glow: 0.15, scanline: 0.01,  vignette: 0),
        ColorPreset(id: "neural-bleed",   label: "Neural Bleed",   kanji: "脳", accentHex: 0xE8A5A5, glow: 0.2,  scanline: 0.01,  vignette: 0),
        ColorPreset(id: "rust-signal",    label: "Rust Signal",    kanji: "鉄", accentHex: 0xE8B979, glow: 0.35, scanline: 0.025, vignette: 0.1),
        ColorPreset(id: "toxic-haze",     label: "Toxic Haze",     kanji: "毒", accentHex: 0xD9C566, glow: 0.3,  scanline: 0.02,  vignette: 0),
        ColorPreset(id: "biolink",        label: "Biolink",        kanji: "命", accentHex: 0x8BBF87, glow: 0.25, scanline: 0.015, vignette: 0),
        ColorPreset(id: "ghost-protocol", label: "Ghost Protocol", kanji: "霊", accentHex: 0x7AB8C4, glow: 0.3,  scanline: 0.02,  vignette: 0),
        ColorPreset(id: "voidwitch",      label: "Voidwitch",      kanji: "魔", accentHex: 0xB49BD1, glow: 0.4,  scanline: 0.03,  vignette: 0.2),
        ColorPreset(id: "circuit",        label: "Circuit",        kanji: "電", accentHex: 0x4ac8d8, glow: 0.44, scanline: 0.035, vignette: 0),
        ColorPreset(id: "crimson",        label: "Crimson",        kanji: "紅", accentHex: 0xd4203a, glow: 0.5,  scanline: 0.04,  vignette: 0.25),
        ColorPreset(id: "phosphor",       label: "Phosphor",       kanji: "光", accentHex: 0x39ff7a, glow: 0.7,  scanline: 0.06,  vignette: 0),
        ColorPreset(id: "ember",          label: "Ember",          kanji: "炎", accentHex: 0xffb442, glow: 0.5,  scanline: 0.04,  vignette: 0.15),
        ColorPreset(id: "spectre",        label: "Spectre",        kanji: "幻", accentHex: 0xa878ff, glow: 0.45, scanline: 0.03,  vignette: 0.2),
        ColorPreset(id: "pearl",          label: "Pearl",          kanji: "珠", accentHex: 0xe8e4d8, glow: 0.1,  scanline: 0,     vignette: 0),
    ]

    static func preset(_ id: String) -> ColorPreset {
        presets.first { $0.id == id } ?? presets[3] // default toxic-haze
    }
}
