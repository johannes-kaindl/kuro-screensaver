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

// Asks the running instance to show its settings window. Call after
// AcquireWallpaperInstance() returned false. BLOCKS for up to 5 s: the winner
// creates its tray window late in startup, and giving up early would silently
// drop the request. Returns as soon as the message is posted, or when the wait
// runs out. Never call this for /silent — the autostart losing the race must not
// force a window open (main.cpp).
void SignalExistingInstance();

// Registered window messages, shared by sender and receiver. Both return the
// same value in every process of the session (RegisterWindowMessageW).
UINT WallpaperShowSettingsMessage();
UINT WallpaperQuitMessage();

// Window class of the wallpaper's hidden tray window — the target of both
// messages, and how the uninstaller finds a running app.
inline constexpr const wchar_t* kTrayWindowClass = L"KuroTrayWindow";

// Rewrites a v0.10 autostart value ("<dir>\KuroScreensaver.scr" /w) to the new
// app ("<dir>\KuroWallpaper.exe" /silent). Without it Windows keeps launching
// the .scr after an update: that still paints a wallpaper, but the settings
// window is unreachable from it. Only touches a value that points at our own
// .scr, and never creates one. The path parameter exists for the tests.
void MigrateAutostartKey(
    const wchar_t* runKeyPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run");
