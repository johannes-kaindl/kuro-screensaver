#pragma once

#include <string>

// Animated wallpaper mode (/w): WebView windows parented into the desktop's
// WorkerW layer (behind the icons, above the static wallpaper), one per
// monitor or one spanning window (WallpaperMonitorMode), with a tray icon
// (tray.h) and the render_policy.h power table driven by session/power/
// occlusion signals — power:hidden|frozen|animating:<fps> WebMessages plus
// TrySuspend when hidden. Returns when the tray's "Beenden" quits the loop.
//
// showSettings opens the settings window right away — a start-menu click wants
// to see something. The autostart path (/silent) passes false and stays a tray
// icon only.
int RunWallpaper(bool showSettings);

// "<covered>/<attached>" for the dialog's status block, e.g. L"2/3"; empty when
// no wallpaper runs in this process — the dialog can also come from the
// screensaver's /c path, where the honest answer is "nothing runs".
std::wstring WallpaperRunStatus();

// Re-navigates every running wallpaper WebView to a freshly built query, so a
// save from the dialog is visible at once — the desktop IS the wallpaper tab's
// preview (spec §5.3). No-op when no wallpaper runs; the saved values then
// simply apply at the next start.
void ReloadWallpaper();
