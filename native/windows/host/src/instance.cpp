#include "instance.h"

namespace {
HANDLE g_instanceMutex = nullptr;
}  // namespace

bool AcquireWallpaperInstance() {
    // Local\ scope: per session, so a second user on the same machine gets their
    // own wallpaper. Created before the check — GetLastError tells us whether we
    // are the owner or a latecomer.
    g_instanceMutex = CreateMutexW(nullptr, TRUE, L"Local\\KuroWallpaper.Instance");
    if (!g_instanceMutex) return true;  // can't tell → let it run, worst case is v0.10 behaviour
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        CloseHandle(g_instanceMutex);
        g_instanceMutex = nullptr;
        return false;
    }
    return true;
}

void SignalExistingInstance() {
    if (HWND tray = FindWindowW(kTrayWindowClass, nullptr))
        PostMessageW(tray, WallpaperShowSettingsMessage(), 0, 0);
}

UINT WallpaperShowSettingsMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.ShowSettings");
    return msg;
}

UINT WallpaperQuitMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.Quit");
    return msg;
}
