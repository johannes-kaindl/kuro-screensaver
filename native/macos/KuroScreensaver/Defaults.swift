import ScreenSaver

/// Shared persisted options for the screensaver, stored via ScreenSaverDefaults
/// under a single module name so the view and the configure sheet always agree.
/// The same `?scene=…&audio=…` contract is consumed by the web entry
/// (`src/screensaver/main.ts`).
enum KuroDefaults {
    static let module = "com.kuro.screensaver"

    private static func store() -> ScreenSaverDefaults {
        // Force-unwrap: ScreenSaverDefaults(forModuleWithName:) only returns nil
        // if the module name is empty, which it never is here.
        ScreenSaverDefaults(forModuleWithName: module)!
    }

    static var scene: String {
        get { store().string(forKey: "Scene") ?? "random" }
        set { let d = store(); d.set(newValue, forKey: "Scene"); d.synchronize() }
    }

    static var audio: Bool {
        get { store().bool(forKey: "Audio") }
        set { let d = store(); d.set(newValue, forKey: "Audio"); d.synchronize() }
    }

    static func query() -> String {
        let encoded = scene.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "random"
        return "?scene=\(encoded)&audio=\(audio ? "on" : "off")"
    }
}
