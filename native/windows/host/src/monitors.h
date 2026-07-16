#pragma once
#include <windows.h>

#include <string>
#include <vector>

#include "options.h"  // kRegPath

// One attached display as the saver/wallpaper hosts see it.
struct MonitorInfo {
    std::wstring id;    // stable EDID-based identity (sanitized) — registry subkey name
    std::wstring name;  // friendly name from the display target, possibly empty
    RECT rect{};        // physical pixels in virtual-screen coordinates
    bool primary = false;
    bool portrait = false;  // rect is taller than wide
};

// Enumerates attached monitors. Ids come from the EDID-based DISPLAYCONFIG
// monitorDevicePath (stable across docking/re-plugging), falling back to the
// GDI device name; sanitized-id collisions get _2/_3… suffixes.
std::vector<MonitorInfo> EnumMonitors();

// Reduces a raw device path to registry-safe [A-Za-z0-9_-] (every other
// character becomes '_'), capped at 128 chars; empty input yields L"UNKNOWN".
std::wstring SanitizeMonitorId(const std::wstring& raw);

// Per-monitor overrides under <regPath>\Monitors\<id>. mode/scene/preset
// drive the saver, the w-prefixed trio the wallpaper. wmode uses the empty
// string as a "never set" sentinel: LoadMonitorConfig yields L"" when the
// WMode value is missing (callers apply the "primary defaults to on" rule
// then), and SaveMonitorConfig writes the wallpaper trio only when wmode is
// non-empty — a save for a monitor whose wallpaper card the user never touched
// must never materialize WMode=off.
struct MonitorConfig {
    std::wstring mode = L"on";  // on|off|random|scene
    std::wstring scene, preset;
    std::wstring wmode;  // on|off|random|scene, empty = never set (sentinel)
    std::wstring wscene, wpreset;
};
// Resolves the wallpaper's per-monitor mode for display. The empty sentinel is
// not a value but an absence, and absence means "primary on, others off" — the
// rule the wallpaper host applies. Anything explicit wins unchanged. Lives here
// so the renderer and the dialog cannot answer this question differently: the
// UI showing "off" for what the host treats as "on" is how the user saves the
// v0.10 black-wallpaper bug back in.
std::wstring EffectiveWallpaperMode(const std::wstring& wmode, bool isPrimary);

bool MonitorConfigExists(const std::wstring& id, const wchar_t* regPath = kRegPath);
MonitorConfig LoadMonitorConfig(const std::wstring& id, const wchar_t* regPath = kRegPath);
void SaveMonitorConfig(const std::wstring& id, const MonitorConfig& c,
                       const wchar_t* regPath = kRegPath);

// Global MonitorMode (saver) / WallpaperMonitorMode value: L"per" (default)
// or L"span" — anything else in the registry normalizes to L"per".
std::wstring LoadMonitorMode(bool wallpaper, const wchar_t* regPath = kRegPath);
void SaveMonitorMode(bool wallpaper, const std::wstring& mode, const wchar_t* regPath = kRegPath);
