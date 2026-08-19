// DesktopCoverage — decides whether a wallpaper screen is hidden behind an
// opaque window. Pure (no AppKit) so the logic tests cover it; the app layer
// (PowerPolicy.swift) takes the CGWindowList snapshot and feeds it in.
//
// Why this exists at all: a wallpaper window sits at the DESKTOP window level,
// and AppKit's `NSWindow.occlusionState` never reports `.visible` for such a
// window — it stays at a constant raw value and its change notification never
// fires. Trusting it made the policy treat the wallpaper as permanently
// occluded, so it paused before rendering a single frame and never resumed.
// The window is opaque black, so the user lost their desktop picture to a black
// rectangle. See docs: 2026-08-19 wallpaper-black regression.

import Foundation
import CoreGraphics

/// One entry of the window-server list, reduced to what the decision needs.
struct CoveringWindow: Equatable {
    var level: Int
    var bounds: CGRect
    var alpha: Double
    var onscreen: Bool

    init(level: Int, bounds: CGRect, alpha: Double = 1, onscreen: Bool = true) {
        self.level = level; self.bounds = bounds; self.alpha = alpha; self.onscreen = onscreen
    }
}

/// A window only counts as "covering the desktop" when it is a NORMAL window.
/// Everything the desktop itself is made of — the picture, the wallpaper window,
/// the icon layer — lives at a negative level and must never count, or the
/// wallpaper would consider itself covered by the very icons it renders behind.
let normalWindowLevelFloor = 0

/// True when `screen` is fully covered by at least one opaque, on-screen normal
/// window. Deliberately conservative: partial overlaps do NOT count. Freezing a
/// visible wallpaper is a visible bug, wasting a few frames behind a half-covering
/// window is not — so when in doubt, keep animating.
func isDesktopCovered(by windows: [CoveringWindow], screen: CGRect) -> Bool {
    guard !screen.isEmpty else { return false }
    for w in windows {
        guard w.onscreen, w.level >= normalWindowLevelFloor, w.alpha > 0.99 else { continue }
        if w.bounds.contains(screen) { return true }
    }
    return false
}

/// Signature of the coverage-relevant state, so a poller can tell whether
/// anything worth re-applying the policy for actually changed.
func coverageSignature(of windows: [CoveringWindow], screens: [CGRect]) -> [Bool] {
    screens.map { isDesktopCovered(by: windows, screen: $0) }
}
