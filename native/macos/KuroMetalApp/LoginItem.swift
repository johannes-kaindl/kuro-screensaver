// LoginItem — enable/disable the idle-watcher agent at login via a per-user
// LaunchAgent that runs this app with --agent. Classic launchctl approach
// (reliable + inspectable); the agent restarts on login and is KeepAlive.

import Foundation

enum LoginItem {
    static let label = "com.kuro.screensaver.agent"

    static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    static var isEnabled: Bool { FileManager.default.fileExists(atPath: plistURL.path) }

    static func enable() {
        let exe = Bundle.main.executablePath ?? CommandLine.arguments[0]
        let plist: [String: Any] = [
            "Label": label,
            "ProgramArguments": [exe, "--agent"],
            "RunAtLoad": true,
            "KeepAlive": false,   // start at login only; honor an explicit Quit
            "ProcessType": "Interactive",
        ]
        try? FileManager.default.createDirectory(
            at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0) {
            try? data.write(to: plistURL)
        }
        // (re)load it now
        launchctl("bootout", "gui/\(getuid())/\(label)")
        launchctl("bootstrap", "gui/\(getuid())", plistURL.path)
    }

    static func disable() {
        launchctl("bootout", "gui/\(getuid())/\(label)")
        try? FileManager.default.removeItem(at: plistURL)
    }

    private static func launchctl(_ args: String...) {
        let t = Process()
        t.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        t.arguments = args
        try? t.run(); t.waitUntilExit()
    }
}
