// Kuro Screensaver — Windows .scr micro-host (C++/Win32 + WebView2).
//
// A .scr is a normal Windows executable the OS invokes with one of:
//   /s            run the screensaver fullscreen
//   /c  /c:<hwnd> show the configuration dialog
//   /p  <hwnd>    render a small preview into the given parent window
//
// The visuals are the project's web build: the host embeds WebView2 (inbox on
// Windows 11) and loads the bundled web/screensaver.html via the
// https://kuro.local/ virtual host. Options live in
// HKCU\Software\KuroScreensaver and reach the page as URL query params
// (bridge: src/screensaver/params.ts) — layout identical to the retired
// .NET host, so existing user settings carry over.

#include <windows.h>

#include <objbase.h>
#include <shellapi.h>

#include <cstdlib>
#include <cwctype>
#include <string>

#include "options.h"
#include "preview_window.h"
#include "saver_window.h"
#include "settings_window.h"
#include "webview_host.h"

namespace {

// Handle may arrive as "/p:12345" or "/p 12345".
HWND ParsePreviewHandle(const std::wstring& arg, int argc, LPWSTR* argv) {
    size_t colon = arg.find(L':');
    if (colon != std::wstring::npos)
        return reinterpret_cast<HWND>(static_cast<INT_PTR>(wcstoll(arg.c_str() + colon + 1, nullptr, 10)));
    if (argc > 2)
        return reinterpret_cast<HWND>(static_cast<INT_PTR>(wcstoll(argv[2], nullptr, 10)));
    return nullptr;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    // Fullscreen windows must see real pixel bounds on scaled displays.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring arg = argc > 1 ? argv[1] : L"/s";
    std::wstring flag = arg.substr(0, arg.size() < 2 ? arg.size() : 2);
    for (wchar_t& c : flag) c = static_cast<wchar_t>(towlower(c));

    if (!EnsureWebView2Runtime()) return 1;

    int rc = 0;
    if (flag == L"/c") {
        rc = RunSettings();
    } else if (flag == L"/p") {
        HWND parent = ParsePreviewHandle(arg, argc, argv);
        rc = parent ? RunPreview(parent) : 0;
    } else {
        rc = RunSaver();
    }

    CoUninitialize();
    return rc;
}
