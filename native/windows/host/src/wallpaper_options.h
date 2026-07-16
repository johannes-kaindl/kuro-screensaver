#pragma once
#include "options.h"

// The wallpaper's own option set. Same 33 fields, same key names, one level
// deeper (spec §4) — so LoadOptions/SaveOptions do the work and the saver's
// registry layout, including the byte-identical legacy prefix, stays untouched.
inline constexpr const wchar_t* kWallpaperRegPath = L"Software\\KuroScreensaver\\Wallpaper";

// Defaults for a never-configured wallpaper. Deliberately NOT the saver's:
// a wallpaper that plays sound all day is unusable, and full device resolution
// through the bloom+CRT chain is what made it stutter (v0.8 finding).
SaverOptions WallpaperDefaults();

// Registry I/O for the wallpaper set. regPath is overridable for tests only.
SaverOptions LoadWallpaperOptions(const wchar_t* regPath = kWallpaperRegPath);
void SaveWallpaperOptions(const SaverOptions& o, const wchar_t* regPath = kWallpaperRegPath);
