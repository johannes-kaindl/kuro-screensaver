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

    // Resize handoff: main-thread callbacks stash the desired drawable size; the
    // display-link thread applies it right before nextDrawable(), so all
    // CAMetalLayer.drawableSize mutation + drawable acquisition happen on one
    // thread (no data race).
    private let sizeLock = NSLock()
    private var pendingDrawableSize: CGSize?

    // Tahoe legacyScreenSaver hardening (Apple FB19204084: stopAnimation is never
    // called on real stop, so instances stack and run invisibly → RAM/GPU blowup).
    // We self-stop on the willstop distributed notification.
    private var lameDuck = false

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 60.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setupMetal()
        // No Metal device / failed setup → decline so AppKit falls back gracefully.
        guard metalLayer != nil, renderer != nil else { return nil }
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(screenSaverWillStop),
            name: NSNotification.Name("com.apple.screensaver.willstop"), object: nil)
    }

    /// The host doesn't reliably call stopAnimation on Tahoe; this distributed
    /// notification fires on real stop. Stop rendering and self-exit (non-preview)
    /// so instances don't stack and leak.
    @objc private func screenSaverWillStop() {
        lameDuck = true
        stopDisplayLink()
        if !isPreview { exit(0) }
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
        let rnd = Renderer(device: device, settings: settings, scene: scene,
                           targetFormat: .bgra8Unorm)
        rnd.autoCycleSec = (KuroDefaults.scene == "random") ? 18 : 0
        renderer = rnd
        updateDrawableSize()
    }

    /// Main thread: set layer geometry and stash the desired drawable pixel size.
    /// The actual `drawableSize` write happens on the render thread (renderFrame).
    private func updateDrawableSize() {
        guard let ml = metalLayer else { return }
        let scale = window?.backingScaleFactor ?? 2.0
        ml.frame = bounds
        ml.contentsScale = scale
        let w = max(1, bounds.width * scale), h = max(1, bounds.height * scale)
        sizeLock.lock(); pendingDrawableSize = CGSize(width: w, height: h); sizeLock.unlock()
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
        lastTime = 0   // reset before the link starts; renderFrame seeds it on tick 1
        startDisplayLink()
    }

    override func stopAnimation() {
        super.stopAnimation()
        stopDisplayLink()
    }

    private func startDisplayLink() {
        guard displayLink == nil, renderer != nil, metalLayer != nil else { return }
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

    /// Called on the display-link thread. `lastTime` and the CAMetalLayer's
    /// drawableSize are only ever touched here (the resize handoff is via
    /// `pendingDrawableSize` under `sizeLock`), so there is no cross-thread race.
    private func renderFrame() {
        // CRITICAL: this runs on the CVDisplayLink thread, which has no ambient
        // autorelease pool. Without this, every frame's autoreleased Metal objects
        // (command buffers, drawables, encoders, MPS temporaries) accumulate
        // forever — a multi-GB / Mach-port leak in the long-running saver.
        autoreleasepool {
            guard !lameDuck, isAnimating else { return }   // bail on late/post-stop callbacks
            guard let ml = metalLayer, let renderer else { return }

            sizeLock.lock()
            if let ps = pendingDrawableSize { ml.drawableSize = ps; pendingDrawableSize = nil }
            sizeLock.unlock()

            let now = CACurrentMediaTime()
            if lastTime == 0 { lastTime = now }
            let dt = min(0.05, max(0, now - lastTime))
            lastTime = now
            renderer.advance(dt: dt)
            guard let drawable = ml.nextDrawable() else { return }
            renderer.draw(into: drawable.texture)
            drawable.present()
        }
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

    deinit {
        DistributedNotificationCenter.default().removeObserver(self)
        stopDisplayLink()
    }
}
