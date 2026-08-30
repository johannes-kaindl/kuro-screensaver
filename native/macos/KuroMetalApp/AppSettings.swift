// AppSettings — persisted config for the standalone app (UserDefaults.standard).
// Shared by the config window + fullscreen mode, so selection takes effect
// immediately (read fresh per activation — no host caching like the .saver).

import Foundation
import AppKit

enum AppSettings {
    private static let store = UserDefaults.standard   // NOT the bundle id (invalid as a suite)

    private static func str(_ k: String, _ d: String) -> String { store.string(forKey: k) ?? d }
    private static func setStr(_ k: String, _ v: String) { store.set(v, forKey: k) }
    private static func bool(_ k: String, _ d: Bool) -> Bool { store.object(forKey: k) == nil ? d : store.bool(forKey: k) }
    private static func dbl(_ k: String, _ d: Double) -> Double { store.object(forKey: k) == nil ? d : store.double(forKey: k) }

    static var scene: String { get { str("Scene", AppDefaults.scene) } set { setStr("Scene", newValue) } }
    static var look: String { get { str("Look", AppDefaults.look) } set { setStr("Look", newValue) } }   // selected one-click Look (display only)
    static var preset: String { get { str("Preset", AppDefaults.preset) } set { setStr("Preset", newValue) } }
    static var speed: String { get { str("Speed", AppDefaults.speed) } set { setStr("Speed", newValue) } }
    static var cityAltitude: String { get { str("CityAlt", AppDefaults.cityAltitude) } set { setStr("CityAlt", newValue) } }
    static var fog: String { get { str("Fog", AppDefaults.fog) } set { setStr("Fog", newValue) } }
    static var intensity: Float { get { store.object(forKey: "Intensity") != nil ? store.float(forKey: "Intensity") : AppDefaults.intensity } set { store.set(newValue, forKey: "Intensity") } }
    static var showHud: Bool { get { bool("ShowHud", AppDefaults.showHud) } set { store.set(newValue, forKey: "ShowHud") } }
    static var showRadar: Bool { get { bool("ShowRadar", AppDefaults.showRadar) } set { store.set(newValue, forKey: "ShowRadar") } }
    static var bootEnabled: Bool { get { bool("BootEnabled", AppDefaults.bootEnabled) } set { store.set(newValue, forKey: "BootEnabled") } }
    static var bootSpeed: String { get { str("BootSpeed", AppDefaults.bootSpeed) } set { setStr("BootSpeed", newValue) } }
    static var flatHud: Bool { get { bool("FlatHud", AppDefaults.flatHud) } set { store.set(newValue, forKey: "FlatHud") } }
    static var terminalLayout: String { get { str("TerminalLayout", AppDefaults.terminalLayout) } set { setStr("TerminalLayout", newValue) } }
    static var terminalBandHeight: Float { get { store.object(forKey: "TermBand") != nil ? store.float(forKey: "TermBand") : AppDefaults.terminalBandHeight } set { store.set(newValue, forKey: "TermBand") } }
    static var bankStrength: Float { get { store.object(forKey: "Bank") != nil ? store.float(forKey: "Bank") : AppDefaults.bankStrength } set { store.set(newValue, forKey: "Bank") } }
    static var bloomScale: Float { get { store.object(forKey: "BloomScale") != nil ? store.float(forKey: "BloomScale") : AppDefaults.bloomScale } set { store.set(newValue, forKey: "BloomScale") } }
    static var curvature: Float { get { let v = store.object(forKey: "Curvature") != nil ? store.float(forKey: "Curvature") : AppDefaults.curvature; return min(0.032, v) } set { store.set(newValue, forKey: "Curvature") } }
    static var apertureMask: Float { get { store.object(forKey: "Aperture") != nil ? store.float(forKey: "Aperture") : AppDefaults.apertureMask } set { store.set(newValue, forKey: "Aperture") } }
    static var trails: Float { get { store.object(forKey: "Trails") != nil ? store.float(forKey: "Trails") : AppDefaults.trails } set { store.set(newValue, forKey: "Trails") } }
    static var terminalScale: Float { get { store.object(forKey: "TermScale") != nil ? store.float(forKey: "TermScale") : AppDefaults.terminalScale } set { store.set(newValue, forKey: "TermScale") } }
    static var ntsc: Float { get { store.object(forKey: "NTSC") != nil ? store.float(forKey: "NTSC") : AppDefaults.ntsc } set { store.set(newValue, forKey: "NTSC") } }
    static var halation: Float { get { store.object(forKey: "Halation") != nil ? store.float(forKey: "Halation") : AppDefaults.halation } set { store.set(newValue, forKey: "Halation") } }
    static var dayNight: Bool { get { bool("DayNight", AppDefaults.dayNight) } set { store.set(newValue, forKey: "DayNight") } }
    static var matrix: Bool { get { bool("Matrix", AppDefaults.matrix) } set { store.set(newValue, forKey: "Matrix") } }
    static var reactiveWorld: Bool { get { bool("ReactiveWorld", AppDefaults.reactiveWorld) } set { store.set(newValue, forKey: "ReactiveWorld") } }
    static var wallpaperOnBattery: Bool { get { bool("WallpaperOnBattery", AppDefaults.wallpaperOnBattery) } set { store.set(newValue, forKey: "WallpaperOnBattery") } }
    static var wallpaperRenderScale: Double { get { dbl("WallpaperScale", AppDefaults.wallpaperRenderScale) } set { store.set(newValue, forKey: "WallpaperScale") } }
    static var weather: String { get { str("Weather", AppDefaults.weather) } set { setStr("Weather", newValue) } }
    static var sound: Bool { get { bool("Sound", AppDefaults.sound) } set { store.set(newValue, forKey: "Sound") } }
    static var autoCycle: Bool { get { bool("AutoCycle", AppDefaults.autoCycle) } set { store.set(newValue, forKey: "AutoCycle") } }
    static var cycleMinutes: Double { get { dbl("CycleMin", AppDefaults.cycleMinutes) } set { store.set(newValue, forKey: "CycleMin") } }
    static var idleMinutes: Double { get { dbl("IdleMin", AppDefaults.idleMinutes) } set { store.set(newValue, forKey: "IdleMin") } }

