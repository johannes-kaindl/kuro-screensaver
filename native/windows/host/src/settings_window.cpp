#include "settings_window.h"

#include <windows.h>

#include <cstdio>
#include <string>
#include <vector>

#include <WebView2.h>

#include "monitors.h"
#include "options.h"
#include "tray.h"
#include "wallpaper_options.h"
#include "wallpaper_window.h"
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
        if (c == L'"' || c == L'\\') {
            out += L'\\';
            out += c;
        } else if (c < 0x20) {
            // JSON forbids raw control chars — registry values and EDID names
            // are free-form, and one stray '\n' would kill JSON.parse (and
            // with it the whole monitor section of the dialog).
            wchar_t hex[8];
            swprintf(hex, 8, L"\\u%04X", static_cast<unsigned int>(c));
            out += hex;
        } else {
            out += c;
        }
    }
    return out;
}

// Hand-built JSON for the `monitors=` query param. Carries the EXISTING
// per-monitor saver config (mode/scene/preset from LoadMonitorConfig; missing
// subkey → its defaults "on"/""/"") so the dialog starts from it — an
// untouched save must not reset other monitors (data-loss guard). Since v0.11
// the wallpaper's trio rides along the same way, so the wallpaper tab can offer
// the per-monitor assignment that has been in the registry, and reachable from
// no UI at all, since v0.10.
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
        json += L",\"preset\":\"" + JsonEscape(c.preset) + L"\"";
        // Effective, not raw: the UI must never see the empty sentinel, or it
        // renders (and then saves) it as "off" — see EffectiveWallpaperMode.
        // Resolving it here keeps the rule in one place; the page never guesses.
        json += L",\"wmode\":\"" + JsonEscape(EffectiveWallpaperMode(c.wmode, m.primary)) + L"\"";
        json += L",\"wscene\":\"" + JsonEscape(c.wscene) + L"\"";
        json += L",\"wpreset\":\"" + JsonEscape(c.wpreset) + L"\"}";
    }
    return json + L"]";
}

void HandleWebMessage(HWND hwnd, const std::wstring& message) {
    if (message == L"cancel") {
        DestroyWindow(hwnd);
        return;
    }
    // Its own message rather than a save key, on purpose: the host rejects
    // unknown save KEYS all-or-nothing, but ignores unknown messages — so this
    // could ship before the web side and vice versa without breaking saves.
    // Immediate-apply also matches the tray toggle, which writes the key at once.
    if (message.rfind(L"autostart:", 0) == 0) {
        SetAutostartEnabled(message.substr(10) == L"on");
        return;
    }
    if (message.rfind(L"save:", 0) != 0) return;

    const std::wstring body = message.substr(5);
    SaverOptions o = LoadOptions();
    SaverOptions wp = LoadWallpaperOptions();
    std::vector<MonitorSave> mons;
    std::wstring mode, wmode;
    // Both halves before either write: one message, one all-or-nothing verdict.
    // Splitting it would let a rejected wallpaper value leave a half-saved saver
    // behind, with the dialog still open claiming nothing was saved.
    if (!ParseSaveMessage(body, o, &mons, &mode, &wmode) ||
        !ParseWallpaperSaveMessage(body, wp)) {
        // All-or-nothing reject: tell the page, keep the dialog open.
        if (SettingsState* st = StateOf(hwnd); st && st->webview)
            st->webview->PostWebMessageAsString(L"saveerror");
        return;
    }
    SaveOptions(o);
    // The wallpaper's half goes to its own subkey — parsed from the same message
    // but written separately, so neither set ever touches the other (spec §5.2).
    SaveWallpaperOptions(wp);
    if (!mode.empty()) SaveMonitorMode(false, mode);
    if (!wmode.empty()) SaveMonitorMode(true, wmode);
    for (const MonitorSave& m : mons) {
        // Replace only what the message carried — the wallpaper's
        // WMode/WScene/WPreset in the same subkey must survive a saver-only save
        // untouched: an existing WMode round-trips via LoadMonitorConfig, a
        // missing one stays the empty sentinel and SaveMonitorConfig skips the
        // trio (never materializing WMode=off — see monitors.h).
        MonitorConfig c = LoadMonitorConfig(m.id);
        c.mode = m.mode;
        c.scene = m.scene;
        c.preset = m.preset;
        // The wallpaper tab sends these explicitly, so writing them is not
        // materialising an absence: the dialog showed the user the very value
        // being saved (EffectiveWallpaperMode resolved it host-side). An empty
        // wmode means the message had no wallpaper half at all — then the
        // sentinel must stay untouched.
        if (!m.wmode.empty()) {
            c.wmode = m.wmode;
            c.wscene = m.wscene;
            c.wpreset = m.wpreset;
        }
        SaveMonitorConfig(m.id, c);
    }
    ReloadWallpaper();  // no-op unless a wallpaper is actually running
    DestroyWindow(hwnd);
}

}  // namespace

HWND OpenSettingsWindow(bool openOnWallpaperTab) {
    // The tray can re-trigger this while the dialog is open — focus it instead
    // of stacking a second one. FindWindow searches ALL processes: a dialog
    // owned by another process (wallpaper /w tray dialog vs. a parallel /c)
    // is only brought to the front, never returned — RunSettings would
    // otherwise pump GetMessage forever for a window this thread does not
    // own (an invisible zombie process per attempt).
    if (HWND existing = FindWindowW(L"KuroSettingsWindow", nullptr)) {
        SetForegroundWindow(existing);
        DWORD pid = 0;
        GetWindowThreadProcessId(existing, &pid);
        return pid == GetCurrentProcessId() ? existing : nullptr;
    }

    WNDCLASSW wc{};
    wc.lpfnWndProc = SettingsWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSettingsWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);  // ERROR_CLASS_ALREADY_EXISTS on reopen is harmless

    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
    HWND hwnd = CreateWindowExW(0, L"KuroSettingsWindow", L"Kuro", style,
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

    // The saver's half first and unchanged (the format contract), then the
    // wallpaper's — additive, wp-prefixed, right down to its own span/per choice
    // and the Run-key state behind the autostart checkbox.
    std::wstring page = L"settings.html" + BuildQueryString(LoadOptions()) +
                        L"&monitormode=" + LoadMonitorMode(false) +
                        L"&monitors=" + EscapeDataString(MonitorListJson(EnumMonitors())) +
                        BuildWallpaperQuerySuffix(LoadWallpaperOptions(), WallpaperRunStatus()) +
                        L"&wpmonitormode=" + LoadMonitorMode(true) +
                        L"&wpautostart=" + (AutostartEnabled() ? L"on" : L"off") +
                        L"&tab=" + (openOnWallpaperTab ? L"wallpaper" : L"saver");

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
    // The screensaver's /c path: the saver tab is what the user asked for.
    HWND hwnd = OpenSettingsWindow(false);
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
