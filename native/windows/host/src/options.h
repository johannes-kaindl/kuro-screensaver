#pragma once
#include <string>
#include <vector>

// Registry home of the persisted options — same layout as the retired C# host
// so existing user settings survive the upgrade untouched.
inline constexpr const wchar_t* kRegPath = L"Software\\KuroScreensaver";

// Persisted user options. Defaults mirror the engine defaults in
// src/engine/data/defaults.ts — an unset registry reproduces the web defaults.
// The first 12 fields are the v0.9 format and stay a byte-identical query
// prefix; everything after `crosshair` is the additive v0.10 extension
// (docs/specs/2026-07-16-windows-v0.10-saver-wallpaper-design.md §2).
// Numeric values travel as raw validated strings through registry and query —
// never reformatted, so byte-parity with settings.html is trivial.
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
    std::wstring look;                    // look bundle slug, empty = custom
    std::wstring altitude = L"low";       // low|mid|high
    std::wstring fog = L"auto";           // auto|clear|dense
    std::wstring weather = L"light-fog";  // light-fog|heavy-fog|storm|dust|clear
    std::wstring bank = L"1";             // num 0..2
    bool reactive = true;
    bool autocycle = true;
    std::wstring cyclemin = L"5";         // num 0.5..10
    std::wstring termlayout = L"strip";   // strip|window
    bool boot = true;
    std::wstring bootspeed = L"normal";   // fast|normal|cinematic
    bool daynight = true;
    std::wstring crtintensity = L"0.35";  // num 0..1
    std::wstring curvature = L"0.012";    // num 0..0.25
    std::wstring aperture = L"0.22";      // num 0..0.5
    std::wstring bloomstrength = L"1.4";  // num 0..3
    std::wstring trailsamount = L"0.84";  // num 0.5..0.95 (= trails damp)
    std::wstring ntsc = L"0";             // num 0..1
    std::wstring halation = L"0.15";      // num 0..0.6
    std::wstring scale = L"1";            // num 0.25..1 (render scale)
    bool perfadapt = true;
};

// One per-monitor override entry from the settings dialog (save-message keys
// m<N>id/m<N>mode/m<N>scene/m<N>preset, N = 0..7 gapless).
struct MonitorSave {
    std::wstring id, mode, scene, preset;
};

// Percent-encodes everything outside RFC 3986 unreserved characters, UTF-8
// based — parity with .NET Uri.EscapeDataString for our value charset.
std::wstring EscapeDataString(const std::wstring& value);

// Builds the query string handed to screensaver.html / settings.html. The
// first 12 keys must stay byte-identical to the old C# Options.QueryString();
// keys 13–33 append in the pinned v0.10 contract order (numerics raw).
std::wstring BuildQueryString(const SaverOptions& o);

// The wallpaper's additive query half — the same 33 keys in the same order,
// every one wp-prefixed, leading '&', to be appended after BuildQueryString's
// output so the saver prefix stays byte-identical (spec §5.1). runningStatus is
// free-form for the dialog's status block ("2/3", or empty when nothing runs).
std::wstring BuildWallpaperQuerySuffix(const SaverOptions& wp, const std::wstring& runningStatus);

// Registry I/O (HKCU). regPath is overridable for tests only.
SaverOptions LoadOptions(const wchar_t* regPath = kRegPath);
void SaveOptions(const SaverOptions& o, const wchar_t* regPath = kRegPath);

// Single-value HKCU string I/O, the primitives the two functions above are
// built from. Exported because the autostart migration (instance.h) and its
// test need the same reader and writer — a second, subtly different pair is how
// key names drift apart.
std::wstring ReadReg(const wchar_t* path, const wchar_t* name, const std::wstring& def);
void WriteReg(const wchar_t* path, const wchar_t* name, const std::wstring& value);

// Validates a raw decimal string (^[0-9]+(\.[0-9]+)?$ — no sign, no exponent,
// no locale comma) and checks lo <= value <= hi. Manual scan on purpose:
// swscanf/wcstod honor the user locale and would mis-parse the dot.
bool IsValidNumber(const std::wstring& v, double lo, double hi);

// Parses a "key=value&key=value" save message from settings.html (WITHOUT the
// "save:" prefix). Starts from `out`'s current values; returns false — and
// leaves all out-params untouched — on any unknown key or invalid value.
// Monitor entries (m0id=…&m0mode=…, indices 0..7 gapless) land in `monitors`
// and `monitormode=per|span` in `monitorMode` when the caller passes them;
// without out-params those keys are still validated, just not returned.
// On success the out-params are overwritten (empty when the keys are absent).
bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out,
                      std::vector<MonitorSave>* monitors = nullptr,
                      std::wstring* monitorMode = nullptr);
