import Cocoa
import WebKit

/// A borderless NSWindow returns canBecomeKey == false by default, so it never
/// receives keyboard events — which means Esc/Cmd-Q silently do nothing and the
/// fullscreen window traps the user. Overriding these fixes that.
final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// WKWebView for the viewer. Interactive: clicks reach the web HUD; Esc quits.
final class ExitWebView: WKWebView {
    var onExit: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {        // Esc
            onExit?()
        } else {
            super.keyDown(with: event)  // everything else → web content
        }
    }
}

/// Fullscreen host for the web screensaver engine, in a normal app process so
/// WebGL composites. Multiple independent exit paths (Esc via responder, Esc /
/// Cmd-Q via a local event monitor, and a Cmd-Q menu item) so the fullscreen
/// window can never trap the user.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webView: ExitWebView?
    private var keyMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()

        let screen = NSScreen.main ?? NSScreen.screens.first
        let frame = screen?.frame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)

        let config = WKWebViewConfiguration()
        if let root = Bundle.main.url(forResource: "web", withExtension: nil) {
            config.setURLSchemeHandler(WebSchemeHandler(root: root), forURLScheme: WebSchemeHandler.scheme)
        }
        // No user gesture exists at launch — allow audio to start if enabled.
        config.mediaTypesRequiringUserActionForPlayback = []

        let wv = ExitWebView(frame: frame, configuration: config)
        wv.onExit = { NSApplication.shared.terminate(nil) }
        wv.wantsLayer = true
        wv.layer?.backgroundColor = NSColor.black.cgColor
        webView = wv

        let win = KeyableWindow(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        win.contentView = wv
        win.level = .screenSaver           // float above the menu bar / dock
        win.isOpaque = true
        win.backgroundColor = .black
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        win.makeKeyAndOrderFront(nil)
        win.makeFirstResponder(wv)
        window = win

        NSApp.presentationOptions = [.hideDock, .hideMenuBar]
        NSApp.activate(ignoringOtherApps: true)

        // Safety net: intercept Esc / Cmd-Q before the responder chain, so the
        // app always quits regardless of focus state.
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 {                                  // Esc
                NSApplication.shared.terminate(nil)
                return nil
            }
            if event.modifierFlags.contains(.command),
               event.charactersIgnoringModifiers?.lowercased() == "q" {  // Cmd-Q
                NSApplication.shared.terminate(nil)
                return nil
            }
            return event
        }

        // Cursor is managed by the web engine (CSS cursor: none at rest, shown
        // on mouse-move) — don't force-hide it natively, or the user can't aim
        // at the on-screen controls.

        let urlString = "\(WebSchemeHandler.scheme)://local/screensaver.html?scene=random&audio=off"
        if let url = URL(string: urlString) {
            wv.load(URLRequest(url: url))
        }
    }

    /// Minimal main menu so the standard Cmd-Q quit works (the menu bar is
    /// hidden, but the keyboard shortcut still fires).
    private func installMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "Quit Kuro Screensaver",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
