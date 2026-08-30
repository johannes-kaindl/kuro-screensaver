#pragma once

// Pure decision table for the wallpaper's power/visibility policy — the third
// port of Core/RenderPolicy.swift, after native/windows/host/src/render_policy.h.
// Deliberately free of GTK/X11 includes: wallpaper_window gathers the signals,
// options_test covers the table headlessly (which is why this half could be
// written without the target machine).
//
// Priority: no first frame → invisibility → battery preference → normal.
//
// Two deliberate differences from the Windows twin, both about signals X11 does
// not offer cleanly rather than about policy:
//   - no `fullscreenApp`: Windows reads SHQueryUserNotificationState; X11 has no
//     equivalent that works across window managers. A fullscreen window covering
//     the desktop already arrives here as `occluded`.
//   - no `powerSaver`: there is no single cross-desktop "power saver is on" flag;
//     upower gives us the battery state, which `onBattery` already carries.
// And one addition neither twin has: `hadFirstFrame`. See below.

enum class RenderState { Hidden, Frozen, Animating };

struct PolicyInputs {
    // false = nothing has been painted yet, so there is no frame to hold.
    // Freezing here is what made the macOS wallpaper a black sheet in v0.11.0:
    // "keep the last frame" without a last frame is an opaque rectangle over the
    // desktop picture. The X11 host can hit the same order — a wallpaper window
    // can be obscured before its WebView has finished loading.
    bool hadFirstFrame = true;
    bool occluded = false;       // GDK_VISIBILITY_FULLY_OBSCURED
    bool sessionLocked = false;
    bool displayOff = false;     // DPMS off
    bool onBattery = false;
    bool animateOnBattery = false;
    int acFps = 30;
    int batteryFps = 10;
};

struct PolicyDecision {
    RenderState state;
    int fps;  // 0 unless animating
};

PolicyDecision DecideRenderPolicy(const PolicyInputs& in);
