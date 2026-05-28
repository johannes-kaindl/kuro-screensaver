import Cocoa
import WebKit

/// WKWebView for the viewer. It's an interactive fullscreen app (not a passive
/// screen saver), so clicks reach the web HUD (scene tabs, FX toggles) and only
/// Esc quits. The engine manages the cursor itself (hidden at rest, shown on
/// mouse-move, re-hidden after idle), so we don't force-hide it natively.
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

/// Fullscreen host for the web screensaver engine. Runs in a normal app
/// process, so WebGL composites correctly (unlike the .saver in the sandboxed
/// legacyScreenSaver process). Reuses WebSchemeHandler + the bundled web/.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webView: ExitWebView?

    func applicationDidFinishLaunching(_ notification: Notification) {
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

        let win = NSWindow(
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
        // Cursor is managed by the web engine (CSS cursor: none at rest, shown
        // on mouse-move) — don't force-hide it natively, or the user can't aim
        // at the on-screen controls.

        // Scene/audio could later come from CLI args or a menu; v1 is random
        // scene, audio off (same contract as the web entry).
        let urlString = "\(WebSchemeHandler.scheme)://local/screensaver.html?scene=random&audio=off"
        if let url = URL(string: urlString) {
            wv.load(URLRequest(url: url))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
