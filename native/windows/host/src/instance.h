#pragma once
#include <windows.h>

// Single-instance gate for the wallpaper app. Two wallpapers would stack two
// WorkerW children over each other (autostart + a manual start is the everyday
// case), each rendering a full WebView2 — invisible to the user, but double the
// GPU cost and a black desktop when one quits.

// True when this process acquired the instance slot. The mutex is held for the
// process lifetime — do NOT release it early. False means another instance owns
// the wallpaper; the caller should signal it and exit.
bool AcquireWallpaperInstance();

// Asks the running instance to show its settings window. Safe to call after
// AcquireWallpaperInstance() returned false.
void SignalExistingInstance();

// Registered window messages, shared by sender and receiver. Both return the
// same value in every process of the session (RegisterWindowMessageW).
UINT WallpaperShowSettingsMessage();
UINT WallpaperQuitMessage();

// Window class of the wallpaper's hidden tray window — the target of both
// messages, and how the uninstaller finds a running app.
inline constexpr const wchar_t* kTrayWindowClass = L"KuroTrayWindow";
