#include "saver_window.h"

#include <windows.h>

#include <cstdlib>
#include <string>
#include <vector>

#include <WebView2.h>

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

BOOL CALLBACK MonitorEnum(HMONITOR, HDC, LPRECT rect, LPARAM lp) {
    reinterpret_cast<std::vector<RECT>*>(lp)->push_back(*rect);
    return TRUE;
}

}  // namespace

int RunSaver() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = SaverWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSaverWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    std::vector<RECT> monitors;
    EnumDisplayMonitors(nullptr, nullptr, MonitorEnum, reinterpret_cast<LPARAM>(&monitors));
    if (monitors.empty()) return 0;

    std::wstring page = L"screensaver.html" + BuildQueryString(LoadOptions());
    ShowCursor(FALSE);

    // States leak intentionally: the windows live until process exit — the
    // message loop ends via PostQuitMessage, never by destroying them one by one.
    for (const RECT& rc : monitors) {
        HWND hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, L"KuroSaverWindow", L"",
                                    WS_POPUP | WS_VISIBLE, rc.left, rc.top,
                                    rc.right - rc.left, rc.bottom - rc.top,
                                    nullptr, nullptr, wc.hInstance, nullptr);
        if (!hwnd) continue;
        auto* st = new SaverState();
        st->startTick = GetTickCount64();
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
        SetTimer(hwnd, kWatchTimer, 120, nullptr);
        CreateWebView(
            hwnd, page,
            [](const std::wstring&) { ExitSaver(); },  // engine close button (×)
            [st](ICoreWebView2Controller* c) { st->controller = c; });
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ShowCursor(TRUE);
    return 0;
}
