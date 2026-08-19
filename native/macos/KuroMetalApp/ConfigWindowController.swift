// ConfigWindowController — full settings UI with a LIVE preview (our own rendered
// thumbnail). Everything persists and takes effect on the next activation.

import AppKit

final class ConfigWindowController: NSWindowController {
    private var lookPopup, scenePopup, presetPopup, speedPopup, altPopup, fogPopup, weatherPopup, cyclePopup, idlePopup, wallScalePopup, terminalPopup: NSPopUpButton!
    private var hudCheck, radarCheck, bootCheck, dayNightCheck, soundCheck, cycleCheck, autostartCheck, flatHudCheck, reactiveWorldCheck: NSButton!
    private var intensitySlider, curvSlider, maskSlider, bloomSlider, trailsSlider, ntscSlider, halSlider, termSlider, bandSlider, bankSlider: NSSlider!
    private var previewContainer: NSView!
    private var previewView: MetalHostView?
    private var termGrid: NSGridView!   // Terminal section — rows shown/hidden by layout

    private let speeds = [("Langsam", "slow"), ("Normal", "norm"), ("Schnell", "fast")]
    private let alts = [("Niedrig", "low"), ("Mittel", "mid"), ("Hoch", "high")]
    private let fogs = [("Weit", "clear"), ("Auto", "auto"), ("Kurz", "dense")]   // Sichtweite
    private let weathers = [("Klar", "clear"), ("Sturm", "storm"), ("Staub", "dust")]
    private let cycleMins: [Double] = [0.5, 1, 2, 5]
    private let idleMins: [Double] = [1, 2, 5, 10, 15]
    private let termLayouts = [("Aus", "off"), ("Unten", "strip"), ("Leiste (unten)", "stripdark"), ("Fenster (Lisa)", "window")]
    private let wallScales: [(String, Double)] = [("Voll (100 %)", 1.0), ("75 %", 0.75), ("66 % – Standard", 0.66), ("50 %", 0.5)]

    // Aligned label width across all field rows + a consistent control width.
    private let labelW: CGFloat = 118
    private let controlW: CGFloat = 188

