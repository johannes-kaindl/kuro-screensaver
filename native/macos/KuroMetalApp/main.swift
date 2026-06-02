// KuroMetalApp — standalone Metal screensaver app. The robust macOS-26 path:
// borderless windows per display at screen-saver level hosting the shared Core
// renderer, dismissed on input. No legacyScreenSaver host → no instance stacking,
// no missing stopAnimation, real live preview, working selection.
//
//   (no args)     → config window (settings + live preview)
//   --agent       → background idle watcher (menu-bar); auto-activates on idle
//   --screensaver → fullscreen now from saved settings; any input quits
//   --scene/--preset/--intensity → fullscreen override (testing)

import AppKit
import Metal

final class AppDelegate: NSObject, NSApplicationDelegate {
    enum Mode { case config, agent, oneShot }
    private let mode: Mode
    private let override: (settings: Settings, autoCycle: Bool)?

    private var config: ConfigWindowController?
    private var statusItem: NSStatusItem?
    private var idleTimer: Timer?
    private var saverWindows: [NSWindow] = []
    private var saverViews: [MetalHostView] = []
    private var monitors: [Any] = []
    private var startTime = CACurrentMediaTime()
    private var active = false
    private var synth: Synth?

    init(mode: Mode, override: (Settings, Bool)?) {
        self.mode = mode
        self.override = override
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        switch mode {
        case .oneShot:
            startScreensaver()
        case .config:
            let c = ConfigWindowController(); config = c
            c.showWindow(nil); NSApp.activate(ignoringOtherApps: true)
        case .agent:
            setupStatusItem()
            idleTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tickIdle() }
        }
    }

    // MARK: - agent idle watching

    private func setupStatusItem() {
        let item = NSStatusItem.local()
        item.button?.title = "▦"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Jetzt starten", action: #selector(menuStart), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Einstellungen…", action: #selector(menuConfig), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Kuro Screensaver beenden", action: #selector(menuQuit), keyEquivalent: ""))
        menu.items.forEach { $0.target = self }
        item.menu = menu
        statusItem = item
    }

    private func tickIdle() {
        guard !active else { return }
        if systemIdleSeconds() >= AppSettings.idleMinutes * 60 { startScreensaver() }
    }

    @objc private func menuStart() { startScreensaver() }
    @objc private func menuConfig() { showConfig() }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    private func showConfig() {
        if config == nil { config = ConfigWindowController() }
        NSApp.setActivationPolicy(.regular)   // give the agent a normal window/dock while config is open
        config?.showWindow(nil)
        config?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Re-opening the app (Dock click / `open`) while an instance is already
    /// running (e.g. the idle agent) → show the config window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !active { showConfig() }
        return true
    }

    // MARK: - fullscreen show / dismiss

    func startScreensaver(returnToConfig: Bool = false) {
        guard !active else { return }
        active = true
        if returnToConfig { config?.pausePreview(); config?.window?.orderOut(nil) }

        let (s, cycle) = override ?? AppSettings.make()
        for screen in NSScreen.screens {
            let win = NSWindow(contentRect: screen.frame, styleMask: [.borderless],
                               backing: .buffered, defer: false, screen: screen)
            win.level = NSWindow.Level(Int(CGShieldingWindowLevel()))
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            win.backgroundColor = .black; win.isOpaque = true; win.hasShadow = false
            win.setFrame(screen.frame, display: true)   // exact per-screen placement
            let view = MetalHostView(frame: NSRect(origin: .zero, size: screen.frame.size),
                                     settings: s, autoCycle: cycle)
            view.autoresizingMask = [.width, .height]
            win.contentView = view
            win.orderFrontRegardless()                   // shows on non-main screens too
            view.start()
            saverWindows.append(win); saverViews.append(view)
        }
        NSApp.activate(ignoringOtherApps: true)
        NSCursor.hide()
        if AppSettings.sound { let sy = Synth(); sy.start(); synth = sy }
        startTime = CACurrentMediaTime()
        installInputMonitors()
        if returnToConfig { dismissTarget = .config }
        else if mode == .oneShot { dismissTarget = .terminate }
        else { dismissTarget = .resume }
    }

    private enum DismissTarget { case config, resume, terminate }
    private var dismissTarget: DismissTarget = .resume

    private func dismissScreensaver() {
        guard active else { return }
        active = false
        monitors.forEach { NSEvent.removeMonitor($0) }; monitors.removeAll()
        saverViews.forEach { $0.stop() }; saverViews.removeAll()
        saverWindows.forEach { $0.orderOut(nil) }; saverWindows.removeAll()
        synth?.stop(); synth = nil
        NSCursor.unhide()
        switch dismissTarget {
        case .terminate: NSApp.terminate(nil)
        case .config:
            config?.resumePreview()
            config?.window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        case .resume:
            break   // agent keeps watching; idle has reset due to the input
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

private extension NSStatusItem {
    static func local() -> NSStatusItem { NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength) }
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
let mode: AppDelegate.Mode =
    CommandLine.arguments.contains("--agent") ? .agent :
    (CommandLine.arguments.contains("--screensaver") || override != nil) ? .oneShot : .config
let app = NSApplication.shared
let delegate = AppDelegate(mode: mode, override: override)
app.delegate = delegate
app.setActivationPolicy(mode == .config ? .regular : .accessory)
app.run()
