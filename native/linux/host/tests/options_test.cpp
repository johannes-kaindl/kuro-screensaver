// Headless tests for the pure half of the Linux host. No GTK, no X11 — this
// builds and runs on any machine, including macOS and CI (Task 2 is marked
// [ueberall] in the port plan for exactly that reason).
//
// The Linux host is a deliberate TWIN of native/windows/host, down to the field
// names, so a divergence shows up in a diff instead of hiding. The strongest guard
// against that drift is native/shared/query-contract.txt: the one default query
// that this test, native/windows/host/tests/options_test.cpp and
// tests/screensaver-params.test.ts all read. Changing that line is a CONTRACT
// change and all three sides have to follow it together.
#include "options.h"
#include "render_policy.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

static int g_failures = 0;

static void Check(bool ok, const char* what) {
    if (!ok) { std::printf("FAIL: %s\n", what); ++g_failures; }
    else     { std::printf("ok  : %s\n", what); }
}

static void CheckEq(const std::string& actual, const std::string& expected, const char* what) {
    if (actual != expected) {
        std::printf("FAIL: %s\n  erwartet: %s\n  bekommen: %s\n",
                    what, expected.c_str(), actual.c_str());
        ++g_failures;
    } else {
        std::printf("ok  : %s\n", what);
    }
}

// The pinned v0.10 contract: 33 keys, first 12 are the v0.9 prefix. It lives in ONE
// file — native/shared/query-contract.txt — that this test, the Windows test and the
// web test all read. Before that file existed the Windows and Linux tests each carried
// their own hand-typed copy, which is the drift this fixture exists to prevent.
//
// The repo root comes from a compile define so a bare ./options_test works; the env
// var is only an override (ctest sets it). A missing or unreadable fixture is a
// FAILURE, never a skip — a check that can silently skip itself proves nothing.
static std::string RepoRoot() {
    const char* env = std::getenv("KURO_REPO_ROOT");
    if (env && *env) return env;
    return KURO_REPO_ROOT_DEFAULT;
}

static std::string ReadSharedContract() {
    const std::string path = RepoRoot() + "/native/shared/query-contract.txt";
    std::ifstream f(path);
    if (!f) {
        std::printf("FAIL: Fixture nicht lesbar: %s\n", path.c_str());
        ++g_failures;
        return "";
    }
    std::string line;
    while (std::getline(f, line)) {
        if (!line.empty() && line[0] != '#') return line;
    }
    std::printf("FAIL: Fixture enthaelt keine Vertragszeile: %s\n", path.c_str());
    ++g_failures;
    return "";
}

static void TestDefaultsMatchEngine() {
    SaverOptions o;
    Check(o.scene == "random", "Default scene = random");
    Check(o.preset == "toxic-haze", "Default preset = toxic-haze");
    Check(o.speed == "norm", "Default speed = norm");
    Check(o.audio == false, "Default audio = aus");
    Check(o.scale == "1", "Default scale = 1");
}

static void TestDefaultQueryIsBytewiseTheContract() {
    const std::string expected = ReadSharedContract();
    if (expected.empty()) return;  // ReadSharedContract hat den Fehlschlag schon gezaehlt
    CheckEq(BuildQueryString(SaverOptions{}), expected,
            "Default-Query byte-gleich mit dem gemeinsamen Vertrag");
}

static void TestQueryStartsWithPinnedPrefix() {
    SaverOptions o;
    const std::string q = BuildQueryString(o);
    Check(q.rfind("?scene=random&preset=toxic-haze&speed=norm&audio=off", 0) == 0,
          "Query beginnt mit dem gepinnten Praefix");
    Check(q.find("&bloom=on") != std::string::npos, "bloom als on/off, nicht 1/0");
    Check(q.find("&crtintensity=0.35") != std::string::npos,
          "Numerik roh, nicht umformatiert");
}

static void TestEscaping() {
    CheckEq(EscapeDataString("toxic-haze"), "toxic-haze", "Escape: unreserved unveraendert");
    CheckEq(EscapeDataString("a b/c"), "a%20b%2Fc", "Escape: Sonderzeichen als %XX");
    CheckEq(EscapeDataString(""), "", "Escape: leerer String bleibt leer");
    // '&' and '#' would truncate or inject query parameters if they slipped through.
    CheckEq(EscapeDataString("a&b#c"), "a%26b%23c", "Escape: & und # koennen die Query nicht kapern");
}

