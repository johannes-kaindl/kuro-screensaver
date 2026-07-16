#pragma once
#include <windows.h>

#include <functional>
#include <string>

struct ICoreWebView2;
struct ICoreWebView2Controller;

// Returns true when the WebView2 Evergreen runtime is available; otherwise
// shows a MessageBox with the download link (Win10 best-effort case — the
// runtime is inbox on Windows 11) and returns false.
bool EnsureWebView2Runtime();

// Creates a WebView2 filling `hwnd` and navigates it to
// https://kuro.local/<pageAndQuery>, with kuro.local mapped to the web/
// folder next to the exe (Chromium refuses ES modules over file://).
// `onWebMessage` (nullable) receives string messages posted by the page.
// `onCreated` hands over the controller holding ONE extra AddRef — the
// window owns that reference and must Release() it when it is destroyed —
// plus the raw ICoreWebView2 (NOT AddRef'd: callers who keep it, e.g. for
// PostWebMessageAsString replies, must AddRef/Release it themselves).
void CreateWebView(HWND hwnd, const std::wstring& pageAndQuery,
                   std::function<void(const std::wstring&)> onWebMessage,
                   std::function<void(ICoreWebView2Controller*, ICoreWebView2*)> onCreated);
