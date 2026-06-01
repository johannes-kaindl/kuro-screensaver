import Cocoa

/// Options sheet (scene + color preset + CRT intensity), built programmatically
/// so the project stays xib-free. Reads/writes through KuroDefaults.
final class ConfigureSheetController {
    static let shared = ConfigureSheetController()

    private let scenes = ["terrain", "random"]   // slice ships terrain only

    private var window: NSWindow?
    private var scenePopup: NSPopUpButton?
    private var presetPopup: NSPopUpButton?
    private var intensitySlider: NSSlider?

    func makeWindow() -> NSWindow {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 200),
            styleMask: [.titled], backing: .buffered, defer: false)
        win.title = "Kuro Screensaver (Native)"

        func label(_ s: String, _ y: CGFloat) -> NSTextField {
            let l = NSTextField(labelWithString: s)
            l.frame = NSRect(x: 20, y: y, width: 90, height: 20)
            return l
        }

        let scenePop = NSPopUpButton(frame: NSRect(x: 116, y: 150, width: 244, height: 26))
        scenePop.addItems(withTitles: scenes)
        scenePop.selectItem(withTitle: KuroDefaults.scene)
        if scenePop.indexOfSelectedItem < 0 { scenePop.selectItem(at: 0) }

        let presetPop = NSPopUpButton(frame: NSRect(x: 116, y: 112, width: 244, height: 26))
        presetPop.addItems(withTitles: Palette.presets.map { $0.label })
        if let idx = Palette.presets.firstIndex(where: { $0.id == KuroDefaults.colorPreset }) {
            presetPop.selectItem(at: idx)
        }

        let slider = NSSlider(value: Double(KuroDefaults.crtIntensity),
                              minValue: 0, maxValue: 1,
                              target: nil, action: nil)
        slider.frame = NSRect(x: 116, y: 74, width: 244, height: 24)

        let ok = NSButton(title: "OK", target: self, action: #selector(confirm))
        ok.frame = NSRect(x: 272, y: 16, width: 90, height: 30)
        ok.bezelStyle = .rounded
        ok.keyEquivalent = "\r"

        let cancel = NSButton(title: "Cancel", target: self, action: #selector(dismiss))
        cancel.frame = NSRect(x: 174, y: 16, width: 90, height: 30)
        cancel.bezelStyle = .rounded

        let cv = win.contentView!
        cv.addSubview(label("Scene:", 152))
        cv.addSubview(label("Color:", 114))
        cv.addSubview(label("CRT glitch:", 76))
        cv.addSubview(scenePop)
        cv.addSubview(presetPop)
        cv.addSubview(slider)
        cv.addSubview(ok)
        cv.addSubview(cancel)

        window = win
        scenePopup = scenePop
        presetPopup = presetPop
        intensitySlider = slider
        return win
    }

    @objc private func confirm() {
        if let title = scenePopup?.titleOfSelectedItem { KuroDefaults.scene = title }
        if let idx = presetPopup?.indexOfSelectedItem, idx >= 0, idx < Palette.presets.count {
            KuroDefaults.colorPreset = Palette.presets[idx].id
        }
        if let v = intensitySlider?.doubleValue { KuroDefaults.crtIntensity = Float(v) }
        close()
    }

    @objc private func dismiss() { close() }

    private func close() {
        guard let win = window else { return }
        if let parent = win.sheetParent { parent.endSheet(win) } else { win.close() }
    }
}
