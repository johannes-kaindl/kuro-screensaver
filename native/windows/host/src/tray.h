#pragma once

#include <functional>

// System-tray icon + context menu for the /w wallpaper mode.
// Menu command ids (v0.10 plan, task 11):
inline constexpr unsigned int IDM_TRAY_TOGGLE = 1;     // Wallpaper anhalten/fortsetzen
inline constexpr unsigned int IDM_TRAY_SETTINGS = 2;   // Einstellungen… (non-modal dialog)
inline constexpr unsigned int IDM_TRAY_AUTOSTART = 3;  // Run key KuroWallpaper = "<exe>" /w
inline constexpr unsigned int IDM_TRAY_EXIT = 4;       // PostQuitMessage → RunWallpaper returns

// Creates a hidden tray window plus the "Kuro Wallpaper" notification icon.
// `setPaused` hides+suspends (true) or resumes+shows (false) the wallpaper
// windows; the tray owns the toggle state and the autostart Run-key checkbox.
// Returns false when the icon cannot be added.
bool InitTray(std::function<void(bool paused)> setPaused);

// Removes the icon and destroys the tray window (call before leaving
// RunWallpaper's message loop scope).
void RemoveTray();
