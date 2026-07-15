// Pins the option/query-string parity with the retired C# host and the
// settings.html save-message contract (tests/settings-form.test.ts mirrors
// the same fixtures on the web side). Plain main(), no framework — the CI
// job just checks the exit code.
#include "options.h"

#include <windows.h>

#include <cstdio>
#include <string>

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

int main() {
    // 1. Defaults → byte-identical to the C# Options.QueryString() output.
    ExpectEq(BuildQueryString(SaverOptions{}),
             L"?scene=random&preset=toxic-haze&speed=norm&audio=off&bloom=on&trails=off"
             L"&scan=on&crt=on&matrix=off&terminal=on&radar=on&crosshair=on",
             "default query string");

    // 2. EscapeDataString: unreserved passthrough, everything else %XX (UTF-8).
    ExpectEq(EscapeDataString(L"toxic-haze"), L"toxic-haze", "escape passthrough");
    ExpectEq(EscapeDataString(L"a b/c"), L"a%20b%2Fc", "escape specials");

    // 3. ParseSaveMessage round-trip (mirrors buildSaveMessage in form-state.ts).
    SaverOptions o;
    ExpectTrue(ParseSaveMessage(
                   L"scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on"
                   L"&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off", o),
               "parse save message");
    ExpectEq(BuildQueryString(o),
             L"?scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on"
             L"&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off",
             "parsed round-trip");

    // 4. Rejection: unknown key, bad charset, bad enum — out stays untouched.
    SaverOptions r;
    ExpectTrue(!ParseSaveMessage(L"evil=1", r), "reject unknown key");
    ExpectTrue(!ParseSaveMessage(L"scene=../etc", r), "reject bad charset");
    ExpectTrue(!ParseSaveMessage(L"speed=warp", r), "reject bad speed");
    ExpectEq(r.scene, L"random", "rejection leaves options untouched");

    // 5. Registry round-trip under a throwaway test key (CI runner is ephemeral).
    const wchar_t* testKey = L"Software\\KuroScreensaverTest";
    SaverOptions w;
    w.scene = L"city";
    w.audio = true;
    w.bloom = false;
    SaveOptions(w, testKey);
    SaverOptions back = LoadOptions(testKey);
    ExpectEq(back.scene, L"city", "registry scene");
    ExpectTrue(back.audio, "registry audio flag");
    ExpectTrue(!back.bloom, "registry bloom flag");
    RegDeleteTreeW(HKEY_CURRENT_USER, testKey);

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("all options tests passed\n");
    return 0;
}
