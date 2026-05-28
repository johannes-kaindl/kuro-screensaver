import Cocoa

/// Builds the screensaver's options sheet (scene + audio) programmatically so
/// the project stays xib-free and reproducible. Reads/writes through
/// `KuroDefaults`, the same store the view reads at launch.
final class ConfigureSheetController {
    static let shared = ConfigureSheetController()

    private let scenes = ["random", "terrain", "city", "rift", "tunnel", "void"]

    private var window: NSWindow?
    private var scenePopup: NSPopUpButton?
    private var audioCheck: NSButton?

    func makeWindow() -> NSWindow {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 340, height: 150),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        win.title = "Kuro Screensaver"

        let sceneLabel = NSTextField(labelWithString: "Scene:")
        sceneLabel.frame = NSRect(x: 20, y: 102, width: 60, height: 20)

        let popup = NSPopUpButton(frame: NSRect(x: 86, y: 98, width: 234, height: 26))
        popup.addItems(withTitles: scenes)
        popup.selectItem(withTitle: KuroDefaults.scene)
        if popup.indexOfSelectedItem < 0 { popup.selectItem(at: 0) }

        let check = NSButton(checkboxWithTitle: "Enable audio", target: nil, action: nil)
        check.frame = NSRect(x: 86, y: 66, width: 234, height: 20)
        check.state = KuroDefaults.audio ? .on : .off

        let ok = NSButton(title: "OK", target: self, action: #selector(confirm))
        ok.frame = NSRect(x: 232, y: 16, width: 90, height: 30)
        ok.bezelStyle = .rounded
        ok.keyEquivalent = "\r"

        let cancel = NSButton(title: "Cancel", target: self, action: #selector(dismiss))
        cancel.frame = NSRect(x: 134, y: 16, width: 90, height: 30)
        cancel.bezelStyle = .rounded

        win.contentView?.addSubview(sceneLabel)
        win.contentView?.addSubview(popup)
        win.contentView?.addSubview(check)
        win.contentView?.addSubview(ok)
        win.contentView?.addSubview(cancel)

        window = win
        scenePopup = popup
        audioCheck = check
        return win
    }

    @objc private func confirm() {
        if let title = scenePopup?.titleOfSelectedItem {
            KuroDefaults.scene = title
        }
        KuroDefaults.audio = (audioCheck?.state == .on)
        close()
    }

    @objc private func dismiss() {
        close()
    }

    private func close() {
        guard let win = window else { return }
        if let parent = win.sheetParent {
            parent.endSheet(win)
        } else {
            win.close()
        }
    }
}
