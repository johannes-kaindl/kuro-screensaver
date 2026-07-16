#pragma once

// Pure decision table for the wallpaper's power/visibility policy — a port of
// native/macos/KuroNativeSaver/Core/RenderPolicy.swift minus the thermal
// signals (no clean Win32 equivalent). Deliberately free of Win32 includes:
// the wallpaper host gathers the signals and applies the result per window,
// options_test covers the table headlessly.
// Priority: invisibility → fullscreen app → battery/power-saver preference →
// normal animation.

enum class RenderState { Hidden, Frozen, Animating };

struct PolicyInputs {
    bool occluded = false;       // monitor covered by a fullscreen/maximized window
    bool sessionLocked = false;
    bool displayOff = false;
    bool fullscreenApp = false;  // SHQueryUserNotificationState busy/D3D/presentation
    bool onBattery = false;
    bool powerSaver = false;     // Windows battery-saver mode
    bool animateOnBattery = false;
    int acFps = 30;
    int batteryFps = 10;
};

struct PolicyDecision {
    RenderState state;
    int fps;  // 0 unless animating
};

PolicyDecision DecideRenderPolicy(const PolicyInputs& in);
