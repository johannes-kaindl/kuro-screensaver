#include "preview_window.h"

#include <string>

#include <WebView2.h>

#include "options.h"
#include "webview_host.h"

namespace {

ICoreWebView2Controller* g_controller = nullptr;

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
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

int RunPreview(HWND parent) {
    RECT rc{};
    GetClientRect(parent, &rc);

    WNDCLASSW wc{};
    wc.lpfnWndProc = PreviewWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroPreviewWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, L"KuroPreviewWindow", L"", WS_CHILD | WS_VISIBLE, 0, 0,
                                max(rc.right - rc.left, 1L), max(rc.bottom - rc.top, 1L),
                                parent, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return 0;

    CreateWebView(hwnd, L"screensaver.html" + BuildQueryString(LoadOptions()), nullptr,
                  [](ICoreWebView2Controller* c) { g_controller = c; });

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
