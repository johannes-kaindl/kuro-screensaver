#include "options.h"

#include <windows.h>

#include <cstdio>
#include <initializer_list>
#include <vector>

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

namespace {

bool ReadFlag(const wchar_t* path, const wchar_t* name, bool def) {
    return ReadReg(path, name, def ? L"on" : L"off") == L"on";
}

// Numeric fields travel raw (un-escaped) through BuildQueryString, so the
// registry value is re-validated on load against the same contract range as
// ParseSaveMessage — garbage from hand edits or third-party writers ('#'/'&'
// would truncate or inject query parameters) falls back to the default.
std::wstring ReadNumber(const wchar_t* path, const wchar_t* name, const std::wstring& def,
                        double lo, double hi) {
    std::wstring v = ReadReg(path, name, def);
    return IsValidNumber(v, lo, hi) ? v : def;
}

// Enum fields are whitelisted on the way back in (ParseOptionField), but the
// registry hands them over unchecked — same threat model ReadNumber defends the
// numerics against. A hand-edited Speed=warp would ride the query into the
// dialog, fail the all-or-nothing save of BOTH tabs, and meanwhile have the
// renderer run on a value the engine does not know. Mirrors ENUM_VALUES in
// src/settings/form-state.ts, which guards the same fields on the page side.
std::wstring ReadEnum(const wchar_t* path, const wchar_t* name, const std::wstring& def,
                      std::initializer_list<const wchar_t*> allowed) {
    std::wstring v = ReadReg(path, name, def);
    for (const wchar_t* a : allowed)
        if (v == a) return v;
    return def;
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

namespace {

// The 33 fields in the pinned contract order, every pair led by '&' and every
// key prefixed by `p`. Both query halves come from here: the wallpaper's is the
// saver's with a wp prefix (spec §5.1), and two hand-written 33-key lists would
// drift apart the moment one side gains a field.
std::wstring BuildFields(const SaverOptions& o, const std::wstring& p) {
    return L"&" + p + L"scene=" + EscapeDataString(o.scene) +
           L"&" + p + L"preset=" + EscapeDataString(o.preset) +
           L"&" + p + L"speed=" + EscapeDataString(o.speed) +
           L"&" + p + L"audio=" + OnOff(o.audio) +
           L"&" + p + L"bloom=" + OnOff(o.bloom) +
           L"&" + p + L"trails=" + OnOff(o.trails) +
           L"&" + p + L"scan=" + OnOff(o.scan) +
           L"&" + p + L"crt=" + OnOff(o.crt) +
           L"&" + p + L"matrix=" + OnOff(o.matrix) +
           L"&" + p + L"terminal=" + OnOff(o.terminal) +
           L"&" + p + L"radar=" + OnOff(o.radar) +
           L"&" + p + L"crosshair=" + OnOff(o.crosshair) +
           // v0.10 additive keys — pinned contract order. Numerics pass
           // through raw (validated strings, never reformatted).
           L"&" + p + L"look=" + EscapeDataString(o.look) +
           L"&" + p + L"altitude=" + EscapeDataString(o.altitude) +
           L"&" + p + L"fog=" + EscapeDataString(o.fog) +
           L"&" + p + L"weather=" + EscapeDataString(o.weather) +
           L"&" + p + L"bank=" + o.bank +
           L"&" + p + L"reactive=" + OnOff(o.reactive) +
           L"&" + p + L"autocycle=" + OnOff(o.autocycle) +
           L"&" + p + L"cyclemin=" + o.cyclemin +
           L"&" + p + L"termlayout=" + EscapeDataString(o.termlayout) +
           L"&" + p + L"boot=" + OnOff(o.boot) +
           L"&" + p + L"bootspeed=" + EscapeDataString(o.bootspeed) +
           L"&" + p + L"daynight=" + OnOff(o.daynight) +
           L"&" + p + L"crtintensity=" + o.crtintensity +
           L"&" + p + L"curvature=" + o.curvature +
           L"&" + p + L"aperture=" + o.aperture +
           L"&" + p + L"bloomstrength=" + o.bloomstrength +
           L"&" + p + L"trailsamount=" + o.trailsamount +
           L"&" + p + L"ntsc=" + o.ntsc +
           L"&" + p + L"halation=" + o.halation +
           L"&" + p + L"scale=" + o.scale +
           L"&" + p + L"perfadapt=" + OnOff(o.perfadapt);
}

}  // namespace

std::wstring BuildQueryString(const SaverOptions& o) {
    return L"?" + BuildFields(o, L"").substr(1);  // the leading '&' becomes the '?'
}

std::wstring BuildWallpaperQuerySuffix(const SaverOptions& o, const std::wstring& runningStatus) {
    // runningStatus is host-built from two integers ("2/3"), so it goes in raw
    // like the numerics — nothing in it needs escaping.
    return BuildFields(o, L"wp") + L"&wprunning=" + runningStatus;
}

SaverOptions LoadOptions(const wchar_t* regPath) {
    SaverOptions o;
    o.scene = ReadReg(regPath, L"Scene", o.scene);
    o.preset = ReadReg(regPath, L"Preset", o.preset);
    o.speed = ReadEnum(regPath, L"Speed", o.speed, {L"slow", L"norm", L"fast"});
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
    if (!o.look.empty() && !IsSlug(o.look)) o.look = L"";  // empty = custom
    o.altitude = ReadEnum(regPath, L"Altitude", o.altitude, {L"low", L"mid", L"high"});
    o.fog = ReadEnum(regPath, L"Fog", o.fog, {L"auto", L"clear", L"dense"});
    o.weather = ReadEnum(regPath, L"Weather", o.weather,
                         {L"light-fog", L"heavy-fog", L"storm", L"dust", L"clear"});
    // Whitelists and ranges pinned to ParseSaveMessage — keep the two in sync.
    o.bank = ReadNumber(regPath, L"Bank", o.bank, 0, 2);
    o.reactive = ReadFlag(regPath, L"Reactive", o.reactive);
    o.autocycle = ReadFlag(regPath, L"AutoCycle", o.autocycle);
    o.cyclemin = ReadNumber(regPath, L"CycleMin", o.cyclemin, 0.5, 10);
    o.termlayout = ReadEnum(regPath, L"TermLayout", o.termlayout, {L"strip", L"window"});
    o.boot = ReadFlag(regPath, L"Boot", o.boot);
    o.bootspeed = ReadEnum(regPath, L"BootSpeed", o.bootspeed, {L"fast", L"normal", L"cinematic"});
    o.daynight = ReadFlag(regPath, L"DayNight", o.daynight);
    o.crtintensity = ReadNumber(regPath, L"CrtIntensity", o.crtintensity, 0, 1);
    o.curvature = ReadNumber(regPath, L"Curvature", o.curvature, 0, 0.25);
    o.aperture = ReadNumber(regPath, L"Aperture", o.aperture, 0, 0.5);
    o.bloomstrength = ReadNumber(regPath, L"BloomStrength", o.bloomstrength, 0, 3);
    o.trailsamount = ReadNumber(regPath, L"TrailsAmount", o.trailsamount, 0.5, 0.95);
    o.ntsc = ReadNumber(regPath, L"Ntsc", o.ntsc, 0, 1);
    o.halation = ReadNumber(regPath, L"Halation", o.halation, 0, 0.6);
    o.scale = ReadNumber(regPath, L"Scale", o.scale, 0.25, 1);
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

namespace {

enum class Field { Ok, Invalid, Unknown };

// One of the 33 option fields, by its unprefixed name. Both halves of a save
// message carry the same names — the wallpaper's merely wp-prefixed — so both
// parsers come through here: a field list maintained twice is a field that
// silently cannot be saved on one of the two tabs.
Field ParseOptionField(const std::wstring& key, const std::wstring& val, SaverOptions& parsed) {
    if (key == L"scene") {
        if (!IsSlug(val)) return Field::Invalid;
        parsed.scene = val;
    } else if (key == L"preset") {
        if (!IsSlug(val)) return Field::Invalid;
        parsed.preset = val;
    } else if (key == L"speed") {
        if (val != L"slow" && val != L"norm" && val != L"fast") return Field::Invalid;
        parsed.speed = val;
    } else if (key == L"look") {
        if (!val.empty() && !IsSlug(val)) return Field::Invalid;  // empty = custom
        parsed.look = val;
    } else if (key == L"altitude") {
        if (val != L"low" && val != L"mid" && val != L"high") return Field::Invalid;
        parsed.altitude = val;
    } else if (key == L"fog") {
        if (val != L"auto" && val != L"clear" && val != L"dense") return Field::Invalid;
        parsed.fog = val;
    } else if (key == L"weather") {
        if (val != L"light-fog" && val != L"heavy-fog" && val != L"storm" && val != L"dust" &&
            val != L"clear")
            return Field::Invalid;
        parsed.weather = val;
    } else if (key == L"termlayout") {
        if (val != L"strip" && val != L"window") return Field::Invalid;
        parsed.termlayout = val;
    } else if (key == L"bootspeed") {
        if (val != L"fast" && val != L"normal" && val != L"cinematic") return Field::Invalid;
        parsed.bootspeed = val;
    } else if (key == L"bank") {
        if (!IsValidNumber(val, 0, 2)) return Field::Invalid;
        parsed.bank = val;
    } else if (key == L"cyclemin") {
        if (!IsValidNumber(val, 0.5, 10)) return Field::Invalid;
        parsed.cyclemin = val;
    } else if (key == L"crtintensity") {
        if (!IsValidNumber(val, 0, 1)) return Field::Invalid;
        parsed.crtintensity = val;
    } else if (key == L"curvature") {
        if (!IsValidNumber(val, 0, 0.25)) return Field::Invalid;
        parsed.curvature = val;
    } else if (key == L"aperture") {
        if (!IsValidNumber(val, 0, 0.5)) return Field::Invalid;
        parsed.aperture = val;
    } else if (key == L"bloomstrength") {
        if (!IsValidNumber(val, 0, 3)) return Field::Invalid;
        parsed.bloomstrength = val;
    } else if (key == L"trailsamount") {
        if (!IsValidNumber(val, 0.5, 0.95)) return Field::Invalid;
        parsed.trailsamount = val;
    } else if (key == L"ntsc") {
        if (!IsValidNumber(val, 0, 1)) return Field::Invalid;
        parsed.ntsc = val;
    } else if (key == L"halation") {
        if (!IsValidNumber(val, 0, 0.6)) return Field::Invalid;
        parsed.halation = val;
    } else if (key == L"scale") {
        if (!IsValidNumber(val, 0.25, 1)) return Field::Invalid;
        parsed.scale = val;
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
        if (!flag) return Field::Unknown;
        if (val == L"on") *flag = true;
        else if (val == L"off") *flag = false;
        else return Field::Invalid;
    }
    return Field::Ok;
}

// Splits "a=1&b=2" and hands each pair to `fn`; false as soon as a pair has no
// '=' or `fn` rejects it. The two save-message parsers walk the same message
// from opposite ends of the wp prefix, so they share the walking.
template <typename Fn>
bool ForEachPair(const std::wstring& msg, Fn fn) {
    size_t pos = 0;
    while (pos < msg.size()) {
        size_t amp = msg.find(L'&', pos);
        std::wstring pair =
            msg.substr(pos, amp == std::wstring::npos ? std::wstring::npos : amp - pos);
        pos = (amp == std::wstring::npos) ? msg.size() : amp + 1;

        size_t eq = pair.find(L'=');
        if (eq == std::wstring::npos) return false;
        if (!fn(pair.substr(0, eq), pair.substr(eq + 1))) return false;
    }
    return true;
}

// The wallpaper half's key prefix. `wp`, not `w`: WMode/WScene/WPreset already
// mean the per-monitor trio, and a wscene next to a WScene that means something
// else is a trap for the next reader (spec §5.1).
constexpr const wchar_t* kWpPrefix = L"wp";
constexpr size_t kWpPrefixLen = 2;

bool IsWpKey(const std::wstring& key) { return key.rfind(kWpPrefix, 0) == 0; }

}  // namespace

bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out,
                      std::vector<MonitorSave>* monitors, std::wstring* monitorMode,
                      std::wstring* wallpaperMonitorMode) {
    SaverOptions parsed = out;
    SaverOptions wpScratch;  // the wallpaper half: validated here, kept by its own parser
    MonitorSave mons[8];
    bool monSeen[8][4] = {};  // per index: id, mode, scene, preset
    bool monWSeen[8] = {};    // any of the wallpaper trio seen for that index
    std::wstring parsedMode, parsedWMode;

    bool ok = ForEachPair(msg, [&](const std::wstring& key, const std::wstring& val) {
        if (IsWpKey(key)) {
            // The wallpaper's half of the same message. Skipped, not rejected —
            // but validated against the real field list, so this stays a parser
            // and does not become a swallower: a typo must still fail the save.
            std::wstring sub = key.substr(kWpPrefixLen);
            if (sub == L"monitormode") {
                if (val != L"per" && val != L"span") return false;
                parsedWMode = val;
                return true;
            }
            // wpautostart rides along for tolerance only: the dialog applies
            // autostart through its own message (it is an OS setting, not one of
            // the 33), and a save must not fail because it was echoed back.
            if (sub == L"autostart") return val == L"on" || val == L"off";
            return ParseOptionField(sub, val, wpScratch) == Field::Ok;
        }
        if (key == L"monitormode") {
            if (val != L"per" && val != L"span") return false;
            parsedMode = val;
            return true;
        }
        if (key.size() > 2 && key[0] == L'm' && key[1] >= L'0' && key[1] <= L'7') {
            // Per-monitor keys m<N>id / m<N>mode / m<N>scene / m<N>preset, plus
            // the wallpaper's m<N>wmode / m<N>wscene / m<N>wpreset. Indices 0..7
            // only — the web dialog caps its monitor list at 8 (spec §4), so
            // higher indices never appear in a valid save.
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
            } else if (field == L"wmode") {
                // Same whitelist as `mode`, and never empty: the empty string is
                // the "never set" sentinel (monitors.h), which only the ABSENCE
                // of the key may mean — a save that spells it out would
                // materialize it.
                if (val != L"on" && val != L"off" && val != L"random" && val != L"scene")
                    return false;
                mons[idx].wmode = val;
                monWSeen[idx] = true;
            } else if (field == L"wscene") {
                if (!val.empty() && !IsSlug(val)) return false;
                mons[idx].wscene = val;
                monWSeen[idx] = true;
            } else if (field == L"wpreset") {
                if (!val.empty() && !IsSlug(val)) return false;  // empty = global
                mons[idx].wpreset = val;
                monWSeen[idx] = true;
            } else {
                return false;
            }
            return true;
        }
        return ParseOptionField(key, val, parsed) == Field::Ok;
    });
    if (!ok) return false;

    // Monitor entries must form a gapless 0..k prefix with all four saver keys
    // each. The wallpaper trio is optional (it comes only for cards the user
    // touched in the wallpaper tab), but may not appear for an index that
    // carries no entry at all.
    size_t count = 0;
    while (count < 8 && (monSeen[count][0] || monSeen[count][1] || monSeen[count][2] ||
                         monSeen[count][3] || monWSeen[count])) {
        if (!monSeen[count][0] || !monSeen[count][1] || !monSeen[count][2] || !monSeen[count][3])
            return false;
        ++count;
    }
    for (size_t i = count; i < 8; ++i)
        if (monSeen[i][0] || monSeen[i][1] || monSeen[i][2] || monSeen[i][3] || monWSeen[i])
            return false;

    out = parsed;
    if (monitors) monitors->assign(mons, mons + count);
    if (monitorMode) *monitorMode = parsedMode;
    if (wallpaperMonitorMode) *wallpaperMonitorMode = parsedWMode;
    return true;
}

bool ParseWallpaperSaveMessage(const std::wstring& msg, SaverOptions& out) {
    SaverOptions parsed = out;
    bool ok = ForEachPair(msg, [&](const std::wstring& key, const std::wstring& val) {
        // The saver's half (and the monitor keys) belong to ParseSaveMessage —
        // mirror image of the skip there. Both parsers see the whole message and
        // each keeps only what is addressed to it.
        if (!IsWpKey(key)) return true;
        std::wstring sub = key.substr(kWpPrefixLen);
        if (sub == L"monitormode" || sub == L"autostart") return true;
        return ParseOptionField(sub, val, parsed) == Field::Ok;
    });
    if (!ok) return false;
    out = parsed;
    return true;
}
