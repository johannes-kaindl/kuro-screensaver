#include "instance.h"

#include <string>

#include "options.h"

namespace {
HANDLE g_instanceMutex = nullptr;
// How long a losing instance waits for the winner's tray window to appear, and
// how often it looks. 5 s covers a cold WebView2 start on a slow disk; the poll
// is coarse because this runs at most once per launch.
constexpr int kSignalTimeoutMs = 5000;
constexpr int kSignalPollMs = 100;
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
    // The winner takes its time before InitTray: FindWallpaperHost alone can
    // block a full second, then EnumMonitors and CreateWebView follow. A second
    // start landing in that gap would find no window, post nothing and exit —
    // the user's Start-menu click would do nothing at all. So poll for the tray
    // instead of looking once.
    for (int waited = 0; waited < kSignalTimeoutMs; waited += kSignalPollMs) {
        if (HWND tray = FindWindowW(kTrayWindowClass, nullptr)) {
            PostMessageW(tray, WallpaperShowSettingsMessage(), 0, 0);
            return;
        }
        Sleep(kSignalPollMs);
    }
    // Bounded: the winner may be wedged or dying. Exiting quietly is better than
    // hanging a process the user cannot see.
}

UINT WallpaperShowSettingsMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.ShowSettings");
    return msg;
}

UINT WallpaperQuitMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.Quit");
    return msg;
}

void MigrateAutostartKey(const wchar_t* runKeyPath) {
    std::wstring cur = ReadReg(runKeyPath, L"KuroWallpaper", L"");
    if (cur.empty()) return;                                             // never create one
    if (cur.find(L"KuroScreensaver.scr") == std::wstring::npos) return;  // not ours

    // Swap the filename in place: the install directory is the user's choice and
    // survives an update, so re-deriving it from our own module path would be
    // wrong for a value written by a differently-located install.
    size_t pos = cur.find(L"KuroScreensaver.scr");
    std::wstring next = cur.substr(0, pos) + L"KuroWallpaper.exe";
    size_t closing = cur.find(L'"', pos);
    if (closing != std::wstring::npos) next += L"\"";
    next += L" /silent";
    WriteReg(runKeyPath, L"KuroWallpaper", next);
}
