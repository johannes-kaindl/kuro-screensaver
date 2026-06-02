// ConfigWindowController — full settings UI with a LIVE preview (our own rendered
// thumbnail). Scene/color/speed/altitude/fog/glitch/HUD/bloom/sound/auto-cycle/
// idle/autostart — all persist and take effect on the next activation.

import AppKit

final class ConfigWindowController: NSWindowController {
    // value popups (display title ↔ raw value)
    private var scenePopup, presetPopup, speedPopup, altPopup, fogPopup, cyclePopup, idlePopup: NSPopUpButton!
    private var hudCheck, soundCheck, cycleCheck, autostartCheck: NSButton!
    private var intensitySlider: NSSlider!
    private var bloomSlider: NSSlider!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?

    private let speeds = [("Langsam", "slow"), ("Normal", "norm"), ("Schnell", "fast")]
    private let alts = [("Niedrig", "low"), ("Mittel", "mid"), ("Hoch", "high")]
    private let fogs = [("Klar", "clear"), ("Auto", "auto"), ("Dicht", "dense")]
    private let cycleMins: [Double] = [0.5, 1, 2, 5]
    private let idleMins: [Double] = [1, 2, 5, 10, 15]

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 672),
                           styleMask: [.titled, .closable, .miniaturizable],
                           backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"
        win.center()
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
    }

    private func label(_ s: String, _ x: CGFloat, _ y: CGFloat) -> NSTextField {
        let l = NSTextField(labelWithString: s); l.frame = NSRect(x: x, y: y, width: 95, height: 20); return l
    }
    private func popup(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat = 185) -> NSPopUpButton {
        let p = NSPopUpButton(frame: NSRect(x: x, y: y, width: w, height: 26))
        p.target = self; p.action = #selector(changed); return p
    }
    private func check(_ title: String, _ x: CGFloat, _ y: CGFloat, _ on: Bool) -> NSButton {
        let b = NSButton(checkboxWithTitle: title, target: self, action: #selector(changed))
        b.frame = NSRect(x: x, y: y, width: 230, height: 22); b.state = on ? .on : .off; return b
    }

    private func buildUI(_ cv: NSView) {
        previewContainer = NSView(frame: NSRect(x: 20, y: 338, width: 580, height: 318))
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6; previewContainer.layer?.masksToBounds = true
        cv.addSubview(previewContainer)

        // --- left column ---
        scenePopup = popup(125, 296); scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids)
        scenePopup.selectItem(withTitle: AppSettings.scene)
        presetPopup = popup(125, 262); presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        speedPopup = popup(125, 228); speedPopup.addItems(withTitles: speeds.map { $0.0 })
        speedPopup.selectItem(at: speeds.firstIndex { $0.1 == AppSettings.speed } ?? 1)
        altPopup = popup(125, 194); altPopup.addItems(withTitles: alts.map { $0.0 })
        altPopup.selectItem(at: alts.firstIndex { $0.1 == AppSettings.cityAltitude } ?? 0)
        fogPopup = popup(125, 160); fogPopup.addItems(withTitles: fogs.map { $0.0 })
        fogPopup.selectItem(at: fogs.firstIndex { $0.1 == AppSettings.fog } ?? 1)
        intensitySlider = NSSlider(value: Double(AppSettings.intensity), minValue: 0, maxValue: 1,
                                   target: self, action: #selector(changed))
        intensitySlider.frame = NSRect(x: 125, y: 126, width: 185, height: 24)

        [label("Szene:", 20, 298), label("Farbe:", 20, 264), label("Tempo:", 20, 230),
         label("Stadt-Höhe:", 20, 196), label("Nebel:", 20, 162), label("CRT-Glitch:", 20, 128)].forEach { cv.addSubview($0) }
        [scenePopup!, presetPopup!, speedPopup!, altPopup!, fogPopup!].forEach { cv.addSubview($0) }
        cv.addSubview(intensitySlider)

        // --- right column ---
        hudCheck = check("HUD + Terminal", 335, 298, AppSettings.showHud)
        bloomSlider = NSSlider(value: Double(AppSettings.bloomScale), minValue: 0, maxValue: 2.5,
                               target: self, action: #selector(changed))
        bloomSlider.frame = NSRect(x: 420, y: 270, width: 180, height: 24)
        soundCheck = check("Ton (Atmosphäre)", 335, 246, AppSettings.sound)
        cycleCheck = check("Szenen automatisch wechseln", 335, 220, AppSettings.autoCycle)
        cyclePopup = popup(440, 184, 160); cyclePopup.addItems(withTitles: ["30 Sek", "1 Min", "2 Min", "5 Min"])
        cyclePopup.selectItem(at: cycleMins.firstIndex(of: AppSettings.cycleMinutes) ?? 0)
        idlePopup = popup(440, 150, 160); idlePopup.addItems(withTitles: idleMins.map { "\(Int($0)) Min" })
        idlePopup.selectItem(at: idleMins.firstIndex(of: AppSettings.idleMinutes) ?? 2)
        autostartCheck = NSButton(checkboxWithTitle: "Bei Inaktivität automatisch starten (Login)",
                                  target: self, action: #selector(toggleAutostart))
        autostartCheck.frame = NSRect(x: 335, y: 116, width: 280, height: 22)
        autostartCheck.state = LoginItem.isEnabled ? .on : .off

        [hudCheck!, soundCheck!, cycleCheck!, autostartCheck!].forEach { cv.addSubview($0) }
        cv.addSubview(label("Bloom:", 335, 272)); cv.addSubview(bloomSlider)
        cv.addSubview(label("Wechsel:", 335, 186)); cv.addSubview(cyclePopup)
        cv.addSubview(label("Leerlauf:", 335, 152)); cv.addSubview(idlePopup)

        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.frame = NSRect(x: 335, y: 74, width: 265, height: 34)
        startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"
        cv.addSubview(startBtn)

        let hint = NSTextField(labelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver.")
        hint.frame = NSRect(x: 20, y: 24, width: 580, height: 36)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        hint.maximumNumberOfLines = 2; hint.lineBreakMode = .byWordWrapping
        cv.addSubview(hint)
    }

    @objc private func changed() {
        if let t = scenePopup.titleOfSelectedItem { AppSettings.scene = t }
        let pi = presetPopup.indexOfSelectedItem
        if pi >= 0, pi < Palette.presets.count { AppSettings.preset = Palette.presets[pi].id }
        AppSettings.speed = speeds[max(0, speedPopup.indexOfSelectedItem)].1
        AppSettings.cityAltitude = alts[max(0, altPopup.indexOfSelectedItem)].1
        AppSettings.fog = fogs[max(0, fogPopup.indexOfSelectedItem)].1
        AppSettings.intensity = Float(intensitySlider.doubleValue)
        AppSettings.showHud = hudCheck.state == .on
        AppSettings.bloomScale = Float(bloomSlider.doubleValue)
        AppSettings.sound = soundCheck.state == .on
        AppSettings.autoCycle = cycleCheck.state == .on
        if cyclePopup.indexOfSelectedItem >= 0 { AppSettings.cycleMinutes = cycleMins[cyclePopup.indexOfSelectedItem] }
        if idlePopup.indexOfSelectedItem >= 0 { AppSettings.idleMinutes = idleMins[idlePopup.indexOfSelectedItem] }
        rebuildPreview()
    }

    @objc private func toggleAutostart() {
        if autostartCheck.state == .on { LoginItem.enable() } else { LoginItem.disable() }
    }

    private func rebuildPreview() {
        previewView?.stop(); previewView?.removeFromSuperview()
        let (s, cycle) = AppSettings.make()
        let sec = cycle ? AppSettings.cycleMinutes * 60 : 0
        let v = MetalHostView(frame: previewContainer.bounds, settings: s, autoCycleSec: sec)
        v.autoresizingMask = [.width, .height]
        previewContainer.addSubview(v); v.start()
        previewView = v
    }

    func pausePreview() { previewView?.stop() }
    func resumePreview() { rebuildPreview() }

    @objc private func startFullscreen() {
        (NSApp.delegate as? AppDelegate)?.startScreensaver(returnToConfig: true)
    }
}