    convenience init() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 820),
                           styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        win.title = "Kuro Screensaver"
        self.init(window: win)
        buildUI(win.contentView!)
        rebuildPreview()
        fitWindow()
        win.center()
    }

    /// Re-size the window to exactly fit the laid-out content (after rows show/hide).
    private func fitWindow() {
        guard let win = window, let cv = win.contentView, let root = cv.subviews.first else { return }
        cv.layoutSubtreeIfNeeded()
        win.setContentSize(NSSize(width: root.fittingSize.width + 40, height: root.fittingSize.height + 40))
    }

    // ── Auto Layout control factories ───────────────────────────────────────
    private func mkPopup(_ action: Selector = #selector(changed), stretch: Bool = false) -> NSPopUpButton {
        let p = NSPopUpButton(); p.target = self; p.action = action
        p.translatesAutoresizingMaskIntoConstraints = false
        if stretch { p.setContentHuggingPriority(.defaultLow, for: .horizontal) }
        else { p.widthAnchor.constraint(equalToConstant: controlW).isActive = true }
        return p
    }
    private func mkSlider(_ v: Double, _ maxV: Double, _ minV: Double = 0) -> NSSlider {
        let s = NSSlider(value: v, minValue: minV, maxValue: maxV, target: self, action: #selector(changed))
        s.translatesAutoresizingMaskIntoConstraints = false
        s.widthAnchor.constraint(equalToConstant: controlW).isActive = true
        return s
    }
    private func mkCheck(_ t: String, _ on: Bool, _ act: Selector = #selector(changed)) -> NSButton {
        let b = NSButton(checkboxWithTitle: t, target: self, action: act)
        b.state = on ? .on : .off; b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }
    private func lab(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s)
        l.alignment = .right; l.textColor = .secondaryLabelColor
        return l
    }
    /// Aligned label+control rows. NSGridView sizes the label column to the widest
    /// label + handles row spacing — robust, self-sizing (no fragile frame math).
    private func grid(_ rows: [[NSView]]) -> NSGridView {
        let g = NSGridView(views: rows)
        g.translatesAutoresizingMaskIntoConstraints = false
        g.rowSpacing = 9; g.columnSpacing = 10
        if g.numberOfColumns > 0 { g.column(at: 0).xPlacement = .trailing }
        return g
    }
    /// A section: a quiet uppercased header + its content (grids / checkboxes), stacked.
    private func section(_ title: String, _ content: [NSView]) -> NSStackView {
        let header = NSTextField(labelWithString: title.uppercased())
        header.font = .systemFont(ofSize: 11, weight: .semibold); header.textColor = .secondaryLabelColor
        let v = NSStackView(views: [header] + content)
        v.orientation = .vertical; v.spacing = 9; v.alignment = .leading
        return v
    }
    /// A single horizontal label+control row (the full-width Look picker).
    private func hrow(_ text: String, _ control: NSView) -> NSStackView {
        let l = lab(text); l.translatesAutoresizingMaskIntoConstraints = false
        l.widthAnchor.constraint(equalToConstant: labelW).isActive = true
        let h = NSStackView(views: [l, control]); h.orientation = .horizontal; h.spacing = 10; h.alignment = .centerY
        return h
    }

    private func buildUI(_ cv: NSView) {
        // Live preview thumbnail.
        previewContainer = NSView()
        previewContainer.translatesAutoresizingMaskIntoConstraints = false
        previewContainer.wantsLayer = true
        previewContainer.layer?.backgroundColor = NSColor.black.cgColor
        previewContainer.layer?.cornerRadius = 6; previewContainer.layer?.masksToBounds = true
        previewContainer.heightAnchor.constraint(equalToConstant: 232).isActive = true

        // Look — prominent one-click vibe presets, full width under the preview.
        lookPopup = mkPopup(#selector(lookChanged), stretch: true)
        lookPopup.addItems(withTitles: ["Eigene"] + Looks.all.map { $0.label })
        lookPopup.selectItem(at: (Looks.all.firstIndex { $0.id == AppSettings.look }).map { $0 + 1 } ?? 0)
        let lookRow = hrow("Look:", lookPopup)

        // Popups + sliders.
        scenePopup = mkPopup(); scenePopup.addItems(withTitles: ["random"] + SceneRegistry.ids); scenePopup.selectItem(withTitle: AppSettings.scene)
        presetPopup = mkPopup(); presetPopup.addItems(withTitles: Palette.presets.map { $0.label })
        if let i = Palette.presets.firstIndex(where: { $0.id == AppSettings.preset }) { presetPopup.selectItem(at: i) }
        speedPopup = mkPopup(); speedPopup.addItems(withTitles: speeds.map { $0.0 }); speedPopup.selectItem(at: speeds.firstIndex { $0.1 == AppSettings.speed } ?? 1)
        altPopup = mkPopup(); altPopup.addItems(withTitles: alts.map { $0.0 }); altPopup.selectItem(at: alts.firstIndex { $0.1 == AppSettings.cityAltitude } ?? 0)
        fogPopup = mkPopup(); fogPopup.addItems(withTitles: fogs.map { $0.0 }); fogPopup.selectItem(at: fogs.firstIndex { $0.1 == AppSettings.fog } ?? 1)
        weatherPopup = mkPopup(); weatherPopup.addItems(withTitles: weathers.map { $0.0 }); weatherPopup.selectItem(at: weathers.firstIndex { $0.1 == AppSettings.weather } ?? 0)
        intensitySlider = mkSlider(Double(AppSettings.intensity), 1)
        curvSlider = mkSlider(Double(AppSettings.curvature), 0.032)
        maskSlider = mkSlider(Double(AppSettings.apertureMask), 0.6)
        bloomSlider = mkSlider(Double(AppSettings.bloomScale), 2.5)
        trailsSlider = mkSlider(Double(AppSettings.trails), 0.92)
        ntscSlider = mkSlider(Double(AppSettings.ntsc), 1)
        halSlider = mkSlider(Double(AppSettings.halation), 0.6)
        cyclePopup = mkPopup(); cyclePopup.addItems(withTitles: ["30 Sek", "1 Min", "2 Min", "5 Min"]); cyclePopup.selectItem(at: cycleMins.firstIndex(of: AppSettings.cycleMinutes) ?? 0)
        idlePopup = mkPopup(); idlePopup.addItems(withTitles: idleMins.map { "\(Int($0)) Min" }); idlePopup.selectItem(at: idleMins.firstIndex(of: AppSettings.idleMinutes) ?? 2)
        wallScalePopup = mkPopup(#selector(wallScaleChanged))
        wallScalePopup.addItems(withTitles: wallScales.map { $0.0 })
        wallScalePopup.selectItem(at: wallScales.firstIndex { $0.1 == AppSettings.wallpaperRenderScale } ?? 2)
        wallScalePopup.toolTip = "Render-Auflösung des animierten Hintergrunds. Niedriger = sparsamer; die CRT-Optik kaschiert die Skalierung. Vollbild-Screensaver rendert immer voll."
        termSlider = mkSlider(Double(AppSettings.terminalScale), 4.8, 0.7)
        bandSlider = mkSlider(Double(AppSettings.terminalBandHeight), 0.5, 0.12)
        bankSlider = mkSlider(Double(AppSettings.bankStrength), 2.0, 0)
        terminalPopup = mkPopup(#selector(terminalChanged)); terminalPopup.addItems(withTitles: termLayouts.map { $0.0 })
        terminalPopup.selectItem(at: termLayouts.firstIndex { $0.1 == AppSettings.terminalLayout } ?? 1)

        // Checkboxes.
        hudCheck = mkCheck("HUD (Instrumente)", AppSettings.showHud)
        radarCheck = mkCheck("Radar", AppSettings.showRadar)
        bootCheck = mkCheck("Boot-Sequenz beim Start", AppSettings.bootEnabled)
        dayNightCheck = mkCheck("Tag/Nacht-Zyklus", AppSettings.dayNight)
        soundCheck = mkCheck("Ton (Atmosphäre)", AppSettings.sound)
        cycleCheck = mkCheck("Szenen automatisch wechseln", AppSettings.autoCycle)
        autostartCheck = mkCheck("Bei Inaktivität automatisch starten", LoginItem.isEnabled, #selector(toggleAutostart))
        flatHudCheck = mkCheck("HUD flach (über Monitor, statt gekrümmt)", AppSettings.flatHud)
        reactiveWorldCheck = mkCheck("Welt reagiert auf die Story (Nebel/CRT)", AppSettings.reactiveWorld)

        // Sections, grouped into two columns.
        let secBild = section("Bild", [grid([
            [lab("Szene:"), scenePopup], [lab("Farbe:"), presetPopup], [lab("Tempo:"), speedPopup],
            [lab("Stadt-Höhe:"), altPopup], [lab("Sichtweite:"), fogPopup], [lab("Wetter:"), weatherPopup],
        ])])
        let secCRT = section("CRT-Effekte", [grid([
            [lab("CRT-Glitch:"), intensitySlider], [lab("Krümmung:"), curvSlider], [lab("Lochmaske:"), maskSlider],
            [lab("Bloom:"), bloomSlider], [lab("Nachleuchten:"), trailsSlider], [lab("NTSC:"), ntscSlider],
            [lab("Halation:"), halSlider],
        ]), flatHudCheck])
        let secMotion = section("Bewegung & Story", [grid([[lab("Flug-Bank:"), bankSlider]]), reactiveWorldCheck])
        termGrid = grid([
            [lab("Layout:"), terminalPopup],
            [lab("Größe:"), termSlider],
            [lab("Leisten-Höhe:"), bandSlider],
        ])
        let secTerminal = section("Terminal", [termGrid])
        let secBehavior = section("Anzeige & Automatik", [
            hudCheck, radarCheck, bootCheck, dayNightCheck, soundCheck, cycleCheck,
            grid([[lab("Wechsel:"), cyclePopup], [lab("Auto-Start:"), idlePopup],
                  [lab("Hintergrund:"), wallScalePopup]]), autostartCheck,
        ])

        let leftCol = NSStackView(views: [secBild, secCRT]); leftCol.orientation = .vertical; leftCol.spacing = 18; leftCol.alignment = .leading
        let rightCol = NSStackView(views: [secMotion, secTerminal, secBehavior]); rightCol.orientation = .vertical; rightCol.spacing = 18; rightCol.alignment = .leading
        let columns = NSStackView(views: [leftCol, rightCol]); columns.orientation = .horizontal; columns.spacing = 28; columns.alignment = .top

        // Action buttons.
        let startBtn = NSButton(title: "Vollbild starten", target: self, action: #selector(startFullscreen))
        startBtn.bezelStyle = .rounded; startBtn.keyEquivalent = "\r"
        let wallBtn = NSButton(title: "Als Hintergrund", target: self, action: #selector(setAsWallpaper))
        wallBtn.bezelStyle = .rounded
        wallBtn.toolTip = "Den Live-Render mit den aktuellen Einstellungen als animierten Desktop-Hintergrund setzen (hinter den Icons). Entfernen über das ▦-Menü in der Menüleiste."
        let actions = NSStackView(views: [NSView(), startBtn, wallBtn]); actions.orientation = .horizontal; actions.spacing = 12

        let hint = NSTextField(wrappingLabelWithString: "Vorschau läuft live. Im Vollbild beendet jede Eingabe den Screensaver. Als Hintergrund setzt den Live-Render hinter die Desktop-Icons.")
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)

        let root = NSStackView(views: [previewContainer, lookRow, columns, actions, hint])
        root.orientation = .vertical; root.spacing = 14; root.alignment = .leading
        root.translatesAutoresizingMaskIntoConstraints = false
        cv.addSubview(root)
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: cv.topAnchor, constant: 20),
            root.leadingAnchor.constraint(equalTo: cv.leadingAnchor, constant: 20),
            // `columns` drives the width; the full-width rows match it (avoids circularity).
            previewContainer.widthAnchor.constraint(equalTo: columns.widthAnchor),
            lookRow.widthAnchor.constraint(equalTo: columns.widthAnchor),
            actions.widthAnchor.constraint(equalTo: columns.widthAnchor),
            hint.widthAnchor.constraint(equalTo: columns.widthAnchor),
        ])
        updateTerminalRows()   // initial show/hide of the terminal sub-rows
    }

    /// Terminal sub-rows depend on the layout: hide Größe when the terminal is off, and
    /// Leisten-Höhe unless the band ("Leiste") layout is selected.
    private func updateTerminalRows() {
        let layout = termLayouts[max(0, terminalPopup.indexOfSelectedItem)].1
        termGrid.row(at: 1).isHidden = (layout == "off")
        termGrid.row(at: 2).isHidden = (layout != "stripdark")
    }

    @objc private func terminalChanged() {
        changed()              // persist + rebuild preview + mark Look "custom"
        updateTerminalRows()
        fitWindow()
    }

    @objc private func wallScaleChanged() {
        if wallScalePopup.indexOfSelectedItem >= 0 {
            AppSettings.wallpaperRenderScale = wallScales[wallScalePopup.indexOfSelectedItem].1
        }
        (NSApp.delegate as? AppDelegate)?.refreshWallpaperScale()
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
        persist()
        AppSettings.matrix = look.matrix   // the Look's matrix overlay flag (no separate checkbox)
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
        AppSettings.showRadar = radarCheck.state == .on
        AppSettings.bootEnabled = bootCheck.state == .on
        AppSettings.flatHud = flatHudCheck.state == .on
        AppSettings.reactiveWorld = reactiveWorldCheck.state == .on
        AppSettings.terminalLayout = termLayouts[max(0, terminalPopup.indexOfSelectedItem)].1
        AppSettings.terminalBandHeight = Float(bandSlider.doubleValue)
        AppSettings.bankStrength = Float(bankSlider.doubleValue)
        AppSettings.dayNight = dayNightCheck.state == .on
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

    /// Set the current configuration as the animated desktop background. Persists the
    /// settings, then hosts the wallpaper IN-PROCESS (see setWallpaperFromConfig) and
    /// installs it for the next login. Clicking again re-applies the latest settings.
    /// Remove it via the wallpaper's ▦ menu-bar item ("Hintergrund beenden").
    @objc private func setAsWallpaper(_ sender: NSButton) {
        persist()
        (NSApp.delegate as? AppDelegate)?.setWallpaperFromConfig()
        let orig = sender.title
        sender.title = "Gesetzt ✓"
        sender.isEnabled = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) {
            sender.title = orig; sender.isEnabled = true
        }
    }
}
