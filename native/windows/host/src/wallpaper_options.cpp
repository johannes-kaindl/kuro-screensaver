#include "wallpaper_options.h"

#include <string>

SaverOptions WallpaperDefaults() {
    SaverOptions o;  // engine defaults
    o.audio = false;
    o.scale = L"0.66";
    return o;
}

SaverOptions LoadWallpaperOptions(const wchar_t* regPath) {
    // LoadOptions applies the SAVER defaults for missing values, so start from
    // the wallpaper defaults and only override what the registry actually has.
    SaverOptions defaults = WallpaperDefaults();
    SaverOptions o = LoadOptions(regPath);
    if (ReadReg(regPath, L"Audio", L"").empty()) o.audio = defaults.audio;

    // Validity, not mere presence: LoadOptions has already fallen back to the
    // SAVER default ("1") for a present-but-invalid value (Scale=1.5 by hand),
    // so an .empty() check would let full device resolution through the bloom+CRT
    // chain — the v0.8 stutter this whole default exists to prevent.
    if (!IsValidNumber(ReadReg(regPath, L"Scale", L""), 0.25, 1)) {
        // v0.10 kept the wallpaper's render scale in a single flat key next to
        // the saver's values (WallpaperScale, read by BuildWallpaperPage back
        // then). The subkey supersedes it — but a value someone set by hand must not
        // silently revert, so inherit it once. No UI ever wrote that key, hence
        // no round-trip migration: honour it on read, let the next save move it.
        // Parent derived from regPath, NOT kRegPath — otherwise the tests, which
        // run against a throwaway key, would read the real user's registry.
        std::wstring parent(regPath);
        size_t slash = parent.find_last_of(L'\\');
        if (slash != std::wstring::npos) parent = parent.substr(0, slash);
        std::wstring legacy = ReadReg(parent.c_str(), L"WallpaperScale", L"");
        o.scale = IsValidNumber(legacy, 0.25, 1) ? legacy : defaults.scale;
    }
    return o;
}

void SaveWallpaperOptions(const SaverOptions& o, const wchar_t* regPath) {
    SaveOptions(o, regPath);
}
