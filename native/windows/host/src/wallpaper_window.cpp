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
#include "settings_window.h"
#include "tray.h"
#include "wallpaper_options.h"
#include "webview_host.h"

namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

constexpr UINT_PTR kPollTimer = 1;
constexpr UINT kPollMs = 2000;  // battery/quiet-state/occlusion have no change broadcast
// WebView/page startup race: the WebView2 controller and the page's message
// listener come up asynchronously, so early power messages can be swallowed.
// For this long after window creation every poll re-posts the current policy
// message (idempotent page-side) instead of deduplicating.
constexpr ULONGLONG kStartupReplayMs = 15000;

struct WallpaperWindow {
    HWND hwnd = nullptr;
    RECT monitorRect{};  // virtual-screen coords, for the occlusion check
    // Which monitor's overrides this window renders; empty = the span window,
    // which has none. Kept so ReloadWallpaper can rebuild the SAME page a
    // restart would build, instead of flattening every screen to the globals.
    std::wstring monitorId;
    bool primary = false;
    ICoreWebView2Controller* controller = nullptr;
    ICoreWebView2* webview = nullptr;  // AddRef'd, lives until process exit
    std::wstring lastPowerMsg;
    bool suspended = false;
    ULONGLONG createdTick = 0;  // GetTickCount64 stamp — see kStartupReplayMs
};

// Leak intentionally: wallpaper windows live until process exit.
std::vector<WallpaperWindow*> g_windows;
// Monitors the wallpaper actually covers — NOT g_windows.size(): one spanning
// window covers them all, and "1/3" would be a lie in span mode.
size_t g_coveredMonitors = 0;
HWND g_host = nullptr;  // WorkerW/Progman host — re-resolved after explorer restarts
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

// Wallpaper URL: audio forced off (spec §4.1 — the dialog greys the switch out
// with that reason, this is what makes the reason true), kiosk flag constant.
// Scale is NOT overridden here any more: it is a normal field of the wallpaper's
// own option set, and the legacy WallpaperScale key is inherited once on load
// (LoadWallpaperOptions). Overriding it here would beat the tab's own slider.
// Takes a copy on purpose.
std::wstring BuildWallpaperPage(SaverOptions o) {
    o.audio = false;
    return L"screensaver.html" + BuildQueryString(o) + L"&kiosk=on";
}

// Folds one monitor's wallpaper overrides into the global set. Shared by the
// initial creation and the live reload — two copies of this rule would let a
// saved change render differently than the same values do after a restart.
// Returns false when this monitor shows no wallpaper at all.
bool ApplyMonitorOverrides(const std::wstring& id, bool primary, SaverOptions& o) {
    MonitorConfig c = LoadMonitorConfig(id);
    // WMode never set (empty sentinel — see monitors.h): the primary monitor
    // defaults to on, others off. A saver-dialog save may have materialized the
    // subkey without ever touching WMode.
    std::wstring wmode = EffectiveWallpaperMode(c.wmode, primary);
    if (wmode == L"off") return false;  // static wallpaper stays visible there
    if (wmode == L"random")
        o.scene = L"random";
    else if (wmode == L"scene" && !c.wscene.empty())
        o.scene = c.wscene;
    if (!c.wpreset.empty()) o.preset = c.wpreset;
    return true;
}

