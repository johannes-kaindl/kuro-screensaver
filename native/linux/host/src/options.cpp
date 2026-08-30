#include "options.h"

#include <cstdio>
#include <cstdlib>
#include <initializer_list>
#include <map>
#include <string>

namespace {

std::string Esc(const std::string& s) { return EscapeDataString(s); }
const char* OnOff(bool b) { return b ? "on" : "off"; }

// Builds the 33 fields in the pinned order. `p` is "" for the saver and would be
// "wp" for the wallpaper half — unused today, kept so the split does not have to
// re-thread the function later (the Windows twin is shaped the same way).
std::string BuildFields(const SaverOptions& o, const std::string& p) {
    return "&" + p + "scene=" + Esc(o.scene) +
           "&" + p + "preset=" + Esc(o.preset) +
           "&" + p + "speed=" + Esc(o.speed) +
           "&" + p + "audio=" + OnOff(o.audio) +
           "&" + p + "bloom=" + OnOff(o.bloom) +
           "&" + p + "trails=" + OnOff(o.trails) +
           "&" + p + "scan=" + OnOff(o.scan) +
           "&" + p + "crt=" + OnOff(o.crt) +
           "&" + p + "matrix=" + OnOff(o.matrix) +
           "&" + p + "terminal=" + OnOff(o.terminal) +
           "&" + p + "radar=" + OnOff(o.radar) +
           "&" + p + "crosshair=" + OnOff(o.crosshair) +
           // v0.10 additive keys — pinned contract order. Numerics pass through
           // raw (validated strings, never reformatted).
           "&" + p + "look=" + Esc(o.look) +
           "&" + p + "altitude=" + Esc(o.altitude) +
           "&" + p + "fog=" + Esc(o.fog) +
           "&" + p + "weather=" + Esc(o.weather) +
           "&" + p + "bank=" + o.bank +
           "&" + p + "reactive=" + OnOff(o.reactive) +
           "&" + p + "autocycle=" + OnOff(o.autocycle) +
           "&" + p + "cyclemin=" + o.cyclemin +
           "&" + p + "termlayout=" + Esc(o.termlayout) +
           "&" + p + "boot=" + OnOff(o.boot) +
           "&" + p + "bootspeed=" + Esc(o.bootspeed) +
           "&" + p + "daynight=" + OnOff(o.daynight) +
           "&" + p + "crtintensity=" + o.crtintensity +
           "&" + p + "curvature=" + o.curvature +
           "&" + p + "aperture=" + o.aperture +
           "&" + p + "bloomstrength=" + o.bloomstrength +
           "&" + p + "trailsamount=" + o.trailsamount +
           "&" + p + "ntsc=" + o.ntsc +
           "&" + p + "halation=" + o.halation +
           "&" + p + "scale=" + o.scale +
           "&" + p + "perfadapt=" + OnOff(o.perfadapt);
}

// A look bundle slug: lowercase, digits, hyphen, at most 64 chars. Same rule as
// the Windows host — an invalid slug is cleared rather than rejected, because an
// empty look legitimately means "custom".
bool IsSlug(const std::string& v) {
    if (v.empty() || v.size() > 64) return false;
    for (unsigned char c : v) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
        if (!ok) return false;
    }
    return true;
}

std::map<std::string, std::string> ReadIni(const std::string& path) {
    std::map<std::string, std::string> kv;
    FILE* f = std::fopen(path.c_str(), "r");
    if (!f) return kv;  // no file = every default
    char line[1024];
    while (std::fgets(line, sizeof line, f)) {
        std::string s(line);
        while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
        if (s.empty() || s[0] == '#' || s[0] == '[') continue;  // [wallpaper] later
        const size_t eq = s.find('=');
        if (eq == std::string::npos) continue;
        kv[s.substr(0, eq)] = s.substr(eq + 1);
    }
    std::fclose(f);
    return kv;
}

std::string Pick(const std::map<std::string, std::string>& kv, const char* key,
                 const std::string& def) {
    auto it = kv.find(key);
    return it == kv.end() ? def : it->second;
}

// Deliberately more permissive than the Windows reader, which accepts only "on":
// settings.ini is a plain text file a user may edit by hand, so "1" and "true"
// are read too. SaveOptions still writes on/off, so a round-trip stays identical
// to the registry vocabulary.
bool PickFlag(const std::map<std::string, std::string>& kv, const char* key, bool def) {
    auto it = kv.find(key);
    if (it == kv.end()) return def;
    const std::string& v = it->second;
    if (v == "on" || v == "1" || v == "true") return true;
    if (v == "off" || v == "0" || v == "false") return false;
    return def;  // garbage does not silently mean false
}

