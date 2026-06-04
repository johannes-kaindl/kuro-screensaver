// MetalHostView — an NSView that hosts the shared Core renderer in a CAMetalLayer
// driven by a CVDisplayLink. Used by the standalone fullscreen app (the robust
// path on macOS 26, which avoids the buggy legacyScreenSaver host entirely).
// Same render loop as the .saver view, including the critical autoreleasepool.

import AppKit
import Metal
import QuartzCore

final class MetalHostView: NSView {
    private let device = MTLCreateSystemDefaultDevice()
    private var metalLayer: CAMetalLayer?
    private var renderer: Renderer?
    private var displayLink: CVDisplayLink?
    private var lastTime: CFTimeInterval = 0
    private var minFrameInterval: CFTimeInterval = 1.0 / 61.0   // ~60fps cap (battery/thermals on 120Hz displays)
    private var paused = false                                  // wallpaper power policy (battery)

    /// Wallpaper power policy: cap the frame rate (e.g. 30 on AC, 10 on battery).
    func setFrameCap(_ fps: Double) { minFrameInterval = 1.0 / max(1, fps) }
    /// Wallpaper power policy: freeze rendering (CVDisplayLink keeps running, frames skipped).
    func setPaused(_ p: Bool) { paused = p }
    private let settings: Settings
    private let autoCycleSec: Double

    private let sizeLock = NSLock()
    private var pendingDrawableSize: CGSize?

    init(frame: NSRect, settings: Settings, autoCycleSec: Double) {
        self.settings = settings
        self.autoCycleSec = autoCycleSec
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setupMetal()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    private func setupMetal() {
        guard let device else { return }
        let ml = CAMetalLayer()
        ml.device = device
        ml.pixelFormat = .bgra8Unorm
        ml.isOpaque = true
        ml.frame = bounds
        layer?.addSublayer(ml)
        metalLayer = ml

        let ctx = SceneContext(device: device, rng: LCG(seed: settings.seed ?? freshSeed()),
                               settings: settings, accent: settings.preset.accentRGB)
        let scene = SceneRegistry.make(settings.scene, ctx: ctx)
        let r = Renderer(device: device, settings: settings, scene: scene, targetFormat: .bgra8Unorm)
        r.autoCycleSec = autoCycleSec
        renderer = r
        updateDrawableSize()
    }

    private func updateDrawableSize() {
        guard let ml = metalLayer else { return }
        let scale = window?.backingScaleFactor ?? 2.0
        ml.frame = bounds
        ml.contentsScale = scale
        let w = max(1, bounds.width * scale), h = max(1, bounds.height * scale)
        sizeLock.lock(); pendingDrawableSize = CGSize(width: w, height: h); sizeLock.unlock()
    }

    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); updateDrawableSize() }
    override func setFrameSize(_ newSize: NSSize) { super.setFrameSize(newSize); updateDrawableSize() }

    func start() {
        guard displayLink == nil, renderer != nil, metalLayer != nil else { return }
        lastTime = 0
        var dl: CVDisplayLink?
        CVDisplayLinkCreateWithActiveCGDisplays(&dl)
        guard let dl else { return }
        let cb: CVDisplayLinkOutputCallback = { (_, _, _, _, _, ctx) -> CVReturn in
            Unmanaged<MetalHostView>.fromOpaque(ctx!).takeUnretainedValue().renderFrame()
            return kCVReturnSuccess
        }
        CVDisplayLinkSetOutputCallback(dl, cb, Unmanaged.passUnretained(self).toOpaque())
        CVDisplayLinkStart(dl)
        displayLink = dl
    }

    func stop() {
        if let dl = displayLink { CVDisplayLinkStop(dl) }
        displayLink = nil
    }

    private func renderFrame() {
        autoreleasepool {   // CVDisplayLink thread has no ambient pool — required
            guard !paused, let ml = metalLayer, let renderer else { return }
            let now = CACurrentMediaTime()
            // 60fps cap: on a 120Hz display the link fires twice per target frame;
            // skip the in-between callbacks. dt stays correct (measured from the
            // last *rendered* frame, so skipped time accumulates).
            if lastTime != 0, now - lastTime < minFrameInterval { return }
            sizeLock.lock()
            if let ps = pendingDrawableSize { ml.drawableSize = ps; pendingDrawableSize = nil }
            sizeLock.unlock()
            if lastTime == 0 { lastTime = now }
            let dt = min(0.05, max(0, now - lastTime))
            lastTime = now
            renderer.advance(dt: dt)
            guard let drawable = ml.nextDrawable() else { return }
            renderer.draw(into: drawable.texture)
            drawable.present()
        }
    }

    deinit { stop() }
}
