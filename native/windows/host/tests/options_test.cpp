// Pins the option/query-string format shared with settings.html (the web side
// mirrors the same v0.10 fixtures in tests/settings-form.test.ts) plus the
// pure host helpers: numeric validation, monitor-id sanitizing, per-monitor
// registry config and the wallpaper render-policy table. Plain main(), no
// framework — the CI job just checks the exit code.
#include "instance.h"
#include "monitors.h"
#include "options.h"
#include "render_policy.h"

#include <windows.h>

#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;

static void ExpectEq(const std::wstring& actual, const std::wstring& expected, const char* label) {
    if (actual != expected) {
        ++failures;
        fwprintf(stderr, L"FAIL %hs\n  expected: %ls\n  actual:   %ls\n",
                 label, expected.c_str(), actual.c_str());
    }
}

static void ExpectTrue(bool v, const char* label) {
    if (!v) {
        ++failures;
        fprintf(stderr, "FAIL %s\n", label);
    }
}

// v0.10 fixtures — byte-pinned on both sides (plan "Zentrale Kontrakte").
// The first 12 keys stay the v0.9/C# prefix, keys 13–33 are additive.
static const wchar_t* kDefaultQuery =
    L"?scene=random&preset=toxic-haze&speed=norm&audio=off&bloom=on&trails=off"
    L"&scan=on&crt=on&matrix=off&terminal=on&radar=on&crosshair=on"
    L"&look=&altitude=low&fog=auto&weather=light-fog&bank=1&reactive=on"
    L"&autocycle=on&cyclemin=5&termlayout=strip&boot=on&bootspeed=normal"
    L"&daynight=on&crtintensity=0.35&curvature=0.012&aperture=0.22"
    L"&bloomstrength=1.4&trailsamount=0.84&ntsc=0&halation=0.15&scale=1&perfadapt=on";

static const wchar_t* kFlipQuery =  // without the leading '?'
    L"scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on"
    L"&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off"
    L"&look=heavy&altitude=high&fog=dense&weather=storm&bank=2&reactive=off"
    L"&autocycle=off&cyclemin=0.5&termlayout=window&boot=off&bootspeed=cinematic"
    L"&daynight=off&crtintensity=0.85&curvature=0.022&aperture=0.45"
    L"&bloomstrength=1.6&trailsamount=0.9&ntsc=0.6&halation=0.4&scale=0.66&perfadapt=off";

