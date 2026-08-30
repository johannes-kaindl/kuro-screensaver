#pragma once
#include <string>

// Persisted user options for the Linux host.
//
// The field names are deliberately IDENTICAL to native/windows/host/src/options.h.
// Both hosts serve the same pinned query contract (src/screensaver/params.ts), and
// identical names make a divergence visible in a diff instead of invisible.
//
// Why copied rather than shared: the Windows host is std::wstring throughout. A
// shared module would force a rewrite of the RELEASED Windows host, which cannot be
// built locally (MSVC-only, CI is the only path). The contract is therefore secured
// by a shared test fixture (Task 9), not by shared code.
//
// Defaults mirror the engine defaults in src/engine/data/defaults.ts — an absent
// settings.ini reproduces the web defaults. The first 12 fields are the v0.9 format
// and stay a byte-identical query prefix; everything after `crosshair` is the
// additive v0.10 extension.
//
// Numeric values travel as validated RAW strings through INI and query — never
// reformatted, so byte-parity with settings.html stays trivial.
struct SaverOptions {
    std::string scene = "random";
    std::string preset = "toxic-haze";
    std::string speed = "norm";
    bool audio = false;
    bool bloom = true;
    bool trails = false;
    bool scan = true;
    bool crt = true;
    bool matrix = false;
    bool terminal = true;
    bool radar = true;
    bool crosshair = true;
    std::string look;                    // look bundle slug, empty = custom
    std::string altitude = "low";        // low|mid|high
    std::string fog = "auto";            // auto|clear|dense
    std::string weather = "light-fog";   // light-fog|heavy-fog|storm|dust|clear
    std::string bank = "1";              // num 0..2
    bool reactive = true;
    bool autocycle = true;
    std::string cyclemin = "5";          // num 0.5..10
    std::string termlayout = "strip";    // strip|window
    bool boot = true;
    std::string bootspeed = "normal";    // fast|normal|cinematic
    bool daynight = true;
    std::string crtintensity = "0.35";   // num 0..1
    std::string curvature = "0.012";     // num 0..0.25
    std::string aperture = "0.22";       // num 0..0.5
    std::string bloomstrength = "1.4";   // num 0..3
    std::string trailsamount = "0.84";   // num 0.5..0.95 (= trails damp)
    std::string ntsc = "0";              // num 0..1
    std::string halation = "0.15";       // num 0..0.6
    std::string scale = "1";             // num 0.25..1 (render scale)
    bool perfadapt = true;
};

// Percent-encodes everything outside the RFC 3986 unreserved set, UTF-8 based.
std::string EscapeDataString(const std::string& value);

// Builds the query handed to screensaver.html / settings.html. Order and spelling
// of the 33 keys are contract, not taste — byte-identical to the Windows host.
std::string BuildQueryString(const SaverOptions& o);

// Validates a raw decimal string (^[0-9]+(\.[0-9]+)?$ — no sign, no exponent, no
// locale comma) and checks lo <= value <= hi. Hand-written scan on purpose: strtod
// honours the user locale and would mis-read the dot.
bool IsValidNumber(const std::string& v, double lo, double hi);

// $XDG_CONFIG_HOME/kuro-screensaver/settings.ini, falling back to $HOME/.config/…
std::string DefaultIniPath();

// INI I/O. An unknown key is ignored and an invalid value falls back to the default
// — a hand-written settings.ini must not be able to topple the host. The key names
// are the Windows host's REGISTRY names (Scene, Preset, …, CrtIntensity, PerfAdapt):
// one vocabulary, two storage backends.
SaverOptions LoadOptions(const std::string& iniPath);
void SaveOptions(const SaverOptions& o, const std::string& iniPath);
