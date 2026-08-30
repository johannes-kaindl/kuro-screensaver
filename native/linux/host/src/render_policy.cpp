#include "render_policy.h"

PolicyDecision DecideRenderPolicy(const PolicyInputs& in) {
    // Before anything else: with no frame painted yet there is nothing to hold
    // still and nothing to show. Both stopping states would leave an opaque
    // rectangle over the desktop — the macOS v0.11.0 bug, one storey down.
    if (!in.hadFirstFrame) return {RenderState::Animating, in.acFps};
    // Invisible → zero wakeups, regardless of everything else. Same order as
    // the Windows twin and Core/RenderPolicy.swift: a held frame nobody can see
    // costs the same as an animated one and buys nothing.
    if (in.occluded || in.sessionLocked || in.displayOff) return {RenderState::Hidden, 0};
    // Visible on battery: freeze unless the user opted in, then throttle.
    if (in.onBattery && !in.animateOnBattery) return {RenderState::Frozen, 0};
    return {RenderState::Animating, in.onBattery ? in.batteryFps : in.acFps};
}
