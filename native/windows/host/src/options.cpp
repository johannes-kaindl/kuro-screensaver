#include "options.h"

#include <windows.h>

#include <cstdio>
#include <vector>

namespace {

std::wstring ReadReg(const wchar_t* path, const wchar_t* name, const std::wstring& def) {
    wchar_t buf[256];
    DWORD size = sizeof(buf);
    LSTATUS rc = RegGetValueW(HKEY_CURRENT_USER, path, name, RRF_RT_REG_SZ, nullptr, buf, &size);
    return rc == ERROR_SUCCESS ? std::wstring(buf) : def;
}

void WriteReg(const wchar_t* path, const wchar_t* name, const std::wstring& value) {
    RegSetKeyValueW(HKEY_CURRENT_USER, path, name, REG_SZ, value.c_str(),
                    static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
}

bool ReadFlag(const wchar_t* path, const wchar_t* name, bool def) {
    return ReadReg(path, name, def ? L"on" : L"off") == L"on";
}

std::wstring OnOff(bool b) { return b ? L"on" : L"off"; }

// Value charset for scene/preset/look slugs coming back from settings.html.
bool IsSlug(const std::wstring& v) {
    if (v.empty() || v.size() > 64) return false;
    for (wchar_t c : v) {
        bool ok = (c >= L'a' && c <= L'z') || (c >= L'0' && c <= L'9') || c == L'-';
        if (!ok) return false;
    }
    return true;
}

// Monitor ids are sanitized device paths — IsSlug plus A-Z and '_'
// (see SanitizeMonitorId in monitors.cpp), capped at 128 chars.
bool IsMonitorId(const std::wstring& v) {
    if (v.empty() || v.size() > 128) return false;
    for (wchar_t c : v) {
        bool ok = (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
                  (c >= L'0' && c <= L'9') || c == L'-' || c == L'_';
        if (!ok) return false;
    }
    return true;
}

}  // namespace

std::wstring EscapeDataString(const std::wstring& value) {
    int len = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::vector<char> utf8(static_cast<size_t>(len));
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), len, nullptr, nullptr);

    std::wstring out;
    for (int i = 0; i + 1 < len; ++i) {  // len includes the trailing NUL
        unsigned char c = static_cast<unsigned char>(utf8[static_cast<size_t>(i)]);
        bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved) {
            out += static_cast<wchar_t>(c);
        } else {
            wchar_t hex[4];
            swprintf(hex, 4, L"%%%02X", c);
            out += hex;
        }
    }
    return out;
}

std::wstring BuildQueryString(const SaverOptions& o) {
    return L"?scene=" + EscapeDataString(o.scene) +
           L"&preset=" + EscapeDataString(o.preset) +
           L"&speed=" + EscapeDataString(o.speed) +
           L"&audio=" + OnOff(o.audio) +
           L"&bloom=" + OnOff(o.bloom) +
           L"&trails=" + OnOff(o.trails) +
           L"&scan=" + OnOff(o.scan) +
           L"&crt=" + OnOff(o.crt) +
           L"&matrix=" + OnOff(o.matrix) +
           L"&terminal=" + OnOff(o.terminal) +
           L"&radar=" + OnOff(o.radar) +
           L"&crosshair=" + OnOff(o.crosshair) +
           // v0.10 additive keys — pinned contract order. Numerics pass
           // through raw (validated strings, never reformatted).
           L"&look=" + EscapeDataString(o.look) +
           L"&altitude=" + EscapeDataString(o.altitude) +
           L"&fog=" + EscapeDataString(o.fog) +
           L"&weather=" + EscapeDataString(o.weather) +
           L"&bank=" + o.bank +
           L"&reactive=" + OnOff(o.reactive) +
           L"&autocycle=" + OnOff(o.autocycle) +
           L"&cyclemin=" + o.cyclemin +
           L"&termlayout=" + EscapeDataString(o.termlayout) +
           L"&boot=" + OnOff(o.boot) +
           L"&bootspeed=" + EscapeDataString(o.bootspeed) +
           L"&daynight=" + OnOff(o.daynight) +
           L"&crtintensity=" + o.crtintensity +
           L"&curvature=" + o.curvature +
           L"&aperture=" + o.aperture +
           L"&bloomstrength=" + o.bloomstrength +
           L"&trailsamount=" + o.trailsamount +
           L"&ntsc=" + o.ntsc +
           L"&halation=" + o.halation +
           L"&scale=" + o.scale +
           L"&perfadapt=" + OnOff(o.perfadapt);
}

