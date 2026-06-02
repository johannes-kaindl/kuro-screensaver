// ConfigWindowController — the app's settings UI with a LIVE preview (our own
// rendered thumbnail, far better than Apple's blue legacy-saver tile). Scene /
// color / intensity / idle-time selection persists and takes effect immediately.

import AppKit

final class ConfigWindowController: NSWindowController {
    private var scenePopup: NSPopUpButton!
    private var presetPopup: NSPopUpButton!
    private var intensitySlider: NSSlider!
    private var idlePopup: NSPopUpButton!
    private var autostartCheck: NSButton!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?

    private let idleChoices: [Double] = [1, 2, 5, 10, 15]

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 600),
                           styleMask: [.titled, .closable, .miniaturizable],
                           backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"
        win.center()
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
    }

    private func buildUI(_ cv: NSView) {
        previewContainer = NSView(frame: NSRect(x: 20, y: 275, width: 520, height: 293))
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6
        previewContainer.layer?.masksToBounds = true
        cv.addSubview(previewContainer)

        func label(_ s: String, _ y: CGFloat) -> NSTextField {
            let l = NSTextField(labelWithString: s); l.frame = NSRect(x: 20, y: y, width: 100, height: 20); return l
        }

        scenePopup = NSPopUpButton(frame: NSRect(x: 130, y: 228, width: 200, height: 26))
        scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids)
        scenePopup.selectItem(withTitle: AppSettings.scene)
        if scenePopup.indexOfSelectedItem < 0 { scenePopup.selectItem(at: 0) }
        scenePopup.target = self; scenePopup.action = #selector(changed)

        presetPopup = NSPopUpButton(frame: NSRect(x: 130, y: 192, width: 200, height: 26))
        presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        presetPopup.target = self; presetPopup.action = #selector(changed)

        intensitySlider = NSSlider(value: Double(AppSettings.intensity), minValue: 0, maxValue: 1,
                                   target: self, action: #selector(changed))
        intensitySlider.frame = NSRect(x: 130, y: 158, width: 200, height: 24)

        idlePopup = NSPopUpButton(frame: NSRect(x: 130, y: 120, width: 200, height: 26))
        idlePopup.addItems(withTitles: idleChoices.map { "\(Int($0)) Min" })
        if let i = idleChoices.firstIndex(of: AppSettings.idleMinutes) { idlePopup.selectItem(at: i) }
        else { idlePopup.selectItem(withTitle: "5 Min") }
        idlePopup.target = self; idlePopup.action = #selector(changed)

        autostartCheck = NSButton(checkboxWithTitle: "Bei Inaktivität automatisch starten (Anmeldeobjekt)",
                                  target: self, action: #selector(toggleAutostart))
        autostartCheck.frame = NSRect(x: 20, y: 84, width: 420, height: 22)
        autostartCheck.state = LoginItem.isEnabled ? .on : .off

        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.frame = NSRect(x: 360, y: 222, width: 170, height: 34)
        startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"

        cv.addSubview(label("Szene:", 230)); cv.addSubview(scenePopup)
        cv.addSubview(label("Farbe:", 194)); cv.addSubview(presetPopup)
        cv.addSubview(label("CRT-Glitch:", 160)); cv.addSubview(intensitySlider)
        cv.addSubview(label("Leerlauf:", 122)); cv.addSubview(idlePopup)
        cv.addSubview(autostartCheck)
        cv.addSubview(startBtn)

        let hint = NSTextField(labelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver. „random“ wechselt die Szenen automatisch durch.")
        hint.frame = NSRect(x: 20, y: 24, width: 520, height: 48)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        hint.maximumNumberOfLines = 3; hint.lineBreakMode = .byWordWrapping
        cv.addSubview(hint)
    }

    @objc private func changed() {
        if let t = scenePopup.titleOfSelectedItem { AppSettings.scene = t }
        let pi = presetPopup.indexOfSelectedItem
        if pi >= 0, pi < Palette.presets.count { AppSettings.preset = Palette.presets[pi].id }
        AppSettings.intensity = Float(intensitySlider.doubleValue)
        let ii = idlePopup.indexOfSelectedItem
        if ii >= 0, ii < idleChoices.count { AppSettings.idleMinutes = idleChoices[ii] }
        rebuildPreview()
    }

    @objc private func toggleAutostart() {
        if autostartCheck.state == .on { LoginItem.enable() } else { LoginItem.disable() }
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
