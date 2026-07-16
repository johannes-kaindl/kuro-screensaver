// Pins the option/query-string format shared with settings.html (the web side
// mirrors the same v0.10 fixtures in tests/settings-form.test.ts) plus the
// pure host helpers: numeric validation, monitor-id sanitizing, per-monitor
// registry config and the wallpaper render-policy table. Plain main(), no
// framework — the CI job just checks the exit code.
#include "instance.h"
#include "monitors.h"
#include "options.h"
#include "render_policy.h"
#include "wallpaper_options.h"

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

// Turns the pinned saver fixture "?scene=random&preset=…" into the wallpaper
// half it must mirror: "&wpscene=random&wppreset=…". Derived rather than typed
// out a second time — a hand-copied 33-key twin drifts the moment one side
// gains a field.
static std::wstring WpPrefixed(const std::wstring& saverQuery) {
    std::wstring out;
    for (size_t pos = 1; pos < saverQuery.size();) {  // 1: skip the leading '?'
        size_t amp = saverQuery.find(L'&', pos);
        size_t end = amp == std::wstring::npos ? saverQuery.size() : amp;
        out += L"&wp" + saverQuery.substr(pos, end - pos);
        pos = end + 1;
    }
    return out;
}

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
    // 10b. The dialog must receive the EFFECTIVE wallpaper mode, not the raw
    // sentinel: an unset monitor means "primary on, others off" (monitors.h),
    // and a UI that rendered the empty string as "off" would let the user save
    // the v0.10 black-wallpaper bug straight back in.
    ExpectEq(EffectiveWallpaperMode(L"", true), std::wstring(L"on"), "unset primary is on");
    ExpectEq(EffectiveWallpaperMode(L"", false), std::wstring(L"off"), "unset secondary is off");
    ExpectEq(EffectiveWallpaperMode(L"scene", true), std::wstring(L"scene"),
             "explicit value wins over the rule");
    ExpectEq(EffectiveWallpaperMode(L"off", true), std::wstring(L"off"),
             "explicitly off primary stays off");
    ExpectEq(EffectiveWallpaperMode(L"on", false), std::wstring(L"on"),
             "explicitly on secondary stays on");

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

    // 13. The wallpaper keeps a full, independent option set in a subkey with
    // identical key names (spec §4). Two invariants matter: a wallpaper save must
    // not touch the saver's values, and an empty subkey must yield the WALLPAPER
    // defaults (audio off, scale 0.66) — not the saver's.
    {
        const wchar_t* saverKey = L"Software\\KuroScreensaverTest";
        const wchar_t* wpKey = L"Software\\KuroScreensaverTest\\Wallpaper";
        RegDeleteTreeW(HKEY_CURRENT_USER, saverKey);

        SaverOptions wp = LoadWallpaperOptions(wpKey);
        ExpectTrue(!wp.audio, "wallpaper default: audio off");
        ExpectEq(wp.scale, std::wstring(L"0.66"), "wallpaper default: render scale 0.66");
        ExpectEq(wp.preset, SaverOptions{}.preset, "wallpaper default: rest is the saver default");

        // A hand-set v0.10 WallpaperScale is inherited once, not silently lost.
        WriteReg(saverKey, L"WallpaperScale", L"0.5");
        ExpectEq(LoadWallpaperOptions(wpKey).scale, std::wstring(L"0.5"),
                 "wallpaper default: inherits legacy WallpaperScale");
        WriteReg(saverKey, L"WallpaperScale", L"9");
        ExpectEq(LoadWallpaperOptions(wpKey).scale, std::wstring(L"0.66"),
                 "wallpaper default: rejects out-of-range legacy WallpaperScale");
        RegDeleteKeyValueW(HKEY_CURRENT_USER, saverKey, L"WallpaperScale");

        wp.scene = L"void";
        wp.preset = L"phosphor";
        wp.scale = L"0.5";
        SaveWallpaperOptions(wp, wpKey);
        SaverOptions back = LoadWallpaperOptions(wpKey);
        ExpectEq(back.scene, std::wstring(L"void"), "wallpaper round-trip: scene");
        ExpectEq(back.preset, std::wstring(L"phosphor"), "wallpaper round-trip: preset");
        ExpectEq(back.scale, std::wstring(L"0.5"), "wallpaper round-trip: raw numeric");

        // The saver set is untouched by all of the above …
        SaverOptions saver = LoadOptions(saverKey);
        ExpectEq(saver.scene, std::wstring(L"random"), "saver set untouched by wallpaper save");
        // … and the reverse: a saver save leaves the wallpaper subkey alone.
        saver.scene = L"terrain";
        SaveOptions(saver, saverKey);
        ExpectEq(LoadWallpaperOptions(wpKey).scene, std::wstring(L"void"),
                 "wallpaper set untouched by saver save");

        RegDeleteTreeW(HKEY_CURRENT_USER, saverKey);
    }

    // 14. The dialog needs both sets. The saver prefix must stay byte-identical
    // (the v0.9 format contract), so the wallpaper set is strictly additive with
    // a wp prefix — wp, not w, because WMode/WScene/WPreset already mean the
    // per-monitor trio and a wscene next to a WScene is a trap for the next
    // reader.
    {
        SaverOptions wp = WallpaperDefaults();
        wp.scene = L"void";
        wp.preset = L"phosphor";
        wp.scale = L"0.66";

        std::wstring suffix = BuildWallpaperQuerySuffix(wp, L"2/3");
        ExpectTrue(suffix.rfind(L"&", 0) == 0, "wallpaper query: starts with &");
        ExpectTrue(suffix.find(L"&wpscene=void") != std::wstring::npos, "wallpaper query: scene");
        ExpectTrue(suffix.find(L"&wppreset=phosphor") != std::wstring::npos,
                   "wallpaper query: preset");
        ExpectTrue(suffix.find(L"&wpscale=0.66") != std::wstring::npos,
                   "wallpaper query: numeric stays raw");
        ExpectTrue(suffix.find(L"&wprunning=2/3") != std::wstring::npos,
                   "wallpaper query: run status");
        // Exact mirror of the saver half: same 33 keys, same order, same values,
        // every one wp-prefixed, then wprunning. A field only one half carries
        // would be an option the dialog can show but never save.
        ExpectEq(BuildWallpaperQuerySuffix(SaverOptions{}, L""),
                 WpPrefixed(kDefaultQuery) + L"&wprunning=",
                 "wallpaper query mirrors the saver half key for key");
        // The saver's own query must not have gained anything.
        ExpectTrue(BuildQueryString(SaverOptions{}).find(L"wp") == std::wstring::npos,
                   "saver query free of wp keys");
    }

    // 15. One dialog, one save message, both sets. The saver parser must skip
    // the wallpaper's keys — but must NOT turn into a parser that swallows
    // anything: a typo has to stay a rejected message, or the all-or-nothing
    // guarantee (section 4) is worth nothing.
    {
        SaverOptions both;
        ExpectTrue(ParseSaveMessage(L"scene=void&wpscene=terrain&wpmonitormode=span&wpautostart=on",
                                    both),
                   "saver parser skips wp keys");
        ExpectEq(both.scene, std::wstring(L"void"), "saver parser ignores wp values");
        ExpectTrue(!ParseSaveMessage(L"wpevil=1", both), "unknown wp key still rejected");
        ExpectTrue(!ParseSaveMessage(L"evil=1", both), "unknown key still rejected");
        ExpectTrue(!ParseSaveMessage(L"wpscale=9", both), "invalid wp value still rejected");

        // The wallpaper's global span/per choice rides the same message as the
        // saver's, and stays empty rather than defaulting — so the host can tell
        // "the dialog offered no choice" from "the user picked per".
        SaverOptions o;
        std::wstring mode, wmode;
        ExpectTrue(ParseSaveMessage(L"monitormode=per&wpmonitormode=span", o, nullptr, &mode,
                                    &wmode),
                   "parses both monitor modes");
        ExpectEq(mode, std::wstring(L"per"), "saver monitor mode");
        ExpectEq(wmode, std::wstring(L"span"), "wallpaper monitor mode");
        ExpectTrue(ParseSaveMessage(L"scene=void", o, nullptr, &mode, &wmode) && wmode.empty(),
                   "absent wpmonitormode yields empty out-param");
        ExpectTrue(!ParseSaveMessage(L"wpmonitormode=weird", o, nullptr, &mode, &wmode),
                   "reject bad wpmonitormode");
    }

    // 16. The wallpaper half of the same message, read by its own parser into
    // its own set. A value the message does not mention must not be invented —
    // the v0.10 lesson: a save that materialised absent values killed the
    // wallpaper.
    {
        SaverOptions wp;
        ExpectTrue(ParseWallpaperSaveMessage(L"wpscene=void&wppreset=phosphor&wpscale=0.5", wp),
                   "wallpaper save: parses");
        ExpectEq(wp.scene, std::wstring(L"void"), "wallpaper save: scene");
        ExpectEq(wp.preset, std::wstring(L"phosphor"), "wallpaper save: preset");
        ExpectEq(wp.scale, std::wstring(L"0.5"), "wallpaper save: raw numeric");

        // Saver keys in the same message are ignored by the wallpaper parser.
        SaverOptions wp2;
        ExpectTrue(ParseWallpaperSaveMessage(L"scene=terrain&monitormode=span&m0id=A&wpscene=void",
                                             wp2),
                   "wallpaper save: tolerates the saver half");
        ExpectEq(wp2.scene, std::wstring(L"void"), "wallpaper save: ignores saver keys");

        // Out-of-range numeric rejects the whole message (all-or-nothing).
        SaverOptions wp3;
        ExpectTrue(!ParseWallpaperSaveMessage(L"wpscale=9", wp3),
                   "wallpaper save: rejects out-of-range numeric");
        ExpectTrue(!ParseWallpaperSaveMessage(L"wpevil=1", wp3),
                   "wallpaper save: rejects unknown wp key");
        ExpectEq(wp3.scale, SaverOptions{}.scale, "wallpaper save: rejection leaves out untouched");

        // Full round-trip: what the wp query half carries, the wp save half
        // parses back — the two ends of the same contract.
        SaverOptions wp4;
        ExpectTrue(  // substr(1): the save message has no leading separator
            ParseWallpaperSaveMessage(WpPrefixed(std::wstring(L"?") + kFlipQuery).substr(1), wp4),
            "wallpaper save: parses the full flip");
        ExpectEq(BuildWallpaperQuerySuffix(wp4, L""), WpPrefixed(std::wstring(L"?") + kFlipQuery) +
                                                          L"&wprunning=",
                 "wallpaper query/save round-trip");
    }

    // 17. The whole message, in the exact shape buildSaveMessage (form-state.ts)
    // emits it: both 33-key halves, both monitor modes, a monitor entry with
    // both trios. Pinned here because the halves were merged in two separate
    // commits and the branch spent a while where the page sent wp keys the host
    // still rejected — every save failed. This is the end-to-end guard against
    // that ever being true again.
    {
        std::wstring msg = std::wstring(kDefaultQuery + 1) + L"&monitormode=per" +
                           L"&m0id=DELL_ABC1&m0mode=scene&m0scene=matrix&m0preset=phosphor" +
                           L"&m0wmode=random&m0wscene=&m0wpreset=kuro" +
                           WpPrefixed(std::wstring(L"?") + kFlipQuery) + L"&wpmonitormode=span";

        SaverOptions saver;
        std::vector<MonitorSave> mons;
        std::wstring mode, wmode;
        ExpectTrue(ParseSaveMessage(msg, saver, &mons, &mode, &wmode), "full dialog save accepted");
        ExpectEq(BuildQueryString(saver), kDefaultQuery, "full dialog save: saver half intact");
        ExpectEq(mode, std::wstring(L"per"), "full dialog save: saver monitor mode");
        ExpectEq(wmode, std::wstring(L"span"), "full dialog save: wallpaper monitor mode");
        ExpectTrue(mons.size() == 1 && mons[0].mode == L"scene" && mons[0].wmode == L"random" &&
                       mons[0].wpreset == L"kuro",
                   "full dialog save: both monitor trios");

        SaverOptions wp;
        ExpectTrue(ParseWallpaperSaveMessage(msg, wp), "full dialog save: wallpaper half accepted");
        ExpectEq(BuildQueryString(wp), std::wstring(L"?") + kFlipQuery,
                 "full dialog save: wallpaper half intact");
    }

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("all options tests passed\n");
    return 0;
}
