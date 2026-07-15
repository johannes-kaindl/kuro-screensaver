#pragma once
#include <string>

// Registry home of the persisted options — same layout as the retired C# host
// so existing user settings survive the upgrade untouched.
inline constexpr const wchar_t* kRegPath = L"Software\\KuroScreensaver";

// Persisted user options. Defaults mirror the engine defaults in
// src/engine/data/defaults.ts — an unset registry reproduces the web defaults.
struct SaverOptions {
    std::wstring scene = L"random";
    std::wstring preset = L"toxic-haze";
    std::wstring speed = L"norm";
    bool audio = false;
    bool bloom = true;
    bool trails = false;
    bool scan = true;
    bool crt = true;
    bool matrix = false;
    bool terminal = true;
    bool radar = true;
    bool crosshair = true;
};

// Percent-encodes everything outside RFC 3986 unreserved characters, UTF-8
// based — parity with .NET Uri.EscapeDataString for our value charset.
std::wstring EscapeDataString(const std::wstring& value);

// Builds the query string handed to screensaver.html / settings.html. Must
// stay byte-identical to the old C# Options.QueryString() so the web bridge
// (src/screensaver/params.ts) keeps working unchanged.
std::wstring BuildQueryString(const SaverOptions& o);

// Registry I/O (HKCU). regPath is overridable for tests only.
SaverOptions LoadOptions(const wchar_t* regPath = kRegPath);
void SaveOptions(const SaverOptions& o, const wchar_t* regPath = kRegPath);

// Parses a "key=value&key=value" save message from settings.html (WITHOUT the
// "save:" prefix). Starts from `out`'s current values; returns false — and
// leaves `out` untouched — on any unknown key or invalid value.
bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out);