std::string PickEnum(const std::map<std::string, std::string>& kv, const char* key,
                     const std::string& def, std::initializer_list<const char*> allowed) {
    const std::string v = Pick(kv, key, def);
    for (const char* a : allowed) {
        if (v == a) return v;
    }
    return def;  // unknown -> default, never topple
}

std::string PickNumber(const std::map<std::string, std::string>& kv, const char* key,
                       const std::string& def, double lo, double hi) {
    const std::string v = Pick(kv, key, def);
    return IsValidNumber(v, lo, hi) ? v : def;
}

}  // namespace

std::string EscapeDataString(const std::string& value) {
    static const char* kHex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : value) {
        const bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                                (c >= '0' && c <= '9') || c == '-' || c == '_' ||
                                c == '.' || c == '~';
        if (unreserved) {
            out += static_cast<char>(c);
        } else {
            out += '%';
            out += kHex[c >> 4];
            out += kHex[c & 0x0F];
        }
    }
    return out;
}

std::string BuildQueryString(const SaverOptions& o) {
    return "?" + BuildFields(o, "").substr(1);  // the leading '&' becomes the '?'
}

bool IsValidNumber(const std::string& v, double lo, double hi) {
    if (v.empty()) return false;
    bool digitsBefore = false, dot = false, digitsAfter = false;
    for (const char c : v) {
        if (c >= '0' && c <= '9') {
            (dot ? digitsAfter : digitsBefore) = true;
        } else if (c == '.' && !dot) {
            dot = true;
        } else {
            return false;
        }
    }
    if (!digitsBefore || (dot && !digitsAfter)) return false;
    // After the shape check strtod is locale-safe: the string is guaranteed to
    // hold nothing but digits and at most one dot.
    const double d = std::strtod(v.c_str(), nullptr);
    return d >= lo && d <= hi;
}

std::string DefaultIniPath() {
    if (const char* xdg = std::getenv("XDG_CONFIG_HOME"); xdg && *xdg) {
        return std::string(xdg) + "/kuro-screensaver/settings.ini";
    }
    const char* home = std::getenv("HOME");
    return std::string(home ? home : ".") + "/.config/kuro-screensaver/settings.ini";
}

SaverOptions LoadOptions(const std::string& iniPath) {
    const std::map<std::string, std::string> kv = ReadIni(iniPath);
    SaverOptions o;
    // Scene and preset stay unvalidated here, exactly like the Windows reader —
    // the whitelist lives in the settings dialog's parser. Both go through
    // EscapeDataString on the way into the query, so neither can break it.
    o.scene = Pick(kv, "Scene", o.scene);
    o.preset = Pick(kv, "Preset", o.preset);
    o.speed = PickEnum(kv, "Speed", o.speed, {"slow", "norm", "fast"});
    o.audio = PickFlag(kv, "Audio", o.audio);
    o.bloom = PickFlag(kv, "Bloom", o.bloom);
    o.trails = PickFlag(kv, "Trails", o.trails);
    o.scan = PickFlag(kv, "Scan", o.scan);
    o.crt = PickFlag(kv, "Crt", o.crt);
    o.matrix = PickFlag(kv, "Matrix", o.matrix);
    o.terminal = PickFlag(kv, "Terminal", o.terminal);
    o.radar = PickFlag(kv, "Radar", o.radar);
    o.crosshair = PickFlag(kv, "Crosshair", o.crosshair);
    o.look = Pick(kv, "Look", o.look);
    if (!o.look.empty() && !IsSlug(o.look)) o.look = "";  // empty = custom
    o.altitude = PickEnum(kv, "Altitude", o.altitude, {"low", "mid", "high"});
    o.fog = PickEnum(kv, "Fog", o.fog, {"auto", "clear", "dense"});
    o.weather = PickEnum(kv, "Weather", o.weather,
                         {"light-fog", "heavy-fog", "storm", "dust", "clear"});
    // Whitelists and ranges are pinned to the Windows host's — keep them in sync.
    o.bank = PickNumber(kv, "Bank", o.bank, 0, 2);
    o.reactive = PickFlag(kv, "Reactive", o.reactive);
    o.autocycle = PickFlag(kv, "AutoCycle", o.autocycle);
    o.cyclemin = PickNumber(kv, "CycleMin", o.cyclemin, 0.5, 10);
    o.termlayout = PickEnum(kv, "TermLayout", o.termlayout, {"strip", "window"});
    o.boot = PickFlag(kv, "Boot", o.boot);
    o.bootspeed = PickEnum(kv, "BootSpeed", o.bootspeed, {"fast", "normal", "cinematic"});
    o.daynight = PickFlag(kv, "DayNight", o.daynight);
    o.crtintensity = PickNumber(kv, "CrtIntensity", o.crtintensity, 0, 1);
    o.curvature = PickNumber(kv, "Curvature", o.curvature, 0, 0.25);
    o.aperture = PickNumber(kv, "Aperture", o.aperture, 0, 0.5);
    o.bloomstrength = PickNumber(kv, "BloomStrength", o.bloomstrength, 0, 3);
    o.trailsamount = PickNumber(kv, "TrailsAmount", o.trailsamount, 0.5, 0.95);
    o.ntsc = PickNumber(kv, "Ntsc", o.ntsc, 0, 1);
    o.halation = PickNumber(kv, "Halation", o.halation, 0, 0.6);
    o.scale = PickNumber(kv, "Scale", o.scale, 0.25, 1);
    o.perfadapt = PickFlag(kv, "PerfAdapt", o.perfadapt);
    return o;
}