    /// Build a renderer Settings + whether to auto-cycle.
    static func make() -> (settings: Settings, autoCycle: Bool) {
        var s = Settings()
        let sc = scene
        // The film opens on a calm ROUTINE scene — never the matrix fx scene.
        s.scene = (sc == "random" || !SceneRegistry.ids.contains(sc))
            ? (["terrain", "city"].randomElement() ?? "terrain") : sc
        s.presetID = preset
        s.speed = Settings.Speed(rawValue: speed) ?? .norm
        s.cityAltitude = Settings.Altitude(rawValue: cityAltitude) ?? .low
        s.fog = Settings.Fog(rawValue: fog) ?? .auto
        s.crtIntensity = min(1, max(0, intensity))
        s.showHud = showHud
        s.showRadar = showRadar
        s.bootEnabled = bootEnabled
        s.bootSpeed = Settings.BootSpeed(rawValue: bootSpeed) ?? .normal
        s.flatHud = flatHud
        s.terminalLayout = Settings.TerminalLayout(rawValue: terminalLayout) ?? .strip
        s.terminalBandHeight = terminalBandHeight
        s.bankStrength = bankStrength
        s.bloomScale = bloomScale
        s.curvature = curvature
        s.apertureMask = apertureMask
        s.trails = trails
        s.terminalScale = terminalScale
        s.ntsc = ntsc
        s.halation = halation
        s.dayNight = dayNight
        s.matrix = matrix
        s.reactiveWorld = reactiveWorld
        s.weather = Settings.Weather(rawValue: weather) ?? .lightFog
        // a11y: honour System Settings → Accessibility → Reduce Motion (CALM transitions).
        s.reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        return (s, autoCycle)
    }
}
