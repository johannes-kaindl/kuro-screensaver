#include "webview_host.h"

#include <shlwapi.h>
#include <wrl.h>

#include <WebView2.h>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

std::wstring ExeDir() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    PathRemoveFileSpecW(path);
    return path;
}

std::wstring UserDataDir() {
    wchar_t tmp[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    return std::wstring(tmp) + L"KuroScreensaverWV2";
}

}  // namespace

bool EnsureWebView2Runtime() {
    wchar_t* version = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    if (SUCCEEDED(hr) && version) {
        CoTaskMemFree(version);
        return true;
    }
    MessageBoxW(nullptr,
                L"Kuro needs the Microsoft Edge WebView2 Runtime (built into Windows 11).\n\n"
                L"Install it from:\n"
                L"https://developer.microsoft.com/microsoft-edge/webview2/",
                L"Kuro Screensaver", MB_OK | MB_ICONERROR);
    return false;
}

void CreateWebView(HWND hwnd, const std::wstring& pageAndQuery,
                   std::function<void(const std::wstring&)> onWebMessage,
                   std::function<void(ICoreWebView2Controller*)> onCreated) {
    std::wstring url = L"https://kuro.local/" + pageAndQuery;

    CreateCoreWebView2EnvironmentWithOptions(
        nullptr, UserDataDir().c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, url, onWebMessage, onCreated](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(hr) || !env) return hr;
                env->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, url, onWebMessage, onCreated](HRESULT hr,
                                                             ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(hr) || !controller) return hr;
                            controller->AddRef();  // owned by the window, released on destroy

                            ComPtr<ICoreWebView2> webview;
                            controller->get_CoreWebView2(&webview);

                            ComPtr<ICoreWebView2Settings> settings;
                            webview->get_Settings(&settings);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_IsZoomControlEnabled(FALSE);
                            settings->put_AreDevToolsEnabled(FALSE);
                            settings->put_IsStatusBarEnabled(FALSE);
                            ComPtr<ICoreWebView2Settings3> settings3;
                            if (SUCCEEDED(settings.As(&settings3)))
                                settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);

                            ComPtr<ICoreWebView2_3> webview3;
                            if (SUCCEEDED(webview.As(&webview3))) {
                                std::wstring webDir = ExeDir() + L"\\web";
                                webview3->SetVirtualHostNameToFolderMapping(
                                    L"kuro.local", webDir.c_str(),
                                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                            }

                            if (onWebMessage) {
                                webview->add_WebMessageReceived(
                                    Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                        [onWebMessage](ICoreWebView2*,
                                                       ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                            wchar_t* msg = nullptr;
                                            if (SUCCEEDED(args->TryGetWebMessageAsString(&msg)) && msg) {
                                                onWebMessage(msg);
                                                CoTaskMemFree(msg);
                                            }
                                            return S_OK;
                                        })
                                        .Get(),
                                    nullptr);
                            }

                            RECT rc;
                            GetClientRect(hwnd, &rc);
                            controller->put_Bounds(rc);
                            controller->put_IsVisible(TRUE);

                            ComPtr<ICoreWebView2Controller> cp(controller);
                            ComPtr<ICoreWebView2Controller2> c2;
                            if (SUCCEEDED(cp.As(&c2)))
                                c2->put_DefaultBackgroundColor({255, 0, 0, 0});  // opaque black

                            webview->Navigate(url.c_str());
                            if (onCreated) onCreated(controller);
                            return S_OK;
                        })
                        .Get());
                return S_OK;
            })
            .Get());
}
