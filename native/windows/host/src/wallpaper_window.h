#pragma once

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