void SaveOptions(const SaverOptions& o, const std::string& iniPath) {
    FILE* f = std::fopen(iniPath.c_str(), "w");
    if (!f) return;  // unwritable config dir must not take the host down
    std::fprintf(f, "# Kuro Screensaver settings. Key names match the Windows host's\n");
    std::fprintf(f, "# registry values so both sides speak one vocabulary.\n");
    std::fprintf(f, "Scene=%s\n", o.scene.c_str());
    std::fprintf(f, "Preset=%s\n", o.preset.c_str());
    std::fprintf(f, "Speed=%s\n", o.speed.c_str());
    std::fprintf(f, "Audio=%s\n", OnOff(o.audio));
    std::fprintf(f, "Bloom=%s\n", OnOff(o.bloom));
    std::fprintf(f, "Trails=%s\n", OnOff(o.trails));
    std::fprintf(f, "Scan=%s\n", OnOff(o.scan));
    std::fprintf(f, "Crt=%s\n", OnOff(o.crt));
    std::fprintf(f, "Matrix=%s\n", OnOff(o.matrix));
    std::fprintf(f, "Terminal=%s\n", OnOff(o.terminal));
    std::fprintf(f, "Radar=%s\n", OnOff(o.radar));
    std::fprintf(f, "Crosshair=%s\n", OnOff(o.crosshair));
    std::fprintf(f, "Look=%s\n", o.look.c_str());
    std::fprintf(f, "Altitude=%s\n", o.altitude.c_str());
    std::fprintf(f, "Fog=%s\n", o.fog.c_str());
    std::fprintf(f, "Weather=%s\n", o.weather.c_str());
    std::fprintf(f, "Bank=%s\n", o.bank.c_str());
    std::fprintf(f, "Reactive=%s\n", OnOff(o.reactive));
    std::fprintf(f, "AutoCycle=%s\n", OnOff(o.autocycle));
    std::fprintf(f, "CycleMin=%s\n", o.cyclemin.c_str());
    std::fprintf(f, "TermLayout=%s\n", o.termlayout.c_str());
    std::fprintf(f, "Boot=%s\n", OnOff(o.boot));
    std::fprintf(f, "BootSpeed=%s\n", o.bootspeed.c_str());
    std::fprintf(f, "DayNight=%s\n", OnOff(o.daynight));
    std::fprintf(f, "CrtIntensity=%s\n", o.crtintensity.c_str());
    std::fprintf(f, "Curvature=%s\n", o.curvature.c_str());
    std::fprintf(f, "Aperture=%s\n", o.aperture.c_str());
    std::fprintf(f, "BloomStrength=%s\n", o.bloomstrength.c_str());
    std::fprintf(f, "TrailsAmount=%s\n", o.trailsamount.c_str());
    std::fprintf(f, "Ntsc=%s\n", o.ntsc.c_str());
    std::fprintf(f, "Halation=%s\n", o.halation.c_str());
    std::fprintf(f, "Scale=%s\n", o.scale.c_str());
    std::fprintf(f, "PerfAdapt=%s\n", OnOff(o.perfadapt));
    std::fclose(f);
}