int main() {
    // 0. Source encoding. The sources are UTF-8 without BOM, so without /utf-8
    // MSVC decodes them as the system codepage and every non-ASCII literal turns
    // to mojibake — the tray menu shipped "Einstellungenâ€¦" through v0.10.
    // Comparing a literal against its explicit codepoints catches exactly that.
    ExpectEq(std::wstring(L"Einstellungen…"), std::wstring(L"Einstellungen…"),
             "source encoding: ellipsis");
    ExpectEq(std::wstring(L"Größe"), std::wstring(L"Größe"),
             "source encoding: umlaut + eszett");

    // 1. Defaults → byte-identical to the pinned v0.10 default fixture.
    ExpectEq(BuildQueryString(SaverOptions{}), kDefaultQuery, "default query string");

    // 2. EscapeDataString: unreserved passthrough, everything else %XX (UTF-8).
    ExpectEq(EscapeDataString(L"toxic-haze"), L"toxic-haze", "escape passthrough");
    ExpectEq(EscapeDataString(L"a b/c"), L"a%20b%2Fc", "escape specials");

    // 3. ParseSaveMessage full-flip round-trip (mirrors form-state.ts).
    SaverOptions o;
    ExpectTrue(ParseSaveMessage(kFlipQuery, o), "parse flip save message");
    ExpectEq(BuildQueryString(o), std::wstring(L"?") + kFlipQuery, "flip round-trip");

    // 4. Rejection: unknown key, bad charset, bad enum — out stays untouched.
    SaverOptions r;
    ExpectTrue(!ParseSaveMessage(L"evil=1", r), "reject unknown key");
    ExpectTrue(!ParseSaveMessage(L"scene=../etc", r), "reject bad charset");
    ExpectTrue(!ParseSaveMessage(L"speed=warp", r), "reject bad speed");
    ExpectTrue(!ParseSaveMessage(L"altitude=orbit", r), "reject bad altitude");
    ExpectTrue(!ParseSaveMessage(L"weather=sharknado", r), "reject bad weather");
    ExpectEq(r.scene, L"random", "rejection leaves options untouched");

    // 5. Numeric validation — raw string passthrough, manual locale-free scan.
    SaverOptions n;
    ExpectTrue(!ParseSaveMessage(L"crtintensity=1.5", n), "reject out-of-range");
    ExpectTrue(!ParseSaveMessage(L"bank=1,5", n), "reject locale comma");
    ExpectTrue(ParseSaveMessage(L"bank=1.25", n) && n.bank == L"1.25", "raw numeric passthrough");
    ExpectTrue(IsValidNumber(L"0.95", 0.5, 0.95), "range inclusive at hi");
    ExpectTrue(IsValidNumber(L"0.5", 0.5, 0.95), "range inclusive at lo");
    ExpectTrue(!IsValidNumber(L"0.951", 0.5, 0.95), "reject just above hi");
    ExpectTrue(!IsValidNumber(L"1.", 0, 2), "reject trailing dot");
    ExpectTrue(!IsValidNumber(L".5", 0, 2), "reject leading dot");
    ExpectTrue(!IsValidNumber(L"", 0, 2), "reject empty number");
    ExpectTrue(!IsValidNumber(L"1e2", 0, 200), "reject exponent");
    ExpectTrue(!IsValidNumber(L"-1", -2, 2), "reject sign");

    // 6. look: empty = custom bundle, otherwise a slug.
    ExpectTrue(ParseSaveMessage(L"look=", n), "empty look ok");
    ExpectTrue(!ParseSaveMessage(L"look=Heavy!", n), "reject bad look");

    // 7. Monitor keys: gapless indices 0..k, id charset, mode whitelist.
    SaverOptions m;
    std::vector<MonitorSave> mons;
    std::wstring mode;
    ExpectTrue(ParseSaveMessage(
                   L"scene=city&m0id=DELL_ABC1&m0mode=scene&m0scene=matrix&m0preset=phosphor"
                   L"&m1id=LAPTOP_0&m1mode=off&m1scene=&m1preset=&monitormode=span",
                   m, &mons, &mode),
               "parse monitors");
    ExpectTrue(mons.size() == 2 && mons[0].scene == L"matrix" && mons[1].mode == L"off",
               "monitor entries");
    ExpectTrue(mode == L"span", "monitor mode");
    ExpectTrue(!ParseSaveMessage(L"m0id=A&m0mode=warp", m, &mons, &mode), "reject bad monitor mode");
    ExpectTrue(!ParseSaveMessage(L"m1id=A&m1mode=on&m1scene=&m1preset=", m, &mons, &mode),
               "reject monitor index gap");
    ExpectTrue(!ParseSaveMessage(L"m0id=A&m0mode=on", m, &mons, &mode),
               "reject incomplete monitor entry");
    ExpectTrue(!ParseSaveMessage(L"m0id=bad/id&m0mode=on&m0scene=&m0preset=", m, &mons, &mode),
               "reject bad monitor id");
    ExpectTrue(!ParseSaveMessage(L"monitormode=weird", m, &mons, &mode), "reject bad monitormode");
    ExpectTrue(ParseSaveMessage(L"scene=void", m, &mons, &mode) && mons.empty() && mode.empty(),
               "no monitor keys yields empty out-params");

    // 8. SanitizeMonitorId — pure, no display needed.
    ExpectEq(SanitizeMonitorId(
                 L"\\\\?\\DISPLAY#DEL41A1#5&123abc&0&UID0#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}"),
             L"____DISPLAY_DEL41A1_5_123abc_0_UID0__e6f07b5f-ee97-4a90-b076-33f57bf4eaa7_",
             "sanitize display path");
    ExpectEq(SanitizeMonitorId(L"\\\\.\\DISPLAY1"), L"____DISPLAY1", "sanitize gdi fallback");
    // \u escapes on purpose — raw UTF-8 umlauts would depend on the MSVC
    // source codepage (/utf-8 is not set in CI).
    ExpectEq(SanitizeMonitorId(L"M\u00f6nitor \u00dc"), L"M_nitor__", "sanitize non-ascii");
    ExpectEq(SanitizeMonitorId(std::wstring(200, L'a')), std::wstring(128, L'a'),
             "sanitize caps at 128");
    ExpectEq(SanitizeMonitorId(L""), L"UNKNOWN", "sanitize empty");

    // 9. Registry round-trip under a throwaway test key (CI runner is
    //    ephemeral) — the full v0.10 flip survives byte-identically.
    const wchar_t* testKey = L"Software\\KuroScreensaverTest";
    RegDeleteTreeW(HKEY_CURRENT_USER, testKey);  // stale state from aborted runs
    SaverOptions w;
    ExpectTrue(ParseSaveMessage(kFlipQuery, w), "parse flip for registry");
    SaveOptions(w, testKey);
    ExpectEq(BuildQueryString(LoadOptions(testKey)), std::wstring(L"?") + kFlipQuery,
             "registry round-trip preserves the full v0.10 format");

    // 9b. Load-side validation: raw numeric fields go un-escaped into the
    //     query, so registry garbage (hand edits, third-party writers) must
    //     fall back to the defaults — '#'/'&' would truncate/inject params.
    RegSetKeyValueW(HKEY_CURRENT_USER, testKey, L"Bank", REG_SZ, L"1,5#x",
                    static_cast<DWORD>(sizeof(L"1,5#x")));
    ExpectEq(LoadOptions(testKey).bank, L"1", "load rejects numeric registry garbage");
    RegSetKeyValueW(HKEY_CURRENT_USER, testKey, L"Scale", REG_SZ, L"1.5",
                    static_cast<DWORD>(sizeof(L"1.5")));
    ExpectEq(LoadOptions(testKey).scale, L"1", "load rejects out-of-range numeric");
    RegSetKeyValueW(HKEY_CURRENT_USER, testKey, L"Look", REG_SZ, L"Heavy CRT!",
                    static_cast<DWORD>(sizeof(L"Heavy CRT!")));
    ExpectEq(LoadOptions(testKey).look, L"", "load rejects non-slug look");

    // 10. Monitor config subkeys + MonitorMode/WallpaperMonitorMode values.
    ExpectTrue(!MonitorConfigExists(L"TESTMON", testKey), "monitor config initially absent");
    MonitorConfig mc;
    mc.mode = L"scene";
    mc.scene = L"matrix";
    mc.preset = L"phosphor";
    mc.wmode = L"on";
    mc.wscene = L"void";
    SaveMonitorConfig(L"TESTMON", mc, testKey);
    ExpectTrue(MonitorConfigExists(L"TESTMON", testKey), "monitor config exists after save");
    MonitorConfig mb = LoadMonitorConfig(L"TESTMON", testKey);
    ExpectTrue(mb.mode == L"scene" && mb.scene == L"matrix" && mb.preset == L"phosphor",
               "monitor config saver trio");
    ExpectTrue(mb.wmode == L"on" && mb.wscene == L"void" && mb.wpreset.empty(),
               "monitor config wallpaper trio");
    MonitorConfig unknown = LoadMonitorConfig(L"NEVER_SEEN", testKey);
    ExpectTrue(unknown.mode == L"on" && unknown.wmode.empty(),
               "missing subkey yields saver default + empty wmode sentinel");
    // Saver-dialog save path: saver trio replaced, wmode left at the empty
    // sentinel — a previously set WMode must survive untouched …
    MonitorConfig saverOnly;
    saverOnly.mode = L"random";
    SaveMonitorConfig(L"TESTMON", saverOnly, testKey);
    MonitorConfig kept = LoadMonitorConfig(L"TESTMON", testKey);
    ExpectTrue(kept.mode == L"random" && kept.wmode == L"on" && kept.wscene == L"void",
               "empty-wmode save keeps existing wallpaper trio");
    // … and on a fresh subkey no WMode may be materialized (WMode=off would
    // irreversibly kill the wallpaper's "primary defaults to on" rule).
    SaveMonitorConfig(L"FRESHMON", saverOnly, testKey);
    MonitorConfig fresh = LoadMonitorConfig(L"FRESHMON", testKey);
    ExpectTrue(MonitorConfigExists(L"FRESHMON", testKey) && fresh.mode == L"random" &&
                   fresh.wmode.empty(),
               "empty-wmode save materializes no WMode");
    ExpectEq(LoadMonitorMode(false, testKey), L"per", "saver monitor mode defaults to per");
    SaveMonitorMode(false, L"span", testKey);
    ExpectEq(LoadMonitorMode(false, testKey), L"span", "saver monitor mode round-trip");
    ExpectEq(LoadMonitorMode(true, testKey), L"per", "wallpaper monitor mode independent");
    SaveMonitorMode(true, L"span", testKey);
    ExpectEq(LoadMonitorMode(true, testKey), L"span", "wallpaper monitor mode round-trip");
    RegDeleteTreeW(HKEY_CURRENT_USER, testKey);

    // 11. Render policy — priority table (macOS RenderPolicy port, no thermal).
    ExpectTrue(DecideRenderPolicy({}).state == RenderState::Animating, "default animates");
    ExpectTrue(DecideRenderPolicy({}).fps == 30, "ac fps");
    {
        PolicyInputs i;
        i.occluded = true;
        i.fullscreenApp = true;
        ExpectTrue(DecideRenderPolicy(i).state == RenderState::Hidden, "invisibility beats fullscreen");
    }
    {
        PolicyInputs i;
        i.sessionLocked = true;
        ExpectTrue(DecideRenderPolicy(i).state == RenderState::Hidden, "locked hides");
    }
    {
        PolicyInputs i;
        i.displayOff = true;
        PolicyDecision d = DecideRenderPolicy(i);
        ExpectTrue(d.state == RenderState::Hidden && d.fps == 0, "display off hides at 0 fps");
    }
    {
        PolicyInputs i;
        i.fullscreenApp = true;
        ExpectTrue(DecideRenderPolicy(i).state == RenderState::Frozen, "fullscreen freezes");
    }
    {
        PolicyInputs i;
        i.onBattery = true;
        ExpectTrue(DecideRenderPolicy(i).state == RenderState::Frozen, "battery w/o opt-in freezes");
    }
    {
        PolicyInputs i;
        i.onBattery = true;
        i.animateOnBattery = true;
        PolicyDecision d = DecideRenderPolicy(i);
        ExpectTrue(d.state == RenderState::Animating && d.fps == 10, "battery opt-in 10fps");
    }
    {
        PolicyInputs i;
        i.powerSaver = true;
        ExpectTrue(DecideRenderPolicy(i).state == RenderState::Frozen, "power saver freezes");
    }

    // 12. Autostart migration. v0.10 wrote Run\KuroWallpaper =
    // "<dir>\KuroScreensaver.scr" /w. The app is now a .exe, so the key must be
    // rewritten — but only when it points at OUR .scr: a user who aimed it
    // somewhere else keeps their value, and an absent key stays absent.
    {
        const wchar_t* testRun = L"Software\\KuroScreensaverTest\\Run";
        RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\KuroScreensaverTest");

        std::wstring old = L"\"C:\\Program Files\\Kuro\\KuroScreensaver.scr\" /w";
        WriteReg(testRun, L"KuroWallpaper", old);
        MigrateAutostartKey(testRun);
        std::wstring got = ReadReg(testRun, L"KuroWallpaper", L"");
        ExpectTrue(got.find(L"KuroWallpaper.exe") != std::wstring::npos,
                   "autostart migration: points at the exe");
        ExpectTrue(got.find(L"/silent") != std::wstring::npos,
                   "autostart migration: silent flag");
        ExpectTrue(got.find(L"C:\\Program Files\\Kuro\\") != std::wstring::npos,
                   "autostart migration: keeps the install directory");

        std::wstring foreign = L"\"C:\\Other\\thing.exe\" --go";
        WriteReg(testRun, L"KuroWallpaper", foreign);
        MigrateAutostartKey(testRun);
        ExpectEq(ReadReg(testRun, L"KuroWallpaper", L""), foreign,
                 "autostart migration: foreign value untouched");

        // Migration must never CREATE an autostart the user did not ask for.
        RegDeleteKeyValueW(HKEY_CURRENT_USER, testRun, L"KuroWallpaper");
        MigrateAutostartKey(testRun);
        ExpectEq(ReadReg(testRun, L"KuroWallpaper", L"<none>"), std::wstring(L"<none>"),
                 "autostart migration: absent stays absent");

        RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\KuroScreensaverTest");
    }

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("all options tests passed\n");
    return 0;
}
