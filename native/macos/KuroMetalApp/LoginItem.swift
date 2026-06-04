// LoginItem — enable/disable a per-user LaunchAgent that runs this app at login.
// Two flavours: the idle-watcher `--agent` (start-at-login, honours an explicit Quit)
// and the `--wallpaper` desktop background (KeepAlive so it restarts if it dies).
// Classic launchctl approach (reliable + inspectable).

import Foundation

enum LoginItem {
    static let agentLabel = "com.kuro.screensaver.agent"
    static let wallpaperLabel = "com.kuro.screensaver.wallpaper"

    // ── generic ────────────────────────────────────────────────────────────
    static func plistURL(_ label: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    static func isEnabled(_ label: String) -> Bool {
        FileManager.default.fileExists(atPath: plistURL(label).path)
    }

    static func enable(_ label: String, args: [String], keepAlive: Bool) {
        let exe = Bundle.main.executablePath ?? CommandLine.arguments[0]
        let plist: [String: Any] = [
            "Label": label,
            "ProgramArguments": [exe] + args,
            "RunAtLoad": true,
            "KeepAlive": keepAlive,
            "ProcessType": "Interactive",
        ]
        let url = plistURL(label)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0) {
            try? data.write(to: url)
        }
        launchctl("bootout", "gui/\(getuid())/\(label)")
        launchctl("bootstrap", "gui/\(getuid())", url.path)
    }

    static func disable(_ label: String) {
        launchctl("bootout", "gui/\(getuid())/\(label)")
        try? FileManager.default.removeItem(at: plistURL(label))
    }

    // ── agent (idle watcher) — existing callers ────────────────────────────
    static var isEnabled: Bool { isEnabled(agentLabel) }
    static func enable() { enable(agentLabel, args: ["--agent"], keepAlive: false) }
    static func disable() { disable(agentLabel) }

    // ── wallpaper (desktop background) ─────────────────────────────────────
    static var wallpaperEnabled: Bool { isEnabled(wallpaperLabel) }
    static func enableWallpaper() { enable(wallpaperLabel, args: ["--wallpaper"], keepAlive: true) }
    static func disableWallpaper() { disable(wallpaperLabel) }

    private static func launchctl(_ args: String...) {
        let t = Process()
        t.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        t.arguments = args
        try? t.run(); t.waitUntilExit()
    }
}
