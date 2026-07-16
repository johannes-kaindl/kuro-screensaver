#include "tray.h"

#include <windows.h>

#include <shellapi.h>

#include <string>
#include <utility>

#include "settings_window.h"

namespace {

constexpr UINT kTrayMessage = WM_APP + 1;
constexpr UINT kTrayIconId = 1;
constexpr const wchar_t* kRunKeyPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
constexpr const wchar_t* kRunValueName = L"KuroWallpaper";

HWND g_trayWindow = nullptr;
bool g_paused = false;
std::function<void(bool)> g_setPaused;
// Broadcast by the shell when explorer.exe (re)starts — the icon must be
// re-added then, or the tray (pause/settings/exit) becomes unreachable.
UINT g_taskbarCreatedMsg = 0;

bool AddTrayIcon() {
    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_trayWindow;
    nid.uID = kTrayIconId;
    nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    nid.uCallbackMessage = kTrayMessage;
    nid.hIcon = LoadIconW(nullptr, IDI_APPLICATION);  // stock icon is enough for v0.10
    wcscpy_s(nid.szTip, L"Kuro Wallpaper");
    return Shell_NotifyIconW(NIM_ADD, &nid) != FALSE;
}

bool AutostartEnabled() {
    return RegGetValueW(HKEY_CURRENT_USER, kRunKeyPath, kRunValueName, RRF_RT_REG_SZ, nullptr,
                        nullptr, nullptr) == ERROR_SUCCESS;
}

void ToggleAutostart() {
    if (AutostartEnabled()) {
        RegDeleteKeyValueW(HKEY_CURRENT_USER, kRunKeyPath, kRunValueName);
        return;
    }
    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    std::wstring cmd = L"\"" + std::wstring(exe) + L"\" /w";
    RegSetKeyValueW(HKEY_CURRENT_USER, kRunKeyPath, kRunValueName, REG_SZ, cmd.c_str(),
                    static_cast<DWORD>((cmd.size() + 1) * sizeof(wchar_t)));
}

void ShowTrayMenu(HWND hwnd) {
    HMENU menu = CreatePopupMenu();
    if (!menu) return;
    AppendMenuW(menu, MF_STRING, IDM_TRAY_TOGGLE,
                g_paused ? L"Wallpaper fortsetzen" : L"Wallpaper anhalten");
    AppendMenuW(menu, MF_STRING, IDM_TRAY_SETTINGS, L"Einstellungen…");
    AppendMenuW(menu, MF_STRING | (AutostartEnabled() ? MF_CHECKED : MF_UNCHECKED),
                IDM_TRAY_AUTOSTART, L"Autostart");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, IDM_TRAY_EXIT, L"Beenden");
    // Classic tray quirk: without taking the foreground, the menu stays open
    // when the user clicks elsewhere.
    SetForegroundWindow(hwnd);
    POINT pt;
    GetCursorPos(&pt);
    TrackPopupMenu(menu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, nullptr);
    DestroyMenu(menu);
}

LRESULT CALLBACK TrayWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    // Explorer restart: NIM_ADD state is gone with the old taskbar.
    if (g_taskbarCreatedMsg && msg == g_taskbarCreatedMsg) {
        AddTrayIcon();
        return 0;
    }
    switch (msg) {
        case kTrayMessage:  // NIF_MESSAGE callback: lParam is the mouse message
            if (static_cast<UINT>(lp) == WM_RBUTTONUP || static_cast<UINT>(lp) == WM_LBUTTONUP)
                ShowTrayMenu(hwnd);
            return 0;
        case WM_COMMAND:
            switch (LOWORD(wp)) {
                case IDM_TRAY_TOGGLE:
                    g_paused = !g_paused;
                    if (g_setPaused) g_setPaused(g_paused);
                    break;
                case IDM_TRAY_SETTINGS:
                    // Non-modal: RunWallpaper's message loop dispatches for it.
                    OpenSettingsWindow();
                    break;
                case IDM_TRAY_AUTOSTART:
                    ToggleAutostart();
                    break;
                case IDM_TRAY_EXIT:
                    PostQuitMessage(0);
                    break;
            }
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

bool InitTray(std::function<void(bool paused)> setPaused) {
    g_setPaused = std::move(setPaused);
    g_paused = false;
    g_taskbarCreatedMsg = RegisterWindowMessageW(L"TaskbarCreated");

    WNDCLASSW wc{};
    wc.lpfnWndProc = TrayWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroTrayWindow";
    RegisterClassW(&wc);

    // Hidden top-level window (NOT message-only): TrackPopupMenu needs a
    // window that can take the foreground, and the "TaskbarCreated"
    // broadcast only reaches top-level windows.
    g_trayWindow = CreateWindowExW(0, L"KuroTrayWindow", L"", 0, 0, 0, 0, 0, nullptr, nullptr,
                                   wc.hInstance, nullptr);
    if (!g_trayWindow) return false;

    if (!AddTrayIcon()) {
        DestroyWindow(g_trayWindow);
        g_trayWindow = nullptr;
        return false;
    }
    return true;
}

void RemoveTray() {
    if (!g_trayWindow) return;
    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_trayWindow;
    nid.uID = kTrayIconId;
    Shell_NotifyIconW(NIM_DELETE, &nid);
    DestroyWindow(g_trayWindow);
    g_trayWindow = nullptr;
    g_setPaused = nullptr;
}
