#pragma once
#include <windows.h>

// Configuration dialog (/c and the tray's "Einstellungen…"): a host window
// loading settings.html from the web bundle with the full v0.10 option set,
// the monitor mode and the enumerated monitor list (incl. each monitor's
// existing saver config). The page posts "save:<query>", "autostart:on|off" or
// "cancel" back; save is validated by ParseSaveMessage + ParseWallpaperSaveMessage
// and persisted to HKCU all-or-nothing. On reject the host answers "saveerror"
// and the dialog stays open.
//
// v0.11: the page has two tabs and one save carries both option sets — the
// saver's keys and the wallpaper's wp-prefixed ones — which the host writes to
// two separate registry keys (spec §5.2).

// Creates the dialog window + WebView WITHOUT running a message loop — the
// caller's loop (e.g. RunWallpaper's) dispatches for it. Re-invoking while
// the dialog is open just brings it to the foreground. Returns the window,
// nullptr on failure.
//
// openOnWallpaperTab picks the initially active tab: true for everything the
// wallpaper app opens (tray, start-menu click), false for the screensaver's /c
// path — whoever opened the dialog knows which half the user came for.
HWND OpenSettingsWindow(bool openOnWallpaperTab);

// Modal variant for the .scr /c path: OpenSettingsWindow + a message loop
// that runs until the dialog window is destroyed.
int RunSettings();
