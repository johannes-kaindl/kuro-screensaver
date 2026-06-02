// KuroMetalApp — standalone fullscreen Metal screensaver app. The robust macOS-26
// path: borderless windows per display at screen-saver window level hosting the
// shared Core renderer, dismissed on input. No legacyScreenSaver host → no
// instance stacking, no missing stopAnimation, no picker/notarization needed,
// and a real live preview in the config window (not Apple's blue tile).
//
//   (no args)       → config window (settings + live preview)
//   --screensaver   → fullscreen now, using saved settings; any input quits
//   --scene/--preset/--intensity → fullscreen override (testing)

import AppKit
import Metal

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let screensaverMode: Bool
    private let override: (settings: Settings, autoCycle: Bool)?

    private var config: ConfigWindowController?
    private var saverWindows: [NSWindow] = []
    private var saverViews: [MetalHostView] = []
    private var monitors: [Any] = []
    private var startTime = CACurrentMediaTime()
    private var returnToConfig = false
    private var active = false

    init(screensaverMode: Bool, override: (Settings, Bool)?) {
        self.screensaverMode = screensaverMode
        self.override = override
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        if screensaverMode {
            startScreensaver(returnToConfig: false)
        } else {
            let c = ConfigWindowController()
            config = c
            c.showWindow(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func startScreensaver(returnToConfig: Bool) {
        guard !active else { return }
        active = true
        self.returnToConfig = returnToConfig
        config?.pausePreview()
        config?.window?.orderOut(nil)

        let (s, cycle) = override ?? AppSettings.make()
        for screen in NSScreen.screens {
            let win = NSWindow(contentRect: screen.frame, styleMask: [.borderless],
                               backing: .buffered, defer: false, screen: screen)
            win.level = NSWindow.Level(Int(CGShieldingWindowLevel()))
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.backgroundColor = .black; win.isOpaque = true; win.hasShadow = false
            let view = MetalHostView(frame: NSRect(origin: .zero, size: screen.frame.size),
                                     settings: s, autoCycle: cycle)
            view.autoresizingMask = [.width, .height]
            win.contentView = view
            win.makeKeyAndOrderFront(nil)
            view.start()
            saverWindows.append(win); saverViews.append(view)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.hide()
        startTime = CACurrentMediaTime()
        installInputMonitors()
    }

    private func dismissScreensaver() {
        guard active else { return }
        active = false
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
        saverViews.forEach { $0.stop() }
        saverViews.removeAll()
        saverWindows.forEach { $0.orderOut(nil) }
        saverWindows.removeAll()
        NSCursor.unhide()
        if returnToConfig {
            config?.resumePreview()
            config?.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        } else {
            NSApp.terminate(nil)
        }
    }

    private func installInputMonitors() {
        let down: (NSEvent) -> Void = { [weak self] _ in self?.dismissScreensaver() }
        let moved: (NSEvent) -> Void = { [weak self] _ in
            guard let self, CACurrentMediaTime() - self.startTime > 1.2 else { return }
            self.dismissScreensaver()
        }
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]) { e in down(e); return nil } as Any)
        monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { e in moved(e); return e } as Any)
        monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .mouseMoved]) { e in
            if e.type == .mouseMoved { moved(e) } else { down(e) }
        } as Any)
    }
}

// ---- arg parsing ----
func parseOverride() -> (Settings, Bool)? {
    let args = CommandLine.arguments
    guard args.contains("--scene") || args.contains("--preset") || args.contains("--intensity") else { return nil }
    var s = Settings(); var sceneArg = "random"
    var it = args.dropFirst().makeIterator()
    while let k = it.next() {
        switch k {
        case "--scene": sceneArg = it.next() ?? sceneArg
        case "--preset": s.presetID = it.next() ?? s.presetID
        case "--intensity": s.crtIntensity = Float(it.next() ?? "") ?? s.crtIntensity
        default: break
        }
    }
    let cycle = (sceneArg == "random")
    s.scene = (sceneArg == "random" || !SceneRegistry.ids.contains(sceneArg))
        ? (SceneRegistry.ids.randomElement() ?? "terrain") : sceneArg
    return (s, cycle)
}

let override = parseOverride()
let screensaver = CommandLine.arguments.contains("--screensaver") || override != nil
let app = NSApplication.shared
let delegate = AppDelegate(screensaverMode: screensaver, override: override)
app.delegate = delegate
app.setActivationPolicy(screensaver ? .accessory : .regular)
app.run()
