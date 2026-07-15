#include "settings_window.h"

#include <windows.h>

#include <string>

#include <WebView2.h>

#include "options.h"
#include "webview_host.h"

namespace {

ICoreWebView2Controller* g_controller = nullptr;

LRESULT CALLBACK SettingsWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;
        case WM_DESTROY:
            if (g_controller) {
                g_controller->Release();
                g_controller = nullptr;
            }
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int RunSettings() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = SettingsWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSettingsWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);

    // 440×560 client area, centred on the primary work area.
    RECT desired{0, 0, 440, 560};
    AdjustWindowRect(&desired, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, FALSE);
    int w = desired.right - desired.left;
    int h = desired.bottom - desired.top;
    RECT wa{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);

    HWND hwnd = CreateWindowExW(0, L"KuroSettingsWindow", L"Kuro Screensaver",
                                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
                                wa.left + ((wa.right - wa.left) - w) / 2,
                                wa.top + ((wa.bottom - wa.top) - h) / 2, w, h,
                                nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return 0;

    CreateWebView(
        hwnd, L"settings.html" + BuildQueryString(LoadOptions()),
        [hwnd](const std::wstring& message) {
            if (message == L"cancel") {
                DestroyWindow(hwnd);
                return;
            }
            if (message.rfind(L"save:", 0) == 0) {
                SaverOptions o = LoadOptions();
                if (ParseSaveMessage(message.substr(5), o)) SaveOptions(o);
                DestroyWindow(hwnd);
            }
        },
        [](ICoreWebView2Controller* c) { g_controller = c; });

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
