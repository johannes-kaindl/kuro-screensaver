// AppSettings — persisted config for the standalone app (UserDefaults). Shared by
// the config window and the fullscreen screensaver mode, so selection actually
// takes effect (read fresh on each activation — no host caching like the .saver).

import Foundation

enum AppSettings {
    private static let store = UserDefaults(suiteName: "com.kuro.screensaver.metalapp") ?? .standard

    static var scene: String {
        get { store.string(forKey: "Scene") ?? "random" }
        set { store.set(newValue, forKey: "Scene") }
    }
    static var preset: String {
        get { store.string(forKey: "Preset") ?? "toxic-haze" }
        set { store.set(newValue, forKey: "Preset") }
    }
    static var intensity: Float {
        get { store.object(forKey: "Intensity") != nil ? store.float(forKey: "Intensity") : 0.35 }
        set { store.set(newValue, forKey: "Intensity") }
    }
    static var autoCycleMinutes: Double {
        get { store.object(forKey: "CycleMin") != nil ? store.double(forKey: "CycleMin") : 0.3 }
        set { store.set(newValue, forKey: "CycleMin") }
    }
    /// Idle minutes before the agent auto-activates the screensaver.
    static var idleMinutes: Double {
        get { store.object(forKey: "IdleMin") != nil ? store.double(forKey: "IdleMin") : 5 }
        set { store.set(newValue, forKey: "IdleMin") }
    }

    /// Build a renderer Settings + whether to auto-cycle (scene == "random").
    static func make() -> (settings: Settings, autoCycle: Bool) {
        var s = Settings()
        let sc = scene
        let cycle = (sc == "random")
        s.scene = (sc == "random" || !SceneRegistry.ids.contains(sc))
            ? (SceneRegistry.ids.randomElement() ?? "terrain") : sc
        s.presetID = preset
        s.crtIntensity = min(1, max(0, intensity))
        return (s, cycle)
    }
}
