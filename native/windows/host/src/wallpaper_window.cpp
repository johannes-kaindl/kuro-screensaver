// Animated-wallpaper host (/w) — spec §5.
//
// Desktop hierarchy: Progman owns the wallpaper surface. The undocumented
// (but decade-stable) message 0x052C makes Progman spawn a WorkerW *behind*
// the icon layer (SHELLDLL_DefView); our windows become WS_CHILD children of
// that host so they render behind the icons but above the static wallpaper.
// Windows 11 24H2 moved the WorkerW directly under Progman — both strategies
// are tried, Progman itself is the last resort.

// initguid.h BEFORE windows.h — and only in this TU: DEFINE_GUID in winnt.h
// then *defines* GUID_CONSOLE_DISPLAY_STATE (declspec(selectany)) instead of
// declaring it extern, so no extra GUID lib is needed.
#include <initguid.h>

#include "wallpaper_window.h"

#include <windows.h>

#include <shellapi.h>
#include <wrl.h>
#include <wtsapi32.h>

#include <cstring>
#include <string>
#include <vector>

#include <WebView2.h>

#include "monitors.h"
#include "options.h"
#include "render_policy.h"
#include "tray.h"
#include "webview_host.h"

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr UINT_PTR kPollTimer = 1;
constexpr UINT kPollMs = 2000;  // battery/quiet-state/occlusion have no change broadcast

struct WallpaperWindow {
    HWND hwnd = nullptr;
    RECT monitorRect{};  // virtual-screen coords, for the occlusion check
    ICoreWebView2Controller* controller = nullptr;
    ICoreWebView2* webview = nullptr;  // AddRef'd, lives until process exit
    std::wstring lastPowerMsg;
    bool suspended = false;
};

// Leak intentionally: wallpaper windows live until process exit.
std::vector<WallpaperWindow*> g_windows;
bool g_paused = false;  // tray "anhalten" — overrides the power policy
bool g_sessionLocked = false;
bool g_displayOff = false;

HWND FindWallpaperHost() {
    HWND progman = FindWindowW(L"Progman", nullptr);
    if (!progman) return nullptr;
    // Ask Progman to spawn the wallpaper WorkerW.
    SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, SMTO_NORMAL, 1000, nullptr);
    // Strategy A (up to 23H2): the WorkerW sibling behind the icon layer.
    HWND workerw = nullptr;
    EnumWindows(
        [](HWND top, LPARAM lp) -> BOOL {
            if (FindWindowExW(top, nullptr, L"SHELLDLL_DefView", nullptr))
                *reinterpret_cast<HWND*>(lp) = FindWindowExW(nullptr, top, L"WorkerW", nullptr);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&workerw));
    if (workerw) return workerw;
    // Strategy B (24H2): the WorkerW lives directly under Progman.
    HWND child = FindWindowExW(progman, nullptr, L"WorkerW", nullptr);
    return child ? child : progman;
}

