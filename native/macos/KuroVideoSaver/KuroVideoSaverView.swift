import ScreenSaver
import AVFoundation

/// A video screensaver: plays a bundled, pre-rendered loop of the Kuro engine
/// via AVPlayerLayer. Unlike the WebGL `.saver` (which can't composite in the
/// sandboxed legacyScreenSaver process), AVFoundation video plays fine there —
/// this is the shipping path for a real macOS `.saver`.
///
/// Each preset ships as its own `.saver` bundle with a different `loop.mov`
/// (see scripts/build-video-savers.sh), so there is no configure sheet — the
/// user picks the look by choosing the screensaver in System Settings.
///
/// `@objc(KuroVideoSaverView)` fixes the Objective-C runtime name referenced by
/// `NSPrincipalClass` in Info.plist.
///
/// IMPORTANT: scripts/build-video-savers.sh renames this class **per preset**
/// (`KuroVideoSaver_<key>`) before each build. The Obj-C runtime registers a
/// class name only once per process, so if all 13 `.saver` shipped the same
/// class, `Bundle(for:)` would resolve to whichever bundle loaded first and
/// every preset would play that one's video. The per-preset rename is what keeps
/// each `.saver` loading its own `loop.mov`. This file keeps the generic name so
/// it builds/parses standalone.
@objc(KuroVideoSaverView)
final class KuroVideoSaverView: ScreenSaverView {
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?     // seamless gapless looping
    private var playerLayer: AVPlayerLayer?

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        animationTimeInterval = 1.0 / 30.0
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setupPlayer()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func setupPlayer() {
        guard let url = Bundle(for: KuroVideoSaverView.self).url(forResource: "loop", withExtension: "mov") else {
            return
        }
        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer()
        queue.isMuted = true                 // rendered clips have no audio anyway
        let loop = AVPlayerLooper(player: queue, templateItem: item)

        let pl = AVPlayerLayer(player: queue)
        pl.frame = bounds
        // The loop's letterbox is black and the content background is black, so
        // resizeAspect keeps the HUD corners on-screen with invisible bars.
        pl.videoGravity = .resizeAspect
        layer?.addSublayer(pl)

        player = queue
        looper = loop
        playerLayer = pl
        queue.play()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        playerLayer?.frame = NSRect(origin: .zero, size: newSize)
    }

    override func startAnimation() {
        super.startAnimation()
        player?.play()
    }

    override func stopAnimation() {
        super.stopAnimation()
        player?.pause()
    }

    override func draw(_ rect: NSRect) {
        NSColor.black.setFill()
        rect.fill()
    }

    override func animateOneFrame() {
        // AVPlayer renders on its own timeline.
    }

    override var hasConfigureSheet: Bool { false }
    override var configureSheet: NSWindow? { nil }
}