// TrySuspend needs a hidden controller; failures are ignored on purpose (the
// page then merely idles behind a covered/off screen at frameCap null).
void SetSuspended(WallpaperWindow& w, bool suspend) {
    if (suspend == w.suspended) return;
    // Creation race: nothing to act on yet — do not latch the flag, or the
    // real suspend would be skipped once the WebView exists.
    if (!w.controller && !w.webview) return;
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
        // The dedupe only kicks in once the window is past the startup replay
        // phase (kStartupReplayMs) — before that the WebView/page may not have
        // existed when lastPowerMsg was recorded, so the message is re-posted
        // every poll tick. A successfully suspended window already received
        // its message (suspend happens after the post), so it may skip too —
        // re-posting would resume the suspended WebView.
        bool settled = GetTickCount64() - w->createdTick >= kStartupReplayMs;
        if (!force && (settled || w->suspended) && msg == w->lastPowerMsg) continue;
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

// Explorer restart: the WorkerW host (owned by explorer.exe) dies with it and
// our children end up orphaned. Detected in the 2 s poll — re-resolve the
// fresh host, re-parent every surviving window and re-map its position.
void ReattachIfHostLost() {
    if (g_host && IsWindow(g_host)) return;
    HWND host = FindWallpaperHost();
    if (!host) return;  // explorer still coming up — retry on the next poll
    g_host = host;
    for (WallpaperWindow* w : g_windows) {
        if (!IsWindow(w->hwnd)) continue;  // died with the old host
        SetParent(w->hwnd, host);
        POINT pts[2] = {{w->monitorRect.left, w->monitorRect.top},
                        {w->monitorRect.right, w->monitorRect.bottom}};
        MapWindowPoints(nullptr, host, pts, 2);
        SetWindowPos(w->hwnd, nullptr, pts[0].x, pts[0].y, pts[1].x - pts[0].x,
                     pts[1].y - pts[0].y, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

void CreateWallpaperWindow(HWND host, const RECT& screenRect, const std::wstring& page,
                           const std::wstring& monitorId = L"", bool primary = false) {
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
    w->monitorId = monitorId;
    w->primary = primary;
    w->createdTick = GetTickCount64();
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
            ReattachIfHostLost();  // explorer restart tears the WorkerW down
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

void ReloadWallpaper() {
    // g_windows is empty when the dialog came from the saver's /c path — then
    // this is a no-op and the saved values simply apply at the next start.
    SaverOptions base = LoadWallpaperOptions();
    for (WallpaperWindow* w : g_windows) {
        if (!w->webview) continue;  // WebView still being created — it will pick up the new values
        SaverOptions o = base;
        // Per-monitor windows keep their own overrides; the span window (empty
        // id) has none. A monitor switched to off cannot lose its window here —
        // creating and destroying windows mid-flight is a restart's job — so it
        // simply renders the globals until then.
        if (!w->monitorId.empty()) ApplyMonitorOverrides(w->monitorId, w->primary, o);
        std::wstring url = WebPageUrl(BuildWallpaperPage(o));
        w->webview->Navigate(url.c_str());
        // A reload IS the startup race again: the new page builds its message
        // listener asynchronously and starts out animating at the engine default.
        // Without re-arming the replay window, the next poll would find the old
        // createdTick (settled) and the stale lastPowerMsg equal to the current
        // policy, dedupe it away, and the fresh page would never hear e.g.
        // power:frozen — animating on battery until the power state happens to
        // change. Every save would silently undo the v0.8 efficiency work.
        w->createdTick = GetTickCount64();
        w->lastPowerMsg.clear();
    }
}

std::wstring WallpaperRunStatus() {
    // Nothing running is not "0/3": the dialog says "Wallpaper läuft nicht" for
    // the empty string, which is the honest answer on the saver's /c path.
    if (g_windows.empty()) return L"";
    return std::to_wstring(g_coveredMonitors) + L"/" + std::to_wstring(EnumMonitors().size());
}

int RunWallpaper(bool showSettings) {
    HWND host = FindWallpaperHost();
    if (!host) return 1;
    g_host = host;  // watched by ReattachIfHostLost (explorer restarts)

    WNDCLASSW wc{};
    wc.lpfnWndProc = WallpaperWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroWallpaperWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    // The wallpaper's own set, not the saver's — the wallpaper tab of the
    // dialog would otherwise have no effect at all (spec §4).
    SaverOptions opts = LoadWallpaperOptions();
    std::vector<MonitorInfo> mons = EnumMonitors();
    if (mons.empty()) return 0;

    if (LoadMonitorMode(true) == L"span") {
        RECT vs{GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), 0, 0};
        vs.right = vs.left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        vs.bottom = vs.top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        CreateWallpaperWindow(host, vs, BuildWallpaperPage(opts));
        g_coveredMonitors = mons.size();  // one window, every screen
    } else {
        for (const MonitorInfo& m : mons) {
            SaverOptions per = opts;
            if (!ApplyMonitorOverrides(m.id, m.primary, per)) continue;
            CreateWallpaperWindow(host, m.rect, BuildWallpaperPage(per), m.id, m.primary);
            ++g_coveredMonitors;
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

    // Start-menu click: show the window immediately. Autostart (/silent) skips
    // this — a window popping up at every login is exactly what nobody wants.
    // After InitTray on purpose: the dialog is non-modal and the loop below
    // dispatches for it, so the tray must exist first.
    if (showSettings) OpenSettingsWindow(true);

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
