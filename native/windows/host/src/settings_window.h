#pragma once
#include <windows.h>

// Configuration dialog (/c and the tray's "Einstellungen…"): a host window
// loading settings.html from the web bundle with the full v0.10 option set,
// the monitor mode and the enumerated monitor list (incl. each monitor's
// existing saver config). The page posts "save:<query>" or "cancel" back;
// save is validated by ParseSaveMessage and persisted to HKCU all-or-nothing.
// On reject the host answers "saveerror" and the dialog stays open.

// Creates the dialog window + WebView WITHOUT running a message loop — the
// caller's loop (e.g. RunWallpaper's) dispatches for it. Re-invoking while
// the dialog is open just brings it to the foreground. Returns the window,
// nullptr on failure.
HWND OpenSettingsWindow();

// Modal variant for the .scr /c path: OpenSettingsWindow + a message loop
// that runs until the dialog window is destroyed.
int RunSettings();
