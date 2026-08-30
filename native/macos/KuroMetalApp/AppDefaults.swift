// AppDefaults — the values the app falls back to when UserDefaults holds nothing.
//
// Extracted from AppSettings so they can be checked WITHOUT touching a store:
// tests/main.swift § "app defaults vs the shared query contract" holds them
// against native/shared/query-contract.txt, the same fixture the Windows and
// Linux hosts and tests/screensaver-params.test.ts read.
//
// Until 2026-08-30 the Metal app hung on no parity checkpoint at all, which is
// how autoCycle (and the two below) drifted away from the engine unnoticed.
// This file is the macOS counterpart to src/engine/data/defaults.ts — change a
// value here only together with the contract.

enum AppDefaults {
    static let scene = "random"
    static let look = "custom"          // display-only: which one-click Look is selected
    static let preset = "toxic-haze"
    static let speed = "norm"
    static let cityAltitude = "low"
    static let fog = "auto"
    static let intensity: Float = 0.35
    static let showHud = true
    static let showRadar = true
    static let bootEnabled = true
    static let bootSpeed = "normal"
    static let flatHud = false
    static let terminalLayout = "strip"
    static let terminalBandHeight: Float = 0.24
    static let bankStrength: Float = 1
    static let bloomScale: Float = 1
    static let curvature: Float = 0.012
    static let apertureMask: Float = 0.22
    static let trails: Float = 0.35
    static let terminalScale: Float = 1
    static let ntsc: Float = 0
    static let halation: Float = 0.15
    static let dayNight = true          // contract: daynight=on (was false on macOS only, until 2026-08-30)
    static let matrix = false
    static let reactiveWorld = true
    static let wallpaperOnBattery = false
    static let wallpaperRenderScale = 0.66
    static let weather = "light-fog"   // contract: weather=light-fog (macOS called this "clear" until 2026-08-30)
    static let sound = false
    static let autoCycle = false
    static let cycleMinutes = 5.0       // contract: cyclemin=5 (was 0.5 on macOS only — a factor of 10)
    static let idleMinutes = 5.0
}
