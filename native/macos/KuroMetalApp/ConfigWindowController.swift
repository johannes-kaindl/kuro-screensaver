// ConfigWindowController — full settings UI with a LIVE preview (our own rendered
// thumbnail). Everything persists and takes effect on the next activation.

import AppKit

final class ConfigWindowController: NSWindowController {
    private var scenePopup, presetPopup, speedPopup, altPopup, fogPopup, cyclePopup, idlePopup: NSPopUpButton!
    private var hudCheck, soundCheck, cycleCheck, autostartCheck: NSButton!
    private var intensitySlider, bloomSlider, curvSlider, maskSlider: NSSlider!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?

    private let speeds = [("Langsam", "slow"), ("Normal", "norm"), ("Schnell", "fast")]
    private let alts = [("Niedrig", "low"), ("Mittel", "mid"), ("Hoch", "high")]
    private let fogs = [("Klar", "clear"), ("Auto", "auto"), ("Dicht", "dense")]
    private let cycleMins: [Double] = [0.5, 1, 2, 5]
    private let idleMins: [Double] = [1, 2, 5, 10, 15]

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 752),
                           styleMask: [.titled, .closable, .miniaturizable],
                           backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"
        win.center()
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
    }

    private func lbl(_ s: String, _ x: CGFloat, _ y: CGFloat) -> NSTextField {
        let l = NSTextField(labelWithString: s); l.frame = NSRect(x: x, y: y, width: 100, height: 18); return l
    }
    private func popup(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat = 185) -> NSPopUpButton {
        let p = NSPopUpButton(frame: NSRect(x: x, y: y, width: w, height: 26)); p.target = self; p.action = #selector(changed); return p
    }
    private func slider(_ x: CGFloat, _ y: CGFloat, _ value: Double, _ maxV: Double, _ w: CGFloat = 185) -> NSSlider {
        let s = NSSlider(value: value, minValue: 0, maxValue: maxV, target: self, action: #selector(changed))
        s.frame = NSRect(x: x, y: y, width: w, height: 22); return s
    }
    private func chk(_ t: String, _ x: CGFloat, _ y: CGFloat, _ on: Bool, _ act: Selector) -> NSButton {
        let b = NSButton(checkboxWithTitle: t, target: self, action: act)
        b.frame = NSRect(x: x, y: y, width: 250, height: 22); b.state = on ? .on : .off; return b
    }

    private func buildUI(_ cv: NSView) {
        previewContainer = NSView(frame: NSRect(x: 20, y: 418, width: 580, height: 314))
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6; previewContainer.layer?.masksToBounds = true
        cv.addSubview(previewContainer)

        // --- left column: scene + look ---
        scenePopup = popup(125, 378); scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids)
        scenePopup.selectItem(withTitle: AppSettings.scene)
        presetPopup = popup(125, 344); presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        speedPopup = popup(125, 310); speedPopup.addItems(withTitles: speeds.map { $0.0 })
        speedPopup.selectItem(at: speeds.firstIndex { $0.1 == AppSettings.speed } ?? 1)
        altPopup = popup(125, 276); altPopup.addItems(withTitles: alts.map { $0.0 })
        altPopup.selectItem(at: alts.firstIndex { $0.1 == AppSettings.cityAltitude } ?? 0)
        fogPopup = popup(125, 242); fogPopup.addItems(withTitles: fogs.map { $0.0 })
        fogPopup.selectItem(at: fogs.firstIndex { $0.1 == AppSettings.fog } ?? 1)
        intensitySlider = slider(125, 210, Double(AppSettings.intensity), 1)
        curvSlider = slider(125, 178, Double(AppSettings.curvature), 0.32)
        maskSlider = slider(125, 146, Double(AppSettings.apertureMask), 0.6)
        bloomSlider = slider(125, 114, Double(AppSettings.bloomScale), 2.5)

        [lbl("Szene:", 20, 380), lbl("Farbe:", 20, 346), lbl("Tempo:", 20, 312), lbl("Stadt-Höhe:", 20, 278),
         lbl("Nebel:", 20, 244), lbl("CRT-Glitch:", 20, 210), lbl("Krümmung:", 20, 178),
         lbl("Lochmaske:", 20, 146), lbl("Bloom:", 20, 114)].forEach { cv.addSubview($0) }
        [scenePopup!, presetPopup!, speedPopup!, altPopup!, fogPopup!].forEach { cv.addSubview($0) }
        [intensitySlider!, curvSlider!, maskSlider!, bloomSlider!].forEach { cv.addSubview($0) }

        // --- right column: toggles + timing ---
        hudCheck = chk("HUD + Terminal", 335, 380, AppSettings.showHud, #selector(changed))
        soundCheck = chk("Ton (Atmosphäre)", 335, 354, AppSettings.sound, #selector(changed))
        cycleCheck = chk("Szenen automatisch wechseln", 335, 328, AppSettings.autoCycle, #selector(changed))
        cyclePopup = popup(440, 294, 160); cyclePopup.addItems(withTitles: ["30 Sek", "1 Min", "2 Min", "5 Min"])
        cyclePopup.selectItem(at: cycleMins.firstIndex(of: AppSettings.cycleMinutes) ?? 0)
        idlePopup = popup(440, 260, 160); idlePopup.addItems(withTitles: idleMins.map { "\(Int($0)) Min" })
        idlePopup.selectItem(at: idleMins.firstIndex(of: AppSettings.idleMinutes) ?? 2)
        autostartCheck = chk("Bei Inaktivität automatisch starten (Login)", 335, 226, LoginItem.isEnabled, #selector(toggleAutostart))
        autostartCheck.frame.size.width = 280

        [hudCheck!, soundCheck!, cycleCheck!, autostartCheck!].forEach { cv.addSubview($0) }
        cv.addSubview(lbl("Wechsel:", 335, 296)); cv.addSubview(cyclePopup)
        cv.addSubview(lbl("Leerlauf:", 335, 262)); cv.addSubview(idlePopup)

        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.frame = NSRect(x: 335, y: 150, width: 265, height: 36)
        startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"
        cv.addSubview(startBtn)

        let hint = NSTextField(labelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver. Krümmung + Lochmaske geben den echten CRT-Look.")
        hint.frame = NSRect(x: 20, y: 22, width: 580, height: 60)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        hint.maximumNumberOfLines = 3; hint.lineBreakMode = .byWordWrapping
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
        AppSettings.curvature = Float(curvSlider.doubleValue)
        AppSettings.apertureMask = Float(maskSlider.doubleValue)
        AppSettings.bloomScale = Float(bloomSlider.doubleValue)
        AppSettings.showHud = hudCheck.state == .on
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
