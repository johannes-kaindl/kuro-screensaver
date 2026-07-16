#include "monitors.h"

#include <cwchar>
#include <string>
#include <vector>

namespace {

std::wstring ReadReg(const std::wstring& path, const wchar_t* name, const std::wstring& def) {
    wchar_t buf[256];
    DWORD size = sizeof(buf);
    LSTATUS rc =
        RegGetValueW(HKEY_CURRENT_USER, path.c_str(), name, RRF_RT_REG_SZ, nullptr, buf, &size);
    return rc == ERROR_SUCCESS ? std::wstring(buf) : def;
}

void WriteReg(const std::wstring& path, const wchar_t* name, const std::wstring& value) {
    RegSetKeyValueW(HKEY_CURRENT_USER, path.c_str(), name, REG_SZ, value.c_str(),
                    static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
}

std::wstring MonitorKey(const std::wstring& id, const wchar_t* regPath) {
    return std::wstring(regPath) + L"\\Monitors\\" + id;
}

// Resolves a GDI device name (\\.\DISPLAY1) to its display target: the
// EDID-based monitorDevicePath survives docking/re-plugging, unlike the GDI
// name, plus the human-readable monitor name for the settings dialog.
bool ResolveTarget(const wchar_t* gdiDevice, std::wstring& path, std::wstring& friendlyName) {
    UINT32 pathCount = 0, modeCount = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) !=
        ERROR_SUCCESS)
        return false;
    std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount,
                           modes.data(), nullptr) != ERROR_SUCCESS)
        return false;

    for (UINT32 i = 0; i < pathCount; ++i) {
        DISPLAYCONFIG_SOURCE_DEVICE_NAME src = {};
        src.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        src.header.size = sizeof(src);
        src.header.adapterId = paths[i].sourceInfo.adapterId;
        src.header.id = paths[i].sourceInfo.id;
        if (DisplayConfigGetDeviceInfo(&src.header) != ERROR_SUCCESS) continue;
        if (wcscmp(src.viewGdiDeviceName, gdiDevice) != 0) continue;

        DISPLAYCONFIG_TARGET_DEVICE_NAME tgt = {};
        tgt.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        tgt.header.size = sizeof(tgt);
        tgt.header.adapterId = paths[i].targetInfo.adapterId;
        tgt.header.id = paths[i].targetInfo.id;
        if (DisplayConfigGetDeviceInfo(&tgt.header) != ERROR_SUCCESS) continue;
        if (tgt.monitorDevicePath[0] == L'\0') continue;  // no EDID path → GDI fallback

        path = tgt.monitorDevicePath;
        friendlyName = tgt.monitorFriendlyDeviceName;
        return true;
    }
    return false;
}

}  // namespace

std::wstring SanitizeMonitorId(const std::wstring& raw) {
    std::wstring out;
    out.reserve(raw.size() < 128 ? raw.size() : 128);
    for (wchar_t c : raw) {
        bool ok = (c >= L'A' && c <= L'Z') || (c >= L'a' && c <= L'z') ||
                  (c >= L'0' && c <= L'9') || c == L'_' || c == L'-';
        out += ok ? c : L'_';
        if (out.size() >= 128) break;
    }
    return out.empty() ? std::wstring(L"UNKNOWN") : out;
}

std::vector<MonitorInfo> EnumMonitors() {
    std::vector<HMONITOR> handles;
    EnumDisplayMonitors(nullptr, nullptr,
                        [](HMONITOR mon, HDC, LPRECT, LPARAM lp) -> BOOL {
                            reinterpret_cast<std::vector<HMONITOR>*>(lp)->push_back(mon);
                            return TRUE;
                        },
                        reinterpret_cast<LPARAM>(&handles));

    std::vector<MonitorInfo> out;
    for (HMONITOR mon : handles) {
        MONITORINFOEXW mi{};
        mi.cbSize = sizeof(mi);
        if (!GetMonitorInfoW(mon, &mi)) continue;

        MonitorInfo info;
        info.rect = mi.rcMonitor;
        info.primary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0;
        info.portrait =
            (mi.rcMonitor.bottom - mi.rcMonitor.top) > (mi.rcMonitor.right - mi.rcMonitor.left);

        std::wstring path, friendly;
        if (ResolveTarget(mi.szDevice, path, friendly)) {
            info.id = SanitizeMonitorId(path);
            info.name = friendly;
        } else {
            info.id = SanitizeMonitorId(mi.szDevice);  // GDI fallback, equally sanitized
        }

        // Clones/odd setups can collide on the sanitized id — a numeric
        // suffix keeps every monitor addressable in the registry.
        auto taken = [&out](const std::wstring& id) {
            for (const MonitorInfo& existing : out)
                if (existing.id == id) return true;
            return false;
        };
        const std::wstring base = info.id;
        for (int suffix = 2; taken(info.id); ++suffix)
            info.id = base + L"_" + std::to_wstring(suffix);

        out.push_back(std::move(info));
    }
    return out;
}

bool MonitorConfigExists(const std::wstring& id, const wchar_t* regPath) {
    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, MonitorKey(id, regPath).c_str(), 0, KEY_READ, &key) !=
        ERROR_SUCCESS)
        return false;
    RegCloseKey(key);
    return true;
}

MonitorConfig LoadMonitorConfig(const std::wstring& id, const wchar_t* regPath) {
    MonitorConfig c;
    std::wstring key = MonitorKey(id, regPath);
    c.mode = ReadReg(key, L"Mode", c.mode);
    c.scene = ReadReg(key, L"Scene", c.scene);
    c.preset = ReadReg(key, L"Preset", c.preset);
    c.wmode = ReadReg(key, L"WMode", c.wmode);
    c.wscene = ReadReg(key, L"WScene", c.wscene);
    c.wpreset = ReadReg(key, L"WPreset", c.wpreset);
    return c;
}

void SaveMonitorConfig(const std::wstring& id, const MonitorConfig& c, const wchar_t* regPath) {
    std::wstring key = MonitorKey(id, regPath);
    WriteReg(key, L"Mode", c.mode);
    WriteReg(key, L"Scene", c.scene);
    WriteReg(key, L"Preset", c.preset);
    // Empty wmode = "never set" sentinel: leave the wallpaper trio alone —
    // writing WMode=off here would kill the "primary defaults to on" rule
    // for every monitor on a plain saver-dialog save (no UI can undo that).
    if (!c.wmode.empty()) {
        WriteReg(key, L"WMode", c.wmode);
        WriteReg(key, L"WScene", c.wscene);
        WriteReg(key, L"WPreset", c.wpreset);
    }
}

std::wstring LoadMonitorMode(bool wallpaper, const wchar_t* regPath) {
    std::wstring v =
        ReadReg(regPath, wallpaper ? L"WallpaperMonitorMode" : L"MonitorMode", L"per");
    return v == L"span" ? std::wstring(L"span") : std::wstring(L"per");
}

void SaveMonitorMode(bool wallpaper, const std::wstring& mode, const wchar_t* regPath) {
    WriteReg(regPath, wallpaper ? L"WallpaperMonitorMode" : L"MonitorMode", mode);
}
