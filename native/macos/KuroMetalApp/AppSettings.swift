// AppSettings — persisted config for the standalone app (UserDefaults.standard).
// Shared by the config window + fullscreen mode, so selection takes effect
// immediately (read fresh per activation — no host caching like the .saver).

import Foundation

enum AppSettings {
    private static let store = UserDefaults.standard   // NOT the bundle id (invalid as a suite)

    private static func str(_ k: String, _ d: String) -> String { store.string(forKey: k) ?? d }
    private static func setStr(_ k: String, _ v: String) { store.set(v, forKey: k) }
    private static func bool(_ k: String, _ d: Bool) -> Bool { store.object(forKey: k) == nil ? d : store.bool(forKey: k) }
    private static func dbl(_ k: String, _ d: Double) -> Double { store.object(forKey: k) == nil ? d : store.double(forKey: k) }

    static var scene: String { get { str("Scene", "random") } set { setStr("Scene", newValue) } }
    static var preset: String { get { str("Preset", "toxic-haze") } set { setStr("Preset", newValue) } }
    static var speed: String { get { str("Speed", "norm") } set { setStr("Speed", newValue) } }
    static var cityAltitude: String { get { str("CityAlt", "low") } set { setStr("CityAlt", newValue) } }
    static var fog: String { get { str("Fog", "auto") } set { setStr("Fog", newValue) } }
    static var intensity: Float { get { store.object(forKey: "Intensity") != nil ? store.float(forKey: "Intensity") : 0.35 } set { store.set(newValue, forKey: "Intensity") } }
    static var showHud: Bool { get { bool("ShowHud", true) } set { store.set(newValue, forKey: "ShowHud") } }
    static var bloomScale: Float { get { store.object(forKey: "BloomScale") != nil ? store.float(forKey: "BloomScale") : 1 } set { store.set(newValue, forKey: "BloomScale") } }
    static var curvature: Float { get { store.object(forKey: "Curvature") != nil ? store.float(forKey: "Curvature") : 0.12 } set { store.set(newValue, forKey: "Curvature") } }
    static var apertureMask: Float { get { store.object(forKey: "Aperture") != nil ? store.float(forKey: "Aperture") : 0.22 } set { store.set(newValue, forKey: "Aperture") } }
    static var trails: Float { get { store.object(forKey: "Trails") != nil ? store.float(forKey: "Trails") : 0.35 } set { store.set(newValue, forKey: "Trails") } }
    static var terminalScale: Float { get { store.object(forKey: "TermScale") != nil ? store.float(forKey: "TermScale") : 1 } set { store.set(newValue, forKey: "TermScale") } }
    static var sound: Bool { get { bool("Sound", false) } set { store.set(newValue, forKey: "Sound") } }
    static var autoCycle: Bool { get { bool("AutoCycle", true) } set { store.set(newValue, forKey: "AutoCycle") } }
    static var cycleMinutes: Double { get { dbl("CycleMin", 0.5) } set { store.set(newValue, forKey: "CycleMin") } }
    static var idleMinutes: Double { get { dbl("IdleMin", 5) } set { store.set(newValue, forKey: "IdleMin") } }

    /// Build a renderer Settings + whether to auto-cycle.
    static func make() -> (settings: Settings, autoCycle: Bool) {
        var s = Settings()
        let sc = scene
        s.scene = (sc == "random" || !SceneRegistry.ids.contains(sc))
            ? (SceneRegistry.ids.randomElement() ?? "terrain") : sc
        s.presetID = preset
        s.speed = Settings.Speed(rawValue: speed) ?? .norm
        s.cityAltitude = Settings.Altitude(rawValue: cityAltitude) ?? .low
        s.fog = Settings.Fog(rawValue: fog) ?? .auto
        s.crtIntensity = min(1, max(0, intensity))
        s.showHud = showHud
        s.bloomScale = bloomScale
        s.curvature = curvature
        s.apertureMask = apertureMask
        s.trails = trails
        s.terminalScale = terminalScale
        return (s, autoCycle)
    }
}
