// RenderPolicy — pure decision table for the wallpaper's power/visibility
// policy. Lives in Core (no AppKit) so the logic tests cover it; the app layer
// (PowerPolicy.swift) gathers the signals, the AppDelegate applies the result
// per wallpaper view. Priority: invisibility → thermal panic → battery/low-power
// preference → thermal throttle → normal animation.

import Foundation

enum RenderState: Equatable {
    case hidden                    // stop the display link entirely (0 wakeups)
    case frozen                    // keep the last frame as a still
    case animating(fps: Double)
}

struct RenderPolicyInputs {
    var occluded = false           // this window is fully covered / other Space
    var screenLocked = false
    var screensAsleep = false
    var onBattery = false
    var lowPowerMode = false
    var thermalSerious = false     // ProcessInfo.thermalState == .serious
    var thermalCritical = false    // == .critical
    var animateOnBattery = false   // AppSettings.wallpaperOnBattery
    var acFps: Double = 30
    var batteryFps: Double = 10
}

func renderState(_ i: RenderPolicyInputs) -> RenderState {
    if i.occluded || i.screenLocked || i.screensAsleep { return .hidden }
    if i.thermalCritical { return .frozen }
    let saving = i.onBattery || i.lowPowerMode
    if saving && !i.animateOnBattery { return .frozen }
    if i.thermalSerious { return .animating(fps: i.batteryFps) }
    return .animating(fps: saving ? i.batteryFps : i.acFps)
}
