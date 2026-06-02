// KuroMetalApp — standalone fullscreen Metal screensaver app. The robust path on
// macOS 26: a borderless window per display at screen-saver window level hosting
// the shared Core renderer, dismissed on input. Avoids the buggy legacyScreenSaver
// host entirely (normal app lifecycle, no instance stacking, no PluginKit/picker).
//
// Args: [--scene terrain|city|rift|tunnel|void|random] [--preset <id>]
//       [--intensity 0..1] [--no-cycle]
// Default: random scene + 18s auto-cycle through all scenes.

import AppKit
import Metal

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windows: [NSWindow] = []
    private var views: [MetalHostView] = []
    private var monitors: [Any] = []
    private var startTime = CACurrentMediaTime()

    private let settings: Settings
    private let autoCycle: Bool

    init(settings: Settings, autoCycle: Bool) {
        self.settings = settings
        self.autoCycle = autoCycle
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        for screen in NSScreen.screens {
            let win = NSWindow(contentRect: screen.frame, styleMask: [.borderless],
                               backing: .buffered, defer: false, screen: screen)
            win.level = NSWindow.Level(Int(CGShieldingWindowLevel()))
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.backgroundColor = .black
            win.isOpaque = true
            win.hasShadow = false
            let view = MetalHostView(frame: NSRect(origin: .zero, size: screen.frame.size),
                                     settings: settings, autoCycle: autoCycle)
            view.autoresizingMask = [.width, .height]
            win.contentView = view
            win.makeKeyAndOrderFront(nil)
            view.start()
            windows.append(win); views.append(view)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.hide()
        startTime = CACurrentMediaTime()
        installInputMonitors()
    }

    private func installInputMonitors() {
        let down: (NSEvent) -> Void = { [weak self] _ in self?.quit() }
        let moved: (NSEvent) -> Void = { [weak self] _ in
            guard let self else { return }
            if CACurrentMediaTime() - self.startTime > 1.2 { self.quit() }  // grace vs launch cursor
        }
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]) { e in down(e); return nil } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { e in moved(e); return e } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .mouseMoved]) { e in
            if e.type == .mouseMoved { moved(e) } else { down(e) }
        } as Any)
    }

    private var quitting = false
    func quit() {
        guard !quitting else { return }
        quitting = true
        views.forEach { $0.stop() }
        NSCursor.unhide()
        NSApp.terminate(nil)
    }
}

// ---- arg parsing ----
func parseSettings() -> (Settings, Bool) {
    var s = Settings()
    var sceneArg = "random"
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let k = it.next() {
        switch k {
        case "--scene": sceneArg = it.next() ?? sceneArg
        case "--preset": s.presetID = it.next() ?? s.presetID
        case "--intensity": s.crtIntensity = Float(it.next() ?? "") ?? s.crtIntensity
        case "--no-cycle": sceneArg = sceneArg == "random" ? "terrain" : sceneArg
        default: break
        }
    }
    let cycle = (sceneArg == "random")
    s.scene = (sceneArg == "random" || !SceneRegistry.ids.contains(sceneArg))
        ? (SceneRegistry.ids.randomElement() ?? "terrain") : sceneArg
    return (s, cycle)
}

let (settings, cycle) = parseSettings()
let app = NSApplication.shared
let delegate = AppDelegate(settings: settings, autoCycle: cycle)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
