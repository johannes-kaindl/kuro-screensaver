#include "render_policy.h"

PolicyDecision DecideRenderPolicy(const PolicyInputs& in) {
    // Invisible → zero wakeups, regardless of everything else.
    if (in.occluded || in.sessionLocked || in.displayOff) return {RenderState::Hidden, 0};
    // A fullscreen/presentation app owns the GPU — keep the last frame still.
    if (in.fullscreenApp) return {RenderState::Frozen, 0};
    // Battery without opt-in and the system power saver both freeze.
    if ((in.onBattery && !in.animateOnBattery) || in.powerSaver) return {RenderState::Frozen, 0};
    return {RenderState::Animating, in.onBattery ? in.batteryFps : in.acFps};
}
