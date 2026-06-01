import ScreenSaver
import Metal
import QuartzCore

/// The native Metal screensaver: a ScreenSaverView hosting a CAMetalLayer driven
/// by a CVDisplayLink. Unlike the WebGL `.saver` (which does not composite in the
/// sandboxed legacyScreenSaver process), a native Metal layer is expected to
/// composite there — that is the gate this bundle exists to prove on-device.
///
/// `@objc(KuroNativeSaverView)` fixes the Objective-C runtime name referenced by
/// `NSPrincipalClass` in Info.plist (unique per bundle → no class collision).
@objc(KuroNativeSaverView)
final class KuroNativeSaverView: ScreenSaverView {
    private let device = MTLCreateSystemDefaultDevice()
    private var metalLayer: CAMetalLayer?
    private var renderer: Renderer?
    private var displayLink: CVDisplayLink?
    private var lastTime: CFTimeInterval = 0

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 60.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setupMetal()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func setupMetal() {
        guard let device else { return }
        let ml = CAMetalLayer()
        ml.device = device
        ml.pixelFormat = .bgra8Unorm
        ml.isOpaque = true
        ml.frame = bounds
        layer?.addSublayer(ml)
        metalLayer = ml

        let settings = KuroDefaults.settings()
        let ctx = SceneContext(device: device,
                               rng: LCG(seed: settings.seed ?? freshSeed()),
                               settings: settings, accent: settings.preset.accentRGB)
        let scene: Scene = TerrainScene(ctx: ctx)
        renderer = Renderer(device: device, settings: settings, scene: scene,
                            targetFormat: .bgra8Unorm)
        updateDrawableSize()
    }

    private func updateDrawableSize() {
        guard let ml = metalLayer else { return }
        let scale = window?.backingScaleFactor ?? 2.0
        ml.frame = bounds
        ml.contentsScale = scale
        let w = max(1, bounds.width * scale), h = max(1, bounds.height * scale)
        ml.drawableSize = CGSize(width: w, height: h)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateDrawableSize()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateDrawableSize()
    }

    // MARK: - lifecycle (CVDisplayLink gated by start/stopAnimation)

    override func startAnimation() {
        super.startAnimation()
        lastTime = CACurrentMediaTime()
        startDisplayLink()
    }

    override func stopAnimation() {
        super.stopAnimation()
        stopDisplayLink()
    }

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        var dl: CVDisplayLink?
        CVDisplayLinkCreateWithActiveCGDisplays(&dl)
        guard let dl else { return }
        let callback: CVDisplayLinkOutputCallback = { (_, _, _, _, _, ctx) -> CVReturn in
            let view = Unmanaged<KuroNativeSaverView>.fromOpaque(ctx!).takeUnretainedValue()
            view.renderFrame()
            return kCVReturnSuccess
        }
        CVDisplayLinkSetOutputCallback(dl, callback, Unmanaged.passUnretained(self).toOpaque())
        CVDisplayLinkStart(dl)
        displayLink = dl
    }

    private func stopDisplayLink() {
        if let dl = displayLink { CVDisplayLinkStop(dl) }
        displayLink = nil
    }

    /// Called on the display-link thread. Touches only Metal objects (no NSView
    /// state), so it is safe off the main thread.
    private func renderFrame() {
        guard let ml = metalLayer, let renderer else { return }
        let now = CACurrentMediaTime()
        let dt = min(0.05, max(0, now - lastTime))
        lastTime = now
        renderer.advance(dt: dt)
        guard let drawable = ml.nextDrawable() else { return }
        renderer.draw(into: drawable.texture)
        drawable.present()
    }

    override func draw(_ rect: NSRect) {
        NSColor.black.setFill()
        rect.fill()
    }

    override func animateOneFrame() {
        // Frames are driven by the CVDisplayLink, not the ScreenSaver timer.
    }

    override var hasConfigureSheet: Bool { true }
    override var configureSheet: NSWindow? { ConfigureSheetController.shared.makeWindow() }

    deinit { stopDisplayLink() }
}