static void TestNumbersAreLocaleProof() {
    Check(IsValidNumber("0.35", 0, 1), "0.35 gueltig");
    Check(!IsValidNumber("0,35", 0, 1), "Komma abgelehnt (Locale-Falle)");
    Check(!IsValidNumber("1e-3", 0, 1), "Exponent abgelehnt");
    Check(!IsValidNumber("-0.5", 0, 1), "Vorzeichen abgelehnt");
    Check(!IsValidNumber("2", 0, 1), "ausserhalb der Spanne abgelehnt");
    // Range edges and malformed shapes — same cases the Windows twin pins.
    Check(IsValidNumber("0.95", 0.5, 0.95), "Spanne inklusive an der Obergrenze");
    Check(IsValidNumber("0.5", 0.5, 0.95), "Spanne inklusive an der Untergrenze");
    Check(!IsValidNumber("0.951", 0.5, 0.95), "knapp ueber der Obergrenze abgelehnt");
    Check(!IsValidNumber("1.", 0, 2), "abschliessender Punkt abgelehnt");
    Check(!IsValidNumber(".5", 0, 2), "fuehrender Punkt abgelehnt");
    Check(!IsValidNumber("", 0, 2), "leerer String abgelehnt");
}

static void TestIniRoundTrip() {
    const std::string path = std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp")
                             + "/kuro-options-test.ini";
    SaverOptions o;
    o.scene = "metro";
    o.crtintensity = "0.5";
    o.audio = true;
    SaveOptions(o, path);

    SaverOptions back = LoadOptions(path);
    Check(back.scene == "metro", "INI: scene ueberlebt");
    Check(back.crtintensity == "0.5", "INI: Numerik byte-gleich zurueck");
    Check(back.audio == true, "INI: bool ueberlebt");
    std::remove(path.c_str());
}

// A full round-trip is the real contract: every one of the 33 fields must survive
// save+load, not just the three the sample above touches. Flipping every value
// away from its default is what catches a field that SaveOptions forgot to write.
static void TestFullRoundTripSurvivesEveryField() {
    const std::string path = std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp")
                             + "/kuro-options-full.ini";
    SaverOptions o;
    o.scene = "void";        o.preset = "phosphor";  o.speed = "fast";
    o.audio = true;          o.bloom = false;        o.trails = true;
    o.scan = false;          o.crt = false;          o.matrix = true;
    o.terminal = false;      o.radar = false;        o.crosshair = false;
    o.look = "heavy";        o.altitude = "high";    o.fog = "dense";
    o.weather = "storm";     o.bank = "2";           o.reactive = false;
    o.autocycle = true;      o.cyclemin = "0.5";     o.termlayout = "window";
    o.boot = false;          o.bootspeed = "cinematic"; o.daynight = false;
    o.crtintensity = "0.85"; o.curvature = "0.022";  o.aperture = "0.45";
    o.bloomstrength = "1.6"; o.trailsamount = "0.9"; o.ntsc = "0.6";
    o.halation = "0.4";      o.scale = "0.66";       o.perfadapt = false;

    const std::string before = BuildQueryString(o);
    SaveOptions(o, path);
    CheckEq(BuildQueryString(LoadOptions(path)), before,
            "INI: alle 33 Felder ueberleben den Roundtrip");
    std::remove(path.c_str());
}

static void TestUnknownIniKeysAreIgnored() {
    const std::string path = "/tmp/kuro-options-unknown.ini";
    FILE* f = std::fopen(path.c_str(), "w");
    std::fputs("Scene=void\nQuatsch=123\n", f);
    std::fclose(f);
    SaverOptions o = LoadOptions(path);
    Check(o.scene == "void", "INI: bekannter Schluessel gelesen");
    Check(o.preset == "toxic-haze", "INI: unbekannter Schluessel kippt nicht die Defaults");
    std::remove(path.c_str());
}

static void TestInvalidValuesFallBackToDefault() {
    const std::string path = "/tmp/kuro-options-invalid.ini";
    FILE* f = std::fopen(path.c_str(), "w");
    std::fputs("Speed=ludicrous\nCrtIntensity=9\n", f);
    std::fclose(f);
    SaverOptions o = LoadOptions(path);
    Check(o.speed == "norm", "INI: unbekanntes Enum -> Default");
    Check(o.crtintensity == "0.35", "INI: Zahl ausserhalb der Spanne -> Default");
    std::remove(path.c_str());
}

// A missing file must produce plain defaults, not a crash and not a half-read
// struct — the first start of the host is exactly this case.
static void TestMissingFileYieldsDefaults() {
    const std::string expected = ReadSharedContract();
    if (expected.empty()) return;
    SaverOptions o = LoadOptions("/tmp/kuro-does-not-exist-4711.ini");
    CheckEq(BuildQueryString(o), expected, "fehlende INI -> reine Defaults");
}

// XDG_CONFIG_HOME beats HOME; both land under kuro-screensaver/settings.ini.
static void TestDefaultIniPathFollowsXdg() {
    setenv("XDG_CONFIG_HOME", "/tmp/xdg-probe", 1);
    CheckEq(DefaultIniPath(), "/tmp/xdg-probe/kuro-screensaver/settings.ini",
            "DefaultIniPath: XDG_CONFIG_HOME schlaegt HOME");
    unsetenv("XDG_CONFIG_HOME");
    setenv("HOME", "/tmp/home-probe", 1);
    CheckEq(DefaultIniPath(), "/tmp/home-probe/.config/kuro-screensaver/settings.ini",
            "DefaultIniPath: Fallback auf $HOME/.config");
}