LRESULT CALLBACK WallpaperWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_SIZE) {
        auto* w = reinterpret_cast<WallpaperWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (w && w->controller) {
            RECT rc;
            GetClientRect(hwnd, &rc);
            w->controller->put_Bounds(rc);
        }
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// WallpaperScale registry value (raw string, validated), default 0.66 —
// replaces the saver's Scale in the wallpaper URL.
std::wstring WallpaperScale() {
    wchar_t buf[64];
    DWORD size = sizeof(buf);
    if (RegGetValueW(HKEY_CURRENT_USER, kRegPath, L"WallpaperScale", RRF_RT_REG_SZ, nullptr, buf,
                     &size) == ERROR_SUCCESS) {
        std::wstring v(buf);
        if (IsValidNumber(v, 0.25, 1)) return v;
    }
    return L"0.66";
}

// Wallpaper URL: audio forced off (no UI opt-in in v0.10), scale replaced by
// WallpaperScale, kiosk flag constant. Takes a copy on purpose.
std::wstring BuildWallpaperPage(SaverOptions o) {
    o.audio = false;
    o.scale = WallpaperScale();
    return L"screensaver.html" + BuildQueryString(o) + L"&kiosk=on";
}

// TrySuspend needs a hidden controller; failures are ignored on purpose (the
// page then merely idles behind a covered/off screen at frameCap null).
void SetSuspended(WallpaperWindow& w, bool suspend) {
    if (suspend == w.suspended) return;
    w.suspended = suspend;
    ComPtr<ICoreWebView2_3> wv3;
    if (w.webview) {
        ComPtr<ICoreWebView2> wv(w.webview);
        wv.As(&wv3);
    }
    if (suspend) {
        if (w.controller) w.controller->put_IsVisible(FALSE);
        if (wv3)
            wv3->TrySuspend(
                Callback<ICoreWebView2TrySuspendCompletedHandler>(
                    [](HRESULT, BOOL) -> HRESULT { return S_OK; })
                    .Get());
    } else {
        if (wv3) wv3->Resume();
        if (w.controller) w.controller->put_IsVisible(TRUE);
    }
}

// A monitor counts as occluded when the foreground window covers >= 95 % of
// its rect (fullscreen/maximised apps) — the desktop itself never counts.
bool MonitorOccluded(const RECT& mon) {
    HWND fg = GetForegroundWindow();
    if (!fg || IsIconic(fg) || !IsWindowVisible(fg)) return false;
    wchar_t cls[64] = L"";
    GetClassNameW(fg, cls, 64);
    if (wcscmp(cls, L"Progman") == 0 || wcscmp(cls, L"WorkerW") == 0) return false;
    RECT wr{}, inter{};
    if (!GetWindowRect(fg, &wr) || !IntersectRect(&inter, &wr, &mon)) return false;
    double monArea = double(mon.right - mon.left) * double(mon.bottom - mon.top);
    double cover = double(inter.right - inter.left) * double(inter.bottom - inter.top);
    return monArea > 0 && cover / monArea >= 0.95;
}

// Gathers the polled signals, decides per window and posts the power message
// on change. Ordering: resume BEFORE posting (a suspended page cannot react),
// suspend AFTER posting (the page should see power:hidden first).
void ApplyPowerStates(bool force) {
    if (g_paused) return;  // tray pause wins; resume re-applies with force
    SYSTEM_POWER_STATUS sps{};
    GetSystemPowerStatus(&sps);
    QUERY_USER_NOTIFICATION_STATE quns = QUNS_ACCEPTS_NOTIFICATIONS;
    SHQueryUserNotificationState(&quns);
    bool fullscreen = quns == QUNS_BUSY || quns == QUNS_RUNNING_D3D_FULL_SCREEN ||
                      quns == QUNS_PRESENTATION_MODE;

    for (WallpaperWindow* w : g_windows) {
        PolicyInputs in;
        in.occluded = MonitorOccluded(w->monitorRect);
        in.sessionLocked = g_sessionLocked;
        in.displayOff = g_displayOff;
        in.fullscreenApp = fullscreen;
        in.onBattery = sps.ACLineStatus == 0;
        in.powerSaver = sps.SystemStatusFlag == 1;
        in.animateOnBattery = false;  // fixed in v0.10 — no UI opt-in yet
        in.acFps = 30;
        in.batteryFps = 10;
        PolicyDecision d = DecideRenderPolicy(in);

        std::wstring msg = d.state == RenderState::Hidden   ? std::wstring(L"power:hidden")
                           : d.state == RenderState::Frozen ? std::wstring(L"power:frozen")
                                                            : L"power:animating:" +
                                                                  std::to_wstring(d.fps);
        if (!force && msg == w->lastPowerMsg) continue;
        w->lastPowerMsg = msg;

        bool toHidden = d.state == RenderState::Hidden;
        if (!toHidden) SetSuspended(*w, false);
        if (w->webview) w->webview->PostWebMessageAsString(msg.c_str());
        if (toHidden) SetSuspended(*w, true);
    }
}

// Tray hook: pause = hide + suspend, resume = back + re-applied power state.
void SetWallpaperPaused(bool paused) {
    g_paused = paused;
    for (WallpaperWindow* w : g_windows) {
        if (paused) {
            ShowWindow(w->hwnd, SW_HIDE);
            SetSuspended(*w, true);
        } else {
            SetSuspended(*w, false);
            ShowWindow(w->hwnd, SW_SHOW);
        }
    }
    if (!paused) ApplyPowerStates(true);
}

void CreateWallpaperWindow(HWND host, const RECT& screenRect, const std::wstring& page) {
    // Child coordinates are relative to the host's client area.
    POINT pts[2] = {{screenRect.left, screenRect.top}, {screenRect.right, screenRect.bottom}};
    MapWindowPoints(nullptr, host, pts, 2);
    HWND hwnd = CreateWindowExW(0, L"KuroWallpaperWindow", L"", WS_CHILD | WS_VISIBLE, pts[0].x,
                                pts[0].y, pts[1].x - pts[0].x, pts[1].y - pts[0].y, host, nullptr,
                                GetModuleHandleW(nullptr), nullptr);
    if (!hwnd) return;
    auto* w = new WallpaperWindow();
    w->hwnd = hwnd;
    w->monitorRect = screenRect;
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(w));
    g_windows.push_back(w);
    CreateWebView(hwnd, page, nullptr,  // kiosk page posts no messages
                  [w](ICoreWebView2Controller* c, ICoreWebView2* wv) {
                      w->controller = c;
                      wv->AddRef();  // kept for power messages until process exit
                      w->webview = wv;
                  });
}

