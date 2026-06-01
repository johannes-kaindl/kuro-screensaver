import ScreenSaver

/// Persisted options for the native Metal screensaver, stored via
/// ScreenSaverDefaults under a dedicated module name (distinct from the WebView
/// and video savers). Loads into the renderer's `Settings`.
enum KuroDefaults {
    static let module = "com.kuro.screensaver.native"

    private static func store() -> ScreenSaverDefaults {
        ScreenSaverDefaults(forModuleWithName: module)!
    }

    static func registerDefaults() {
        store().register(defaults: [
            "Scene": "terrain",
            "ColorPreset": "toxic-haze",
            "CrtIntensity": 0.35,
        ])
    }

    static var scene: String {
        get { store().string(forKey: "Scene") ?? "terrain" }
        set { let d = store(); d.set(newValue, forKey: "Scene"); d.synchronize() }
    }

    static var colorPreset: String {
        get { store().string(forKey: "ColorPreset") ?? "toxic-haze" }
        set { let d = store(); d.set(newValue, forKey: "ColorPreset"); d.synchronize() }
    }

    static var crtIntensity: Float {
        get { Float(store().double(forKey: "CrtIntensity")) }
        set { let d = store(); d.set(Double(newValue), forKey: "CrtIntensity"); d.synchronize() }
    }

    /// Build the renderer Settings from persisted values.
    static func settings() -> Settings {
        registerDefaults()
        var s = Settings()
        // Slice ships only terrain; "random" collapses to it for now.
        s.scene = (scene == "random") ? "terrain" : scene
        s.presetID = colorPreset
        // registerDefaults() supplies 0.35 when unset, so honor an explicit 0
        // (slider "off") instead of coercing it back to the default.
        s.crtIntensity = min(1, max(0, crtIntensity))
        return s
    }
}
