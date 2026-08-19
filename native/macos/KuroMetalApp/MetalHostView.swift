// MetalHostView — an NSView that hosts the shared Core renderer in a CAMetalLayer,
// driven by a CADisplayLink (NSView.displayLink(target:selector:), macOS 14+).
// The system paces callbacks to preferredFrameRateRange (no manual vsync skipping,
// ProMotion can down-clock), and everything — start/stop/render — runs on the main
// thread, so the old display-thread teardown barrier is gone entirely.
//
// Invariant: hosts call stop() before dropping the view (CADisplayLink retains its
// target); viewDidMoveToWindow(nil) is the safety net.

import AppKit
import Metal
import QuartzCore

final class MetalHostView: NSView {
    private let device = MTLCreateSystemDefaultDevice()
    private var metalLayer: CAMetalLayer?
    private var renderer: Renderer?
    private var link: CADisplayLink?
    private var lastTime: CFTimeInterval = 0
    // Fallback cap for displays that don't honour the range hint exactly
    // (fixed-rate external panels): skip callbacks that arrive early. dt stays
    // correct (measured from the last *rendered* frame).
    private var minFrameInterval: CFTimeInterval = 1.0 / 61.0
    private var frameRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    private var paused = false
    private var renderScale: CGFloat = 1

    private let settings: Settings
    private let autoCycleSec: Double

    /// Wallpaper power policy: target frame rate (e.g. 30 on AC, 10 on battery).
    func setFrameCap(_ fps: Double) {
        let f = Float(max(1, fps))
        frameRange = CAFrameRateRange(minimum: max(1, f / 3), maximum: f, preferred: f)
        minFrameInterval = 1.0 / (Double(f) + 1)
        link?.preferredFrameRateRange = frameRange
    }
    /// Power policy: pause the display link entirely (0 wakeups). The last
    /// rendered frame stays on the layer (= the "frozen" still).
    func setPaused(_ p: Bool) { paused = p; link?.isPaused = p }
    /// Wallpaper: render at a fraction of the backing size; the CAMetalLayer
    /// upscales to the window. The CRT look hides it, cost drops quadratically.
    /// Fullscreen/preview never call this (stay at 1).
    func setRenderScale(_ s: CGFloat) {
        renderScale = min(1, max(0.25, s))
        updateDrawableSize()
    }
    /// Manual scene-switch hotkey (deliberate fullscreen only): +1 next, -1 previous.
    func cycleScene(by delta: Int) { renderer?.cycleScene(by: delta) }

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
        ml.drawableSize = CGSize(width: max(1, bounds.width * scale * renderScale),
                                 height: max(1, bounds.height * scale * renderScale))
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { stop() } else { updateDrawableSize() }
    }
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateDrawableSize()
    }

    func start() {
        guard link == nil, renderer != nil, metalLayer != nil else { return }
        lastTime = 0
        let l = displayLink(target: self, selector: #selector(tick))
        l.preferredFrameRateRange = frameRange
        l.isPaused = paused
        l.add(to: .main, forMode: .common)
        link = l
    }

    func stop() {
        link?.invalidate()   // removes it from the run loop + drops its target ref
        link = nil
    }

    /// Render exactly ONE frame, even while paused. Called once right after the
    /// view is installed, so a wallpaper that the power policy freezes still shows
    /// an image. Without it a frozen-before-first-frame window stays opaque black
    /// and swallows the user's desktop picture — "frozen" is meant to hold the last
    /// frame, and that only works if a last frame exists.
    func renderPrimingFrame() {
        // Fast-forward past the CRT power-on animation first: at t=0 the scene is a
        // single horizontal scan line, which is a poor thing to freeze on. Step in
        // tick-sized slices so the simulation stays in its normal dt range.
        // No waitFrameSlot() needed around these: this runs before the very first
        // draw, so no frame can be in flight yet. `lastTime` stays 0 — renderFrame()
        // seeds it itself, and setting it here would make the frame-rate limiter
        // discard this very frame.
        if let renderer {
            for _ in 0..<primingSteps { renderer.advance(dt: primingStep) }
        }
        renderFrame()
    }

    private let primingStep: Double = 0.05      // == tick's dt clamp
    private let primingSteps = 40               // ≈ 2 s of scene time

    @objc private func tick() {
        guard !paused else { return }
        renderFrame()
    }

    private func renderFrame() {
        guard let ml = metalLayer, let renderer else { return }
        let now = CACurrentMediaTime()
        if lastTime != 0, now - lastTime < minFrameInterval { return }
        // Acquire the frame slot BEFORE advance(): scenes write shared vertex
        // buffers there, which must never overlap a frame still on the GPU.
        renderer.waitFrameSlot()
        if lastTime == 0 { lastTime = now }
        let dt = min(0.05, max(0, now - lastTime))
        lastTime = now
        renderer.advance(dt: dt)
        guard let drawable = ml.nextDrawable() else {
            renderer.releaseFrameSlot()   // no draw → release manually
            return
        }
        renderer.draw(into: drawable.texture)
        drawable.present()
    }
}
