import ScreenSaver
import WebKit

/// The screensaver itself: a ScreenSaverView that hosts a WKWebView and loads
/// the bundled web build. The web engine animates itself, so animateOneFrame
/// is a no-op. `@objc(KuroScreensaverView)` fixes the Objective-C runtime name
/// referenced by `NSPrincipalClass` in Info.plist.
@objc(KuroScreensaverView)
final class KuroScreensaverView: ScreenSaverView {
    private var webView: WKWebView?

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 30.0
        buildWebView()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func buildWebView() {
        guard let root = Bundle(for: KuroScreensaverView.self).url(forResource: "web", withExtension: nil) else {
            return
        }

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebSchemeHandler(root: root), forURLScheme: WebSchemeHandler.scheme)
        // No user gesture exists in a screensaver — allow audio to start if the
        // user enabled it in options.
        config.mediaTypesRequiringUserActionForPlayback = []

        let wv = WKWebView(frame: bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.wantsLayer = true
        wv.layer?.backgroundColor = NSColor.black.cgColor
        addSubview(wv)
        webView = wv

        let urlString = "\(WebSchemeHandler.scheme)://local/screensaver.html\(KuroDefaults.query())"
        if let url = URL(string: urlString) {
            wv.load(URLRequest(url: url))
        }
    }

    override func draw(_ rect: NSRect) {
        NSColor.black.setFill()
        rect.fill()
    }

    override func animateOneFrame() {
        // The WebView renders on its own timeline.
    }

    override var hasConfigureSheet: Bool { true }

    override var configureSheet: NSWindow? {
        ConfigureSheetController.shared.makeWindow()
    }
}