// Session lock/unlock and display on/off arrive as notifications; the rest is
// polled every 2 s (WM_TIMER → ApplyPowerStates).
LRESULT CALLBACK PowerWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_TIMER:
            ApplyPowerStates(false);
            return 0;
        case WM_WTSSESSION_CHANGE:
            if (wp == WTS_SESSION_LOCK)
                g_sessionLocked = true;
            else if (wp == WTS_SESSION_UNLOCK)
                g_sessionLocked = false;
            ApplyPowerStates(false);
            return 0;
        case WM_POWERBROADCAST:
            if (wp == PBT_POWERSETTINGCHANGE && lp) {
                auto* setting = reinterpret_cast<POWERBROADCAST_SETTING*>(lp);
                if (IsEqualGUID(setting->PowerSetting, GUID_CONSOLE_DISPLAY_STATE) &&
                    setting->DataLength >= sizeof(DWORD)) {
                    DWORD state = 0;
                    memcpy(&state, setting->Data, sizeof(DWORD));
                    g_displayOff = state == 0;  // 0 off, 1 on, 2 dimmed
                    ApplyPowerStates(false);
                }
            }
            return TRUE;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int RunWallpaper() {
    HWND host = FindWallpaperHost();
    if (!host) return 1;

    WNDCLASSW wc{};
    wc.lpfnWndProc = WallpaperWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroWallpaperWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    SaverOptions opts = LoadOptions();
    std::vector<MonitorInfo> mons = EnumMonitors();
    if (mons.empty()) return 0;

    if (LoadMonitorMode(true) == L"span") {
        RECT vs{GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), 0, 0};
        vs.right = vs.left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        vs.bottom = vs.top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        CreateWallpaperWindow(host, vs, BuildWallpaperPage(opts));
    } else {
        for (const MonitorInfo& m : mons) {
            MonitorConfig c = LoadMonitorConfig(m.id);
            // Missing subkey: the primary monitor defaults to on, others off
            // (LoadMonitorConfig itself stays neutral — see monitors.h).
            std::wstring wmode = MonitorConfigExists(m.id)
                                     ? c.wmode
                                     : std::wstring(m.primary ? L"on" : L"off");
            if (wmode == L"off") continue;  // static wallpaper stays visible there
            SaverOptions per = opts;
            if (wmode == L"random")
                per.scene = L"random";
            else if (wmode == L"scene" && !c.wscene.empty())
                per.scene = c.wscene;
            if (!c.wpreset.empty()) per.preset = c.wpreset;
            CreateWallpaperWindow(host, m.rect, BuildWallpaperPage(per));
        }
    }

    // Power-signal sink: message-only window for the targeted notifications
    // plus the 2 s poll for everything without a change broadcast.
    WNDCLASSW pwc{};
    pwc.lpfnWndProc = PowerWndProc;
    pwc.hInstance = wc.hInstance;
    pwc.lpszClassName = L"KuroWallpaperPower";
    RegisterClassW(&pwc);
    HWND power = CreateWindowExW(0, L"KuroWallpaperPower", L"", 0, 0, 0, 0, 0, HWND_MESSAGE,
                                 nullptr, wc.hInstance, nullptr);
    HPOWERNOTIFY powerNotify = nullptr;
    if (power) {
        WTSRegisterSessionNotification(power, NOTIFY_FOR_THIS_SESSION);
        powerNotify = RegisterPowerSettingNotification(power, &GUID_CONSOLE_DISPLAY_STATE,
                                                       DEVICE_NOTIFY_WINDOW_HANDLE);
        SetTimer(power, kPollTimer, kPollMs, nullptr);
    }

    // Tray runs even when every monitor is off — settings/exit stay reachable.
    InitTray(SetWallpaperPaused);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    RemoveTray();
    if (power) {
        KillTimer(power, kPollTimer);
        if (powerNotify) UnregisterPowerSettingNotification(powerNotify);
        WTSUnRegisterSessionNotification(power);
        DestroyWindow(power);
    }
    // The WorkerW host outlives us — do not leave dead children behind.
    for (WallpaperWindow* w : g_windows) DestroyWindow(w->hwnd);
    return 0;
}