SaverOptions LoadOptions(const wchar_t* regPath) {
    SaverOptions o;
    o.scene = ReadReg(regPath, L"Scene", o.scene);
    o.preset = ReadReg(regPath, L"Preset", o.preset);
    o.speed = ReadReg(regPath, L"Speed", o.speed);
    o.audio = ReadFlag(regPath, L"Audio", o.audio);
    o.bloom = ReadFlag(regPath, L"Bloom", o.bloom);
    o.trails = ReadFlag(regPath, L"Trails", o.trails);
    o.scan = ReadFlag(regPath, L"Scan", o.scan);
    o.crt = ReadFlag(regPath, L"Crt", o.crt);
    o.matrix = ReadFlag(regPath, L"Matrix", o.matrix);
    o.terminal = ReadFlag(regPath, L"Terminal", o.terminal);
    o.radar = ReadFlag(regPath, L"Radar", o.radar);
    o.crosshair = ReadFlag(regPath, L"Crosshair", o.crosshair);
    o.look = ReadReg(regPath, L"Look", o.look);
    o.altitude = ReadReg(regPath, L"Altitude", o.altitude);
    o.fog = ReadReg(regPath, L"Fog", o.fog);
    o.weather = ReadReg(regPath, L"Weather", o.weather);
    o.bank = ReadReg(regPath, L"Bank", o.bank);
    o.reactive = ReadFlag(regPath, L"Reactive", o.reactive);
    o.autocycle = ReadFlag(regPath, L"AutoCycle", o.autocycle);
    o.cyclemin = ReadReg(regPath, L"CycleMin", o.cyclemin);
    o.termlayout = ReadReg(regPath, L"TermLayout", o.termlayout);
    o.boot = ReadFlag(regPath, L"Boot", o.boot);
    o.bootspeed = ReadReg(regPath, L"BootSpeed", o.bootspeed);
    o.daynight = ReadFlag(regPath, L"DayNight", o.daynight);
    o.crtintensity = ReadReg(regPath, L"CrtIntensity", o.crtintensity);
    o.curvature = ReadReg(regPath, L"Curvature", o.curvature);
    o.aperture = ReadReg(regPath, L"Aperture", o.aperture);
    o.bloomstrength = ReadReg(regPath, L"BloomStrength", o.bloomstrength);
    o.trailsamount = ReadReg(regPath, L"TrailsAmount", o.trailsamount);
    o.ntsc = ReadReg(regPath, L"Ntsc", o.ntsc);
    o.halation = ReadReg(regPath, L"Halation", o.halation);
    o.scale = ReadReg(regPath, L"Scale", o.scale);
    o.perfadapt = ReadFlag(regPath, L"PerfAdapt", o.perfadapt);
    return o;
}

void SaveOptions(const SaverOptions& o, const wchar_t* regPath) {
    WriteReg(regPath, L"Scene", o.scene);
    WriteReg(regPath, L"Preset", o.preset);
    WriteReg(regPath, L"Speed", o.speed);
    WriteReg(regPath, L"Audio", OnOff(o.audio));
    WriteReg(regPath, L"Bloom", OnOff(o.bloom));
    WriteReg(regPath, L"Trails", OnOff(o.trails));
    WriteReg(regPath, L"Scan", OnOff(o.scan));
    WriteReg(regPath, L"Crt", OnOff(o.crt));
    WriteReg(regPath, L"Matrix", OnOff(o.matrix));
    WriteReg(regPath, L"Terminal", OnOff(o.terminal));
    WriteReg(regPath, L"Radar", OnOff(o.radar));
    WriteReg(regPath, L"Crosshair", OnOff(o.crosshair));
    WriteReg(regPath, L"Look", o.look);
    WriteReg(regPath, L"Altitude", o.altitude);
    WriteReg(regPath, L"Fog", o.fog);
    WriteReg(regPath, L"Weather", o.weather);
    WriteReg(regPath, L"Bank", o.bank);
    WriteReg(regPath, L"Reactive", OnOff(o.reactive));
    WriteReg(regPath, L"AutoCycle", OnOff(o.autocycle));
    WriteReg(regPath, L"CycleMin", o.cyclemin);
    WriteReg(regPath, L"TermLayout", o.termlayout);
    WriteReg(regPath, L"Boot", OnOff(o.boot));
    WriteReg(regPath, L"BootSpeed", o.bootspeed);
    WriteReg(regPath, L"DayNight", OnOff(o.daynight));
    WriteReg(regPath, L"CrtIntensity", o.crtintensity);
    WriteReg(regPath, L"Curvature", o.curvature);
    WriteReg(regPath, L"Aperture", o.aperture);
    WriteReg(regPath, L"BloomStrength", o.bloomstrength);
    WriteReg(regPath, L"TrailsAmount", o.trailsamount);
    WriteReg(regPath, L"Ntsc", o.ntsc);
    WriteReg(regPath, L"Halation", o.halation);
    WriteReg(regPath, L"Scale", o.scale);
    WriteReg(regPath, L"PerfAdapt", OnOff(o.perfadapt));
}

