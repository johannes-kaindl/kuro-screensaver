#include "settings_window.h"

#include <windows.h>

#include <string>
#include <vector>

#include <WebView2.h>

#include "monitors.h"
#include "options.h"
#include "webview_host.h"

namespace {

// Per-window state (GWLP_USERDATA): the controller reference owned by the
// window plus the raw webview kept AddRef'd for "saveerror" replies while the
// dialog stays open after a rejected save. Both released in WM_DESTROY.
struct SettingsState {
    ICoreWebView2Controller* controller = nullptr;
    ICoreWebView2* webview = nullptr;
};

SettingsState* StateOf(HWND hwnd) {
    return reinterpret_cast<SettingsState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
}

// No PostQuitMessage here: the tray path shares this window on the wallpaper
// message loop — RunSettings watches the window handle instead.
LRESULT CALLBACK SettingsWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (SettingsState* st = StateOf(hwnd); st && st->controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                st->controller->put_Bounds(rc);
            }
            return 0;
        case WM_DESTROY:
            if (SettingsState* st = StateOf(hwnd)) {
                if (st->webview) st->webview->Release();
                if (st->controller) st->controller->Release();
                delete st;
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

std::wstring JsonEscape(const std::wstring& s) {
    std::wstring out;
    out.reserve(s.size());
    for (wchar_t c : s) {
        if (c == L'"' || c == L'\\') out += L'\\';
        out += c;
    }
    return out;
}

// Hand-built JSON for the `monitors=` query param. Carries the EXISTING
// per-monitor saver config (mode/scene/preset from LoadMonitorConfig; missing
// subkey → its defaults "on"/""/"") so the dialog starts from it — an
// untouched save must not reset other monitors (data-loss guard).
std::wstring MonitorListJson(const std::vector<MonitorInfo>& mons) {
    std::wstring json = L"[";
    for (size_t i = 0; i < mons.size(); ++i) {
        const MonitorInfo& m = mons[i];
        MonitorConfig c = LoadMonitorConfig(m.id);
        if (i) json += L',';
        json += L"{\"id\":\"" + JsonEscape(m.id) + L"\"";
        json += L",\"name\":\"" + JsonEscape(m.name) + L"\"";
        json += L",\"w\":" + std::to_wstring(m.rect.right - m.rect.left);
        json += L",\"h\":" + std::to_wstring(m.rect.bottom - m.rect.top);
        json += std::wstring(L",\"portrait\":") + (m.portrait ? L"true" : L"false");
        json += std::wstring(L",\"primary\":") + (m.primary ? L"true" : L"false");
        json += L",\"mode\":\"" + JsonEscape(c.mode) + L"\"";
        json += L",\"scene\":\"" + JsonEscape(c.scene) + L"\"";
        json += L",\"preset\":\"" + JsonEscape(c.preset) + L"\"}";
    }
    return json + L"]";
}

void HandleWebMessage(HWND hwnd, const std::wstring& message) {
    if (message == L"cancel") {
        DestroyWindow(hwnd);
        return;
    }
    if (message.rfind(L"save:", 0) != 0) return;

    SaverOptions o = LoadOptions();
    std::vector<MonitorSave> mons;
    std::wstring mode;
    if (!ParseSaveMessage(message.substr(5), o, &mons, &mode)) {
        // All-or-nothing reject: tell the page, keep the dialog open.
        if (SettingsState* st = StateOf(hwnd); st && st->webview)
            st->webview->PostWebMessageAsString(L"saveerror");
        return;
    }
    SaveOptions(o);
    if (!mode.empty()) SaveMonitorMode(false, mode);
    for (const MonitorSave& m : mons) {
        // Replace only the saver trio — the wallpaper's WMode/WScene/WPreset
        // in the same subkey must survive a saver-dialog save untouched.
        MonitorConfig c = LoadMonitorConfig(m.id);
        c.mode = m.mode;
        c.scene = m.scene;
        c.preset = m.preset;
        SaveMonitorConfig(m.id, c);
    }
    DestroyWindow(hwnd);
}

}  // namespace

HWND OpenSettingsWindow() {
    // The tray can re-trigger this while the dialog is open — focus it instead
    // of stacking a second one.
    if (HWND existing = FindWindowW(L"KuroSettingsWindow", nullptr)) {
        SetForegroundWindow(existing);
        return existing;
    }

    WNDCLASSW wc{};
    wc.lpfnWndProc = SettingsWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSettingsWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);  // ERROR_CLASS_ALREADY_EXISTS on reopen is harmless

    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
    HWND hwnd = CreateWindowExW(0, L"KuroSettingsWindow", L"Kuro Screensaver", style,
                                CW_USEDEFAULT, CW_USEDEFAULT, 720, 640, nullptr, nullptr,
                                wc.hInstance, nullptr);
    if (!hwnd) return nullptr;

    // 720×640 client area, scaled to the window's actual DPI and re-centred
    // on the primary work area (per-monitor-aware process → physical pixels).
    UINT dpi = GetDpiForWindow(hwnd);
    if (dpi == 0) dpi = 96;
    RECT desired{0, 0, MulDiv(720, dpi, 96), MulDiv(640, dpi, 96)};
    AdjustWindowRectExForDpi(&desired, style, FALSE, 0, dpi);
    int w = desired.right - desired.left;
    int h = desired.bottom - desired.top;
    RECT wa{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
    SetWindowPos(hwnd, nullptr, wa.left + ((wa.right - wa.left) - w) / 2,
                 wa.top + ((wa.bottom - wa.top) - h) / 2, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    ShowWindow(hwnd, SW_SHOW);

    auto* st = new SettingsState();
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));

    std::wstring page = L"settings.html" + BuildQueryString(LoadOptions()) +
                        L"&monitormode=" + LoadMonitorMode(false) +
                        L"&monitors=" + EscapeDataString(MonitorListJson(EnumMonitors()));

    CreateWebView(
        hwnd, page, [hwnd](const std::wstring& message) { HandleWebMessage(hwnd, message); },
        [hwnd](ICoreWebView2Controller* c, ICoreWebView2* wv) {
            SettingsState* st = IsWindow(hwnd) ? StateOf(hwnd) : nullptr;
            if (!st) {         // window died before the async creation finished
                c->Release();  // drop the reference the window would have owned
                return;
            }
            st->controller = c;
            wv->AddRef();  // kept for saveerror replies, released in WM_DESTROY
            st->webview = wv;
        });
    return hwnd;
}

int RunSettings() {
    HWND hwnd = OpenSettingsWindow();
    if (!hwnd) return 0;
    // Destruction happens inside a DispatchMessage (save/cancel/close), so the
    // IsWindow check runs before the next blocking GetMessage — no hang.
    MSG msg;
    while (IsWindow(hwnd) && GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
