// ConfigWindowController — full settings UI with a LIVE preview (our own rendered
// thumbnail). Everything persists and takes effect on the next activation.

import AppKit

final class ConfigWindowController: NSWindowController {
    private var lookPopup, scenePopup, presetPopup, speedPopup, altPopup, fogPopup, weatherPopup, cyclePopup, idlePopup: NSPopUpButton!
    private var hudCheck, dayNightCheck, matrixCheck, soundCheck, cycleCheck, autostartCheck: NSButton!
    private var intensitySlider, curvSlider, maskSlider, bloomSlider, trailsSlider, ntscSlider, halSlider, termSlider: NSSlider!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?

    private let speeds = [("Langsam", "slow"), ("Normal", "norm"), ("Schnell", "fast")]
    private let alts = [("Niedrig", "low"), ("Mittel", "mid"), ("Hoch", "high")]
    private let fogs = [("Weit", "clear"), ("Auto", "auto"), ("Kurz", "dense")]   // Sichtweite
    private let weathers = [("Klar", "clear"), ("Sturm", "storm"), ("Staub", "dust")]
    private let cycleMins: [Double] = [0.5, 1, 2, 5]
    private let idleMins: [Double] = [1, 2, 5, 10, 15]

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 884),
                           styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"; win.center()
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
    }

    private func lbl(_ s: String, _ x: CGFloat, _ y: CGFloat) -> NSTextField {
        let l = NSTextField(labelWithString: s); l.frame = NSRect(x: x, y: y, width: 108, height: 18); return l
    }
    private func popup(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat = 178) -> NSPopUpButton {
        let p = NSPopUpButton(frame: NSRect(x: x, y: y, width: w, height: 26)); p.target = self; p.action = #selector(changed); return p
    }
    private func slider(_ x: CGFloat, _ y: CGFloat, _ v: Double, _ maxV: Double, _ minV: Double = 0, _ w: CGFloat = 178) -> NSSlider {
        let s = NSSlider(value: v, minValue: minV, maxValue: maxV, target: self, action: #selector(changed))
        s.frame = NSRect(x: x, y: y, width: w, height: 22); return s
    }
    private func chk(_ t: String, _ x: CGFloat, _ y: CGFloat, _ on: Bool, _ act: Selector) -> NSButton {
        let b = NSButton(checkboxWithTitle: t, target: self, action: act)
        b.frame = NSRect(x: x, y: y, width: 250, height: 22); b.state = on ? .on : .off; return b
    }

    private func buildUI(_ cv: NSView) {
        previewContainer = NSView(frame: NSRect(x: 20, y: 580, width: 580, height: 282))
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6; previewContainer.layer?.masksToBounds = true
        cv.addSubview(previewContainer)

        // === Look bar (full width, just below the preview): one-click vibe presets ===
        lookPopup = popup(132, 550, 458)
        lookPopup.action = #selector(lookChanged)
        lookPopup.addItems(withTitles: ["Eigene"] + Looks.all.map { $0.label })
        lookPopup.selectItem(at: (Looks.all.firstIndex { $0.id == AppSettings.look }).map { $0 + 1 } ?? 0)
        cv.addSubview(lbl("Look:", 20, 552)); cv.addSubview(lookPopup)

        // === left column ===
        scenePopup = popup(132, 506); scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids); scenePopup.selectItem(withTitle: AppSettings.scene)
        presetPopup = popup(132, 474); presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        speedPopup = popup(132, 442); speedPopup.addItems(withTitles: speeds.map { $0.0 }); speedPopup.selectItem(at: speeds.firstIndex { $0.1 == AppSettings.speed } ?? 1)
        altPopup = popup(132, 410); altPopup.addItems(withTitles: alts.map { $0.0 }); altPopup.selectItem(at: alts.firstIndex { $0.1 == AppSettings.cityAltitude } ?? 0)
        fogPopup = popup(132, 378); fogPopup.addItems(withTitles: fogs.map { $0.0 }); fogPopup.selectItem(at: fogs.firstIndex { $0.1 == AppSettings.fog } ?? 1)
        weatherPopup = popup(132, 346); weatherPopup.addItems(withTitles: weathers.map { $0.0 }); weatherPopup.selectItem(at: weathers.firstIndex { $0.1 == AppSettings.weather } ?? 0)
        intensitySlider = slider(132, 314, Double(AppSettings.intensity), 1)
        curvSlider = slider(132, 282, Double(AppSettings.curvature), 0.32)
        maskSlider = slider(132, 250, Double(AppSettings.apertureMask), 0.6)
        bloomSlider = slider(132, 218, Double(AppSettings.bloomScale), 2.5)
        trailsSlider = slider(132, 186, Double(AppSettings.trails), 0.92)
        ntscSlider = slider(132, 154, Double(AppSettings.ntsc), 1)
        halSlider = slider(132, 122, Double(AppSettings.halation), 0.6)

        [lbl("Szene:", 20, 508), lbl("Farbe:", 20, 476), lbl("Tempo:", 20, 444), lbl("Stadt-Höhe:", 20, 412),
         lbl("Sichtweite:", 20, 380), lbl("Wetter:", 20, 348), lbl("CRT-Glitch:", 20, 316), lbl("Krümmung:", 20, 284),
         lbl("Lochmaske:", 20, 252), lbl("Bloom:", 20, 220), lbl("Nachleuchten:", 20, 188),
         lbl("NTSC:", 20, 156), lbl("Halation:", 20, 124)].forEach { cv.addSubview($0) }
        [scenePopup!, presetPopup!, speedPopup!, altPopup!, fogPopup!, weatherPopup!].forEach { cv.addSubview($0) }
        [intensitySlider!, curvSlider!, maskSlider!, bloomSlider!, trailsSlider!, ntscSlider!, halSlider!].forEach { cv.addSubview($0) }

        // === right column ===
        hudCheck = chk("HUD + Terminal", 340, 508, AppSettings.showHud, #selector(changed))
        dayNightCheck = chk("Tag/Nacht-Zyklus", 340, 482, AppSettings.dayNight, #selector(changed))
        soundCheck = chk("Ton (Atmosphäre)", 340, 456, AppSettings.sound, #selector(changed))
        cycleCheck = chk("Szenen automatisch wechseln", 340, 430, AppSettings.autoCycle, #selector(changed))
        cyclePopup = popup(445, 396, 155); cyclePopup.addItems(withTitles: ["30 Sek", "1 Min", "2 Min", "5 Min"]); cyclePopup.selectItem(at: cycleMins.firstIndex(of: AppSettings.cycleMinutes) ?? 0)
        idlePopup = popup(445, 362, 155); idlePopup.addItems(withTitles: idleMins.map { "\(Int($0)) Min" }); idlePopup.selectItem(at: idleMins.firstIndex(of: AppSettings.idleMinutes) ?? 2)
        termSlider = slider(445, 330, Double(AppSettings.terminalScale), 4.8, 0.7, 155)
        matrixCheck = chk("Matrix-Regen", 340, 296, AppSettings.matrix, #selector(changed))
        autostartCheck = chk("Bei Inaktivität automatisch starten (Login)", 340, 270, LoginItem.isEnabled, #selector(toggleAutostart))
        autostartCheck.frame.size.width = 280

        [hudCheck!, dayNightCheck!, matrixCheck!, soundCheck!, cycleCheck!, autostartCheck!].forEach { cv.addSubview($0) }
        cv.addSubview(lbl("Wechsel:", 340, 398)); cv.addSubview(cyclePopup)
        cv.addSubview(lbl("Leerlauf:", 340, 364)); cv.addSubview(idlePopup)
        cv.addSubview(lbl("Terminal-Größe:", 340, 332)); cv.addSubview(termSlider)

        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.frame = NSRect(x: 340, y: 234, width: 260, height: 36); startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"
        cv.addSubview(startBtn)

        let hint = NSTextField(labelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver. Krümmung + Lochmaske + Nachleuchten geben den echten CRT-Look.")
        hint.frame = NSRect(x: 20, y: 70, width: 580, height: 42)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        hint.maximumNumberOfLines = 2; hint.lineBreakMode = .byWordWrapping
        cv.addSubview(hint)
    }

    /// A manual tweak of any slider/checkbox → the combo no longer matches a
    /// named Look, so flag it "Eigene" and persist.
    @objc private func changed() {
        persist()
        AppSettings.look = "custom"
        lookPopup.selectItem(at: 0)
        rebuildPreview()
    }

    /// Picking a Look sets every effect control at once (color + the CRT knobs).
    /// Scene, speed, fog, weather, terminal size etc. stay as the user left them.
    @objc private func lookChanged() {
        let i = lookPopup.indexOfSelectedItem
        guard i >= 1, i - 1 < Looks.all.count else { AppSettings.look = "custom"; return }
        let look = Looks.all[i - 1]
        if let pi = Palette.presets.firstIndex(where: { $0.id == look.preset }) { presetPopup.selectItem(at: pi) }
        curvSlider.doubleValue = Double(look.curvature)
        maskSlider.doubleValue = Double(look.apertureMask)
        trailsSlider.doubleValue = Double(look.trails)
        ntscSlider.doubleValue = Double(look.ntsc)
        halSlider.doubleValue = Double(look.halation)
        bloomSlider.doubleValue = Double(look.bloomScale)
        intensitySlider.doubleValue = Double(look.intensity)
        matrixCheck.state = look.matrix ? .on : .off
        persist()
        AppSettings.look = look.id   // keep the popup on this Look (persist() doesn't touch it)
        rebuildPreview()
    }

    /// Write every control's current value into AppSettings (no Look bookkeeping).
    private func persist() {
        if let t = scenePopup.titleOfSelectedItem { AppSettings.scene = t }
        let pi = presetPopup.indexOfSelectedItem
        if pi >= 0, pi < Palette.presets.count { AppSettings.preset = Palette.presets[pi].id }
        AppSettings.speed = speeds[max(0, speedPopup.indexOfSelectedItem)].1
        AppSettings.cityAltitude = alts[max(0, altPopup.indexOfSelectedItem)].1
        AppSettings.fog = fogs[max(0, fogPopup.indexOfSelectedItem)].1
        AppSettings.weather = weathers[max(0, weatherPopup.indexOfSelectedItem)].1
        AppSettings.intensity = Float(intensitySlider.doubleValue)
        AppSettings.curvature = Float(curvSlider.doubleValue)
        AppSettings.apertureMask = Float(maskSlider.doubleValue)
        AppSettings.bloomScale = Float(bloomSlider.doubleValue)
        AppSettings.trails = Float(trailsSlider.doubleValue)
        AppSettings.ntsc = Float(ntscSlider.doubleValue)
        AppSettings.halation = Float(halSlider.doubleValue)
        AppSettings.terminalScale = Float(termSlider.doubleValue)
        AppSettings.showHud = hudCheck.state == .on
        AppSettings.dayNight = dayNightCheck.state == .on
        AppSettings.matrix = matrixCheck.state == .on
        AppSettings.sound = soundCheck.state == .on
        AppSettings.autoCycle = cycleCheck.state == .on
        if cyclePopup.indexOfSelectedItem >= 0 { AppSettings.cycleMinutes = cycleMins[cyclePopup.indexOfSelectedItem] }
        if idlePopup.indexOfSelectedItem >= 0 { AppSettings.idleMinutes = idleMins[idlePopup.indexOfSelectedItem] }
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
