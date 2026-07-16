#include "saver_window.h"

#include <windows.h>

#include <cstdlib>
#include <string>
#include <vector>

#include <WebView2.h>

#include "monitors.h"
#include "options.h"
#include "webview_host.h"

namespace {

constexpr UINT_PTR kWatchTimer = 1;
constexpr ULONGLONG kGraceMs = 1000;  // ignore the keypress that launched us
constexpr int kMouseThreshold = 10;   // px, same as the C# host

// The WebView grabs keyboard/mouse focus, so window events never arrive —
// poll global input instead (same approach and constants as the C# host).
struct SaverState {
    POINT origin{};
    bool haveOrigin = false;
    ULONGLONG startTick = 0;
    ICoreWebView2Controller* controller = nullptr;
};

bool g_exiting = false;

void ExitSaver() {
    if (g_exiting) return;
    g_exiting = true;
    PostQuitMessage(0);
}

LRESULT CALLBACK SaverWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    auto* st = reinterpret_cast<SaverState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (msg) {
        case WM_TIMER: {
            if (!st || GetTickCount64() - st->startTick < kGraceMs) return 0;
            POINT p;
            if (GetCursorPos(&p)) {
                if (!st->haveOrigin) {
                    st->origin = p;
                    st->haveOrigin = true;
                } else if (abs(p.x - st->origin.x) > kMouseThreshold ||
                           abs(p.y - st->origin.y) > kMouseThreshold) {
                    ExitSaver();
                    return 0;
                }
            }
            for (int vk = 0x08; vk <= 0xFE; ++vk) {
                if (GetAsyncKeyState(vk) & 0x8000) {
                    ExitSaver();
                    return 0;
                }
            }
            return 0;
        }
        case WM_SIZE:
            if (st && st->controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                st->controller->put_Bounds(rc);
            }
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// screensaver.html URL for the (possibly per-monitor overridden) options.
// kiosk=on is a constant URL flag — UI-less engine mode, never persisted.
std::wstring BuildSaverPage(const SaverOptions& o) {
    return L"screensaver.html" + BuildQueryString(o) + L"&kiosk=on";
}

// Fullscreen popup + input watchdog. State leaks intentionally: saver windows
// live until process exit — the message loop ends via PostQuitMessage, never
// by destroying them one by one.
HWND CreateSaverWindow(const RECT& rc) {
    HWND hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, L"KuroSaverWindow", L"",
                                WS_POPUP | WS_VISIBLE, rc.left, rc.top, rc.right - rc.left,
                                rc.bottom - rc.top, nullptr, nullptr, GetModuleHandleW(nullptr),
                                nullptr);
    if (!hwnd) return nullptr;
    auto* st = new SaverState();
    st->startTick = GetTickCount64();
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
    SetTimer(hwnd, kWatchTimer, 120, nullptr);
    return hwnd;
}

void CreateSaverWindowWithWebView(const RECT& rc, const std::wstring& page) {
    HWND hwnd = CreateSaverWindow(rc);
    if (!hwnd) return;
    auto* st = reinterpret_cast<SaverState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    CreateWebView(
        hwnd, page, [](const std::wstring&) { ExitSaver(); },  // engine close button (×)
        [st](ICoreWebView2Controller* c, ICoreWebView2*) { st->controller = c; });
}

// Monitors set to "off": same window class, same input watchdog (input on any
// monitor still ends the saver), no WebView — the class brush covers black.
void CreateBlackCoverWindow(const RECT& rc) { CreateSaverWindow(rc); }

}  // namespace

int RunSaver() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = SaverWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSaverWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    SaverOptions opts = LoadOptions();
    std::vector<MonitorInfo> mons = EnumMonitors();
    if (mons.empty()) return 0;
    bool span = LoadMonitorMode(false) == L"span";
    ShowCursor(FALSE);

    if (span) {
        // One window across the whole virtual screen: one WebView, one timer.
        RECT vs{GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), 0, 0};
        vs.right = vs.left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        vs.bottom = vs.top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        CreateSaverWindowWithWebView(vs, BuildSaverPage(opts));
    } else {
        for (const MonitorInfo& m : mons) {
            MonitorConfig c = LoadMonitorConfig(m.id);
            if (c.mode == L"off") {
                CreateBlackCoverWindow(m.rect);  // watchdog yes, WebView no
                continue;
            }
            SaverOptions per = opts;
            if (c.mode == L"random")
                per.scene = L"random";
            else if (c.mode == L"scene" && !c.scene.empty())
                per.scene = c.scene;
            if (!c.preset.empty()) per.preset = c.preset;
            CreateSaverWindowWithWebView(m.rect, BuildSaverPage(per));
        }
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ShowCursor(TRUE);
    return 0;
}
