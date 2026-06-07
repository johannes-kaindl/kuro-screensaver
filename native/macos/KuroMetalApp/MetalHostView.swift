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
    /// Manual scene-switch hotkey (deliberate fullscreen only): +1 next, -1 previous.
    func cycleScene(by delta: Int) { renderer?.cycleScene(by: delta) }
    private let settings: Settings
    private let autoCycleSec: Double

    private let sizeLock = NSLock()
    private var pendingDrawableSize: CGSize?

    // Render-lifecycle barrier: the CVDisplayLink callback runs on the display
    // thread and dereferences `self` via an unretained pointer. runLock + isRunning
    // let stop() block until an in-flight callback returns, so the renderer/layer
    // (and self) can be torn down without a use-after-free on the display thread.
    private let runLock = NSLock()
    private var isRunning = false

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
        do {
            let r = try Renderer(device: device, settings: settings, scene: scene, targetFormat: .bgra8Unorm)
            r.autoCycleSec = autoCycleSec
            renderer = r
        } catch {
            // Don't hard-crash: leave renderer nil so start()/renderFrame() no-op
            // (black layer) and the app stays alive with a logged reason.
            NSLog("[Kuro] Renderer init failed — rendering disabled: \(error)")
            renderer = nil
        }
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
            let view = Unmanaged<MetalHostView>.fromOpaque(ctx!).takeUnretainedValue()
            // Hold runLock across the whole frame so stop() can wait it out; isRunning
            // gates a stray callback that fires after CVDisplayLinkStop.
            view.runLock.lock()
            if view.isRunning { view.renderFrame() }
            view.runLock.unlock()
            return kCVReturnSuccess
        }
        CVDisplayLinkSetOutputCallback(dl, cb, Unmanaged.passUnretained(self).toOpaque())
        runLock.lock(); isRunning = true; runLock.unlock()   // publish before the link can fire
        CVDisplayLinkStart(dl)
        displayLink = dl
    }

    func stop() {
        guard let dl = displayLink else { return }
        // Order matters: stop the link FIRST, then take runLock — never the reverse.
        // CVDisplayLinkStop can block until the current callback returns, so locking
        // before it would deadlock against a callback already waiting on runLock.
        // Taking the lock here waits out any in-flight frame (which renders harmlessly
        // against still-live objects); isRunning=false then makes any straggler that
        // acquires the lock afterwards a no-op. Once stop() returns, no callback runs
        // again, so the renderer/layer (and self) are safe to free.
        CVDisplayLinkStop(dl)
        runLock.lock(); isRunning = false; runLock.unlock()
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
