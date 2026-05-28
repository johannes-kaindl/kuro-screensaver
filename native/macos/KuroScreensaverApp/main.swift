import Cocoa

// Top-level entry point (file named main.swift). A plain AppKit app — no
// storyboard, no main menu needed for a fullscreen "screensaver" window.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