bool IsValidNumber(const std::wstring& v, double lo, double hi) {
    if (v.empty() || v.size() > 32) return false;
    double mantissa = 0;  // digit accumulation is exact below 2^53
    int fracDigits = 0;
    bool inFrac = false, anyInt = false;
    for (size_t i = 0; i < v.size(); ++i) {
        wchar_t c = v[i];
        if (c >= L'0' && c <= L'9') {
            mantissa = mantissa * 10.0 + (c - L'0');
            if (inFrac) ++fracDigits;
            anyInt = anyInt || !inFrac;
        } else if (c == L'.' && !inFrac && anyInt && i + 1 < v.size()) {
            inFrac = true;
        } else {
            return false;  // sign, exponent, comma, double dot, edge dot, …
        }
    }
    // Single division keeps boundary values exact (95/100 == 0.95 literal).
    double divisor = 1;
    for (int d = 0; d < fracDigits; ++d) divisor *= 10;
    double value = mantissa / divisor;
    return value >= lo && value <= hi;
}

bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out,
                      std::vector<MonitorSave>* monitors, std::wstring* monitorMode) {
    SaverOptions parsed = out;
    MonitorSave mons[8];
    bool monSeen[8][4] = {};  // per index: id, mode, scene, preset
    std::wstring parsedMode;

    size_t pos = 0;
    while (pos < msg.size()) {
        size_t amp = msg.find(L'&', pos);
        std::wstring pair = msg.substr(pos, amp == std::wstring::npos ? std::wstring::npos : amp - pos);
        pos = (amp == std::wstring::npos) ? msg.size() : amp + 1;

        size_t eq = pair.find(L'=');
        if (eq == std::wstring::npos) return false;
        std::wstring key = pair.substr(0, eq);
        std::wstring val = pair.substr(eq + 1);

        if (key == L"scene") {
            if (!IsSlug(val)) return false;
            parsed.scene = val;
        } else if (key == L"preset") {
            if (!IsSlug(val)) return false;
            parsed.preset = val;
        } else if (key == L"speed") {
            if (val != L"slow" && val != L"norm" && val != L"fast") return false;
            parsed.speed = val;
        } else if (key == L"look") {
            if (!val.empty() && !IsSlug(val)) return false;  // empty = custom
            parsed.look = val;
        } else if (key == L"altitude") {
            if (val != L"low" && val != L"mid" && val != L"high") return false;
            parsed.altitude = val;
        } else if (key == L"fog") {
            if (val != L"auto" && val != L"clear" && val != L"dense") return false;
            parsed.fog = val;
        } else if (key == L"weather") {
            if (val != L"light-fog" && val != L"heavy-fog" && val != L"storm" &&
                val != L"dust" && val != L"clear") return false;
            parsed.weather = val;
        } else if (key == L"termlayout") {
            if (val != L"strip" && val != L"window") return false;
            parsed.termlayout = val;
        } else if (key == L"bootspeed") {
            if (val != L"fast" && val != L"normal" && val != L"cinematic") return false;
            parsed.bootspeed = val;
        } else if (key == L"bank") {
            if (!IsValidNumber(val, 0, 2)) return false;
            parsed.bank = val;
        } else if (key == L"cyclemin") {
            if (!IsValidNumber(val, 0.5, 10)) return false;
            parsed.cyclemin = val;
        } else if (key == L"crtintensity") {
            if (!IsValidNumber(val, 0, 1)) return false;
            parsed.crtintensity = val;
        } else if (key == L"curvature") {
            if (!IsValidNumber(val, 0, 0.25)) return false;
            parsed.curvature = val;
        } else if (key == L"aperture") {
            if (!IsValidNumber(val, 0, 0.5)) return false;
            parsed.aperture = val;
        } else if (key == L"bloomstrength") {
            if (!IsValidNumber(val, 0, 3)) return false;
            parsed.bloomstrength = val;
        } else if (key == L"trailsamount") {
            if (!IsValidNumber(val, 0.5, 0.95)) return false;
            parsed.trailsamount = val;
        } else if (key == L"ntsc") {
            if (!IsValidNumber(val, 0, 1)) return false;
            parsed.ntsc = val;
        } else if (key == L"halation") {
            if (!IsValidNumber(val, 0, 0.6)) return false;
            parsed.halation = val;
        } else if (key == L"scale") {
            if (!IsValidNumber(val, 0.25, 1)) return false;
            parsed.scale = val;
        } else if (key == L"monitormode") {
            if (val != L"per" && val != L"span") return false;
            parsedMode = val;
        } else if (key.size() > 2 && key[0] == L'm' && key[1] >= L'0' && key[1] <= L'7') {
            // Per-monitor keys m<N>id / m<N>mode / m<N>scene / m<N>preset.
            int idx = key[1] - L'0';
            std::wstring field = key.substr(2);
            if (field == L"id") {
                if (!IsMonitorId(val)) return false;
                mons[idx].id = val;
                monSeen[idx][0] = true;
            } else if (field == L"mode") {
                if (val != L"on" && val != L"off" && val != L"random" && val != L"scene")
                    return false;
                mons[idx].mode = val;
                monSeen[idx][1] = true;
            } else if (field == L"scene") {
                if (!val.empty() && !IsSlug(val)) return false;
                mons[idx].scene = val;
                monSeen[idx][2] = true;
            } else if (field == L"preset") {
                if (!val.empty() && !IsSlug(val)) return false;  // empty = global
                mons[idx].preset = val;
                monSeen[idx][3] = true;
            } else {
                return false;
            }
        } else {
            bool* flag = nullptr;
            if (key == L"audio") flag = &parsed.audio;
            else if (key == L"bloom") flag = &parsed.bloom;
            else if (key == L"trails") flag = &parsed.trails;
            else if (key == L"scan") flag = &parsed.scan;
            else if (key == L"crt") flag = &parsed.crt;
            else if (key == L"matrix") flag = &parsed.matrix;
            else if (key == L"terminal") flag = &parsed.terminal;
            else if (key == L"radar") flag = &parsed.radar;
            else if (key == L"crosshair") flag = &parsed.crosshair;
            else if (key == L"reactive") flag = &parsed.reactive;
            else if (key == L"autocycle") flag = &parsed.autocycle;
            else if (key == L"boot") flag = &parsed.boot;
            else if (key == L"daynight") flag = &parsed.daynight;
            else if (key == L"perfadapt") flag = &parsed.perfadapt;
            if (!flag) return false;
            if (val == L"on") *flag = true;
            else if (val == L"off") *flag = false;
            else return false;
        }
    }

    // Monitor entries must form a gapless 0..k prefix with all four keys each.
    size_t count = 0;
    while (count < 8 &&
           (monSeen[count][0] || monSeen[count][1] || monSeen[count][2] || monSeen[count][3])) {
        if (!monSeen[count][0] || !monSeen[count][1] || !monSeen[count][2] || !monSeen[count][3])
            return false;
        ++count;
    }
    for (size_t i = count; i < 8; ++i)
        if (monSeen[i][0] || monSeen[i][1] || monSeen[i][2] || monSeen[i][3]) return false;

    out = parsed;
    if (monitors) monitors->assign(mons, mons + count);
    if (monitorMode) *monitorMode = parsedMode;
    return true;
}
