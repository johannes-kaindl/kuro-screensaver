// ConfigWindowController — the app's settings UI with a LIVE preview (our own
// rendered thumbnail, far better than Apple's blue legacy-saver tile). Scene /
// color / intensity selection persists and takes effect immediately — no host
// caching like the .saver.

import AppKit

final class ConfigWindowController: NSWindowController {
    private var scenePopup: NSPopUpButton!
    private var presetPopup: NSPopUpButton!
    private var intensitySlider: NSSlider!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 540),
                           styleMask: [.titled, .closable, .miniaturizable],
                           backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"
        win.center()
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
    }

    private func buildUI(_ cv: NSView) {
        previewContainer = NSView(frame: NSRect(x: 20, y: 215, width: 520, height: 293))
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6
        previewContainer.layer?.masksToBounds = true
        cv.addSubview(previewContainer)

        func label(_ s: String, _ y: CGFloat) -> NSTextField {
            let l = NSTextField(labelWithString: s); l.frame = NSRect(x: 20, y: y, width: 90, height: 20); return l
        }

        scenePopup = NSPopUpButton(frame: NSRect(x: 120, y: 168, width: 200, height: 26))
        scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids)
        scenePopup.selectItem(withTitle: AppSettings.scene)
        if scenePopup.indexOfSelectedItem < 0 { scenePopup.selectItem(at: 0) }
        scenePopup.target = self; scenePopup.action = #selector(changed)

        presetPopup = NSPopUpButton(frame: NSRect(x: 120, y: 132, width: 200, height: 26))
        presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        presetPopup.target = self; presetPopup.action = #selector(changed)

        intensitySlider = NSSlider(value: Double(AppSettings.intensity), minValue: 0, maxValue: 1,
                                   target: self, action: #selector(changed))
        intensitySlider.frame = NSRect(x: 120, y: 98, width: 200, height: 24)

        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.frame = NSRect(x: 360, y: 94, width: 170, height: 34)
        startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"

        cv.addSubview(label("Szene:", 170)); cv.addSubview(scenePopup)
        cv.addSubview(label("Farbe:", 134)); cv.addSubview(presetPopup)
        cv.addSubview(label("CRT-Glitch:", 100)); cv.addSubview(intensitySlider)
        cv.addSubview(startBtn)

        let hint = NSTextField(labelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver.")
        hint.frame = NSRect(x: 20, y: 28, width: 520, height: 34)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        cv.addSubview(hint)
    }

    @objc private func changed() {
        if let t = scenePopup.titleOfSelectedItem { AppSettings.scene = t }
        let pi = presetPopup.indexOfSelectedItem
        if pi >= 0, pi < Palette.presets.count { AppSettings.preset = Palette.presets[pi].id }
        AppSettings.intensity = Float(intensitySlider.doubleValue)
        rebuildPreview()
    }

    private func rebuildPreview() {
        previewView?.stop(); previewView?.removeFromSuperview()
        let (s, cycle) = AppSettings.make()
        let v = MetalHostView(frame: previewContainer.bounds, settings: s, autoCycle: cycle)
        v.autoresizingMask = [.width, .height]
        previewContainer.addSubview(v)
        v.start()
        previewView = v
    }

    func pausePreview() { previewView?.stop() }
    func resumePreview() { rebuildPreview() }

    @objc private func startFullscreen() {
        (NSApp.delegate as? AppDelegate)?.startScreensaver(returnToConfig: true)
    }
}