// --- Render-Policy: die reine Entscheidungstabelle ---------------------------
// Erwartungen sind an native/windows/host/src/render_policy.cpp und
// Core/RenderPolicy.swift geeicht, nicht am Plan: BEIDE ausgelieferten Hosts
// behandeln "verdeckt" als Hidden (null Aufwachvorgaenge), nicht als Frozen.
// Auf einem Desktop ist verdeckt der Normalfall — jedes maximierte Fenster —,
// und ein festgehaltener Frame, den niemand sieht, ist genau der Verbrauch,
// den diese Politik einsparen soll.
static void TestRenderPolicy() {
    PolicyInputs in;                       // Standard: sichtbar, Netzstrom
    Check(DecideRenderPolicy(in).state == RenderState::Animating, "sichtbar -> animiert");
    Check(DecideRenderPolicy(in).fps == 30, "Netzstrom -> 30 fps");

    PolicyInputs occ; occ.occluded = true;
    Check(DecideRenderPolicy(occ).state == RenderState::Hidden, "verdeckt -> versteckt");
    Check(DecideRenderPolicy(occ).fps == 0, "versteckt -> 0 fps");

    PolicyInputs lock; lock.sessionLocked = true;
    Check(DecideRenderPolicy(lock).state == RenderState::Hidden, "gesperrt -> versteckt");
    PolicyInputs dpms; dpms.displayOff = true;
    Check(DecideRenderPolicy(dpms).state == RenderState::Hidden, "Bildschirm aus -> versteckt");

    // Die teuer gelernte Regel (macOS v0.11.0): ohne ersten Frame gibt es kein
    // Bild zum Festhalten, und "haltet das letzte Bild" wird zur opaken Platte
    // ueber dem Desktophintergrund. Sie steht VOR der Unsichtbarkeit, weil der
    // Fehler genau dann auftrat: Wallpaper gesetzt, sofort verdeckt, nie gemalt.
    PolicyInputs fresh; fresh.hadFirstFrame = false; fresh.occluded = true;
    Check(DecideRenderPolicy(fresh).state == RenderState::Animating,
          "vor dem ersten Frame wird NICHT stillgelegt");
    Check(DecideRenderPolicy(fresh).fps == 30, "vor dem ersten Frame volle Rate");

    PolicyInputs bat; bat.onBattery = true;                 // animateOnBattery = false
    Check(DecideRenderPolicy(bat).state == RenderState::Frozen, "Akku ohne Erlaubnis -> eingefroren");
    Check(DecideRenderPolicy(bat).fps == 0, "eingefroren -> 0 fps");

    PolicyInputs bat2; bat2.onBattery = true; bat2.animateOnBattery = true;
    Check(DecideRenderPolicy(bat2).state == RenderState::Animating, "Akku mit Erlaubnis -> animiert");
    Check(DecideRenderPolicy(bat2).fps == 10, "Akku -> gedrosselte Rate");

    // Unsichtbarkeit schlaegt die Akku-Erlaubnis: sonst animierte das Wallpaper
    // im Akkubetrieb hinter einem maximierten Fenster weiter.
    PolicyInputs both; both.onBattery = true; both.animateOnBattery = true; both.occluded = true;
    Check(DecideRenderPolicy(both).state == RenderState::Hidden, "verdeckt schlaegt Akku-Erlaubnis");
}

int main(int argc, char** argv) {
    // Generator-Modus fuer native/shared/query-contract.txt. Die Fixture wird aus dem
    // Code erzeugt, nicht abgetippt — abgetippt waere sie eine vierte Kopie.
    if (argc > 1 && std::string(argv[1]) == "--print-default-query") {
        std::printf("%s\n", BuildQueryString(SaverOptions{}).c_str());
        return 0;
    }
    TestDefaultsMatchEngine();
    TestDefaultQueryIsBytewiseTheContract();
    TestQueryStartsWithPinnedPrefix();
    TestEscaping();
    TestNumbersAreLocaleProof();
    TestIniRoundTrip();
    TestFullRoundTripSurvivesEveryField();
    TestUnknownIniKeysAreIgnored();
    TestInvalidValuesFallBackToDefault();
    TestMissingFileYieldsDefaults();
    TestDefaultIniPathFollowsXdg();
    TestRenderPolicy();
    std::printf(g_failures ? "\n%d FEHLER\n" : "\nALLE TESTS BESTANDEN\n", g_failures);
    return g_failures ? 1 : 0;
}
