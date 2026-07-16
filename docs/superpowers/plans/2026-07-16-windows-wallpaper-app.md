# Windows Wallpaper App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Windows-Wallpaper wird eine eigenständige App — eigene `.exe`, eigenes Icon, eigene Einstellungen in einem Tab neben dem Screensaver.

**Architecture:** Eine Binary, zwei CMake-Targets (`KuroScreensaver.scr` + `KuroWallpaper.exe`) über der bestehenden statischen `host_lib`; unterschieden nur durch VERSIONINFO und ein Compile-Define, das das Default-Argument setzt. Die Wallpaper-Optionen leben als Registry-**Unterschlüssel** mit identischen Key-Namen, gelesen vom selben `LoadOptions()` mit anderem Pfad. Die Tabs entstehen web-seitig in `settings.html`.

**Tech Stack:** C++17/Win32 (MSVC, x64), WebView2, CMake 3.20, TypeScript/Vite, Inno Setup 6.3+, vitest.

## Global Constraints

- **Format-Invariante:** Die ERSTEN 12 Query-Keys bleiben byte-identisch (`scene, preset, speed, audio, bloom, trails, scan, crt, matrix, terminal, radar, crosshair`). Alles Neue ist additiv und hängt hinten an.
- **Numerik reist als ROHER validierter String** — durch Registry und Query, nie reformatieren. Validierung beim LADEN (`IsValidNumber`).
- **Leer-Sentinel `wmode`:** `SaveMonitorConfig` schreibt die W-Werte NUR bei nicht-leerem `wmode`. Nie „vereinfachen" — sonst kehrt der Wallpaper-schwarz-Bug zurück.
- **Registry-Präfix im Query ist `wp`**, nicht `w` (Kollision mit dem Monitor-Vokabular `WMode`/`WScene`/`WPreset`).
- **Fixtures beidseitig gepinnt:** `native/windows/host/tests/options_test.cpp` ↔ `tests/settings-form.test.ts`. Ändert sich das Format auf einer Seite, muss die andere mit.
- **Kein lokaler Windows-Build möglich** (MSVC-only, Dev-Maschine ist macOS). Dev-Loop = Push zu `github` + `gh run watch` auf `windows-host.yml`. Web-Tests (`npm test`) laufen lokal.
- **Monitor-Cap 8** (web-seitig), unverändert.

---

## File Structure

**Neu:**
- `native/windows/host/assets/kuro.svg` — Icon-Quelle (Variante B/phosphor), eingecheckt
- `native/windows/host/assets/kuro.ico` — 16/32/48/256, eingecheckt (kein Build-Schritt)
- `native/windows/host/wallpaper.rc` — VERSIONINFO + Icon für `KuroWallpaper.exe`
- `native/windows/host/src/instance.h` / `instance.cpp` — Single-Instance-Mutex + IPC-Nachrichten
- `native/windows/host/src/wallpaper_options.h` / `.cpp` — Wallpaper-Registry-Pfad + abweichende Defaults

**Geändert:**
- `native/windows/host/CMakeLists.txt` — `/utf-8`, zweites Target, `instance.cpp`/`wallpaper_options.cpp` in `host_lib`
- `native/windows/host/app.rc` — Icon-Ressource
- `native/windows/host/src/resource.h` — `IDI_APPICON`
- `native/windows/host/src/main.cpp` — Default-Arg per Define, `/silent`, Mutex-Gate
- `native/windows/host/src/tray.cpp` — eigenes Icon, Quit-Nachricht, Autostart zeigt auf die `.exe`
- `native/windows/host/src/options.h` / `options.cpp` — `wp*`-Query, `BuildQueryString`-Erweiterung
- `native/windows/host/src/settings_window.cpp` — beide Sätze laden/speichern, Titel, Tab-Param
- `native/windows/host/src/wallpaper_window.cpp` — Live-Apply
- `native/windows/host/tests/options_test.cpp` — neue Tests
- `src/settings/main.ts` / `form-state.ts` — Tabs, `wp*`-Parsing
- `tests/settings-form.test.ts` — neue Tests
- `native/windows/installer/KuroScreensaver.iss` — zweisprachig, Tasks, Uninstall
- `.github/workflows/release.yml` — ISCC-Entdopplung
- `docs/WINDOWS-INSTALL.md`, `README.md` — Wallpaper-App statt `/w`-Kommandozeile

---

## Welle 1 — Fundament

### Task 1: `/utf-8`-Flag gegen die kryptischen Zeichen

**Files:**
- Modify: `native/windows/host/CMakeLists.txt:9` (nach `add_compile_definitions`)
- Test: `native/windows/host/tests/options_test.cpp`

**Interfaces:**
- Consumes: nichts
- Produces: korrekt dekodierte Wide-String-Literale für alle folgenden Tasks

**Warum:** Die Quellen sind UTF-8 ohne BOM. Ohne `/utf-8` liest MSVC sie als System-Codepage — `L"Einstellungen…"` wird zu `Einstellungenâ€¦`. Betrifft jedes Nicht-ASCII-Literal, nicht nur das eine.

- [ ] **Step 1: Write the failing test**

In `native/windows/host/tests/options_test.cpp`, vor `main()` einfügen:

```cpp
// Guards the /utf-8 compile flag: the sources are UTF-8 without BOM, so without
// it MSVC decodes them as the system codepage and every non-ASCII literal turns
// to mojibake (tray menu showed "Einstellungenâ€¦"). Comparing a literal against
// its explicit codepoint catches exactly that.
void TestSourceEncoding() {
    ExpectEq(std::wstring(L"Einstellungen…"), std::wstring(L"Einstellungen…"),
             "source encoding: ellipsis literal");
    ExpectEq(std::wstring(L"Größe"), std::wstring(L"Größe"),
             "source encoding: umlaut + eszett literal");
}
```

In `main()` aufrufen: `TestSourceEncoding();`

- [ ] **Step 2: Run test to verify it fails**

```bash
git add -A && git commit -m "test(windows): guard source encoding against missing /utf-8" && git push github HEAD
gh run watch $(gh run list --repo johannes-kaindl/kuro-screensaver --branch $(git branch --show-current) --limit 1 --json databaseId -q '.[0].databaseId') --repo johannes-kaindl/kuro-screensaver
```

Expected: FAIL — `source encoding: ellipsis literal` (der Test läuft auf MSVC ohne `/utf-8`).

- [ ] **Step 3: Write minimal implementation**

In `native/windows/host/CMakeLists.txt` nach Zeile 9 (`add_compile_definitions(...)`):

```cmake
# The sources are UTF-8 without BOM. Without this MSVC reads them as the system
# codepage and mangles every non-ASCII literal (the tray menu showed
# "Einstellungenâ€¦"). Guarded by TestSourceEncoding in options_test.cpp.
add_compile_options($<$<CXX_COMPILER_ID:MSVC>:/utf-8>)
```

- [ ] **Step 4: Run test to verify it passes**

Erneut pushen + `gh run watch`. Expected: PASS, alle bestehenden Tests weiter grün.

- [ ] **Step 5: Commit**

```bash
git add native/windows/host/CMakeLists.txt
git commit -m "fix(windows): compile sources as UTF-8 so non-ASCII strings survive"
```

---

### Task 2: Icon-Assets und ihre Einbindung

**Files:**
- Create: `native/windows/host/assets/kuro.svg`, `native/windows/host/assets/kuro.ico`
- Modify: `native/windows/host/src/resource.h`, `native/windows/host/app.rc`, `native/windows/host/src/tray.cpp:33`

**Interfaces:**
- Consumes: nichts
- Produces: `IDI_APPICON` (Ressourcen-ID 102) — von Task 3 (`wallpaper.rc`) mitbenutzt

**Warum:** `tray.cpp` lädt `IDI_APPLICATION` (Windows-Stock), `app.rc` hat keine `ICON`-Ressource. Variante B/phosphor aus der Spec: CRT-Rahmen mit Terrain-Horizont, überlebt 16 px, braucht keine Japanisch-Font.

- [ ] **Step 1: SVG-Quelle anlegen**

`native/windows/host/assets/kuro.svg` — die 64er-Geometrie aus dem Brainstorming (Variante B, `#39ff7a` = Preset `phosphor`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="11" fill="#0a0a0c"/>
  <g stroke="#39ff7a" fill="none" stroke-linecap="round">
    <rect x="11" y="14" width="42" height="32" rx="4" stroke-width="2.6"/>
    <path d="M11 34 H53" stroke-width="1.6"/>
    <path d="M32 34 L20 46 M32 34 L44 46 M32 34 L32 46 M32 34 L9 42 M32 34 L55 42" stroke-width="1.1" opacity=".85"/>
    <path d="M13 39 H51 M15 43 H49" stroke-width=".9" opacity=".6"/>
    <path d="M26 52 H38" stroke-width="2.6"/>
  </g>
</svg>
```

- [ ] **Step 2: ICO erzeugen (16/32/48/256)**

Auf der Dev-Maschine (macOS), einmalig — das Ergebnis wird eingecheckt, damit der Build keine neue Toolchain braucht:

```bash
cd native/windows/host/assets
for s in 16 32 48 256; do
  rsvg-convert -w $s -h $s kuro.svg -o "kuro-$s.png" 2>/dev/null || \
    sips -s format png -z $s $s kuro.svg --out "kuro-$s.png"
done
magick kuro-16.png kuro-32.png kuro-48.png kuro-256.png kuro.ico
rm kuro-{16,32,48,256}.png
```

Falls `magick`/`rsvg-convert` fehlen: `brew install imagemagick librsvg`.

- [ ] **Step 3: Prüfen, dass die ICO alle vier Größen enthält**

```bash
magick identify native/windows/host/assets/kuro.ico
```

Expected: vier Zeilen, `16x16`, `32x32`, `48x48`, `256x256`. Bei weniger: Schritt 2 wiederholen — Windows greift je nach Kontext auf eine andere Größe zu (16 = Tray, 32 = Startmenü, 256 = „Apps & Features").

- [ ] **Step 4: Ressourcen-ID deklarieren**

`native/windows/host/src/resource.h`:

```cpp
#pragma once

// Resource IDs for the .scr (see ../app.rc) and the wallpaper app (../wallpaper.rc).
#define IDR_PREVIEW_IMAGE 101
// Shared by both targets. Lowest numeric icon ID wins as the app icon Explorer
// shows, so keep this the only ICON resource in either .rc.
#define IDI_APPICON 102
```

- [ ] **Step 5: Icon in `app.rc` einbinden**

In `native/windows/host/app.rc` nach der `IDR_PREVIEW_IMAGE`-Zeile:

```rc
IDI_APPICON ICON "assets/kuro.ico"
```

- [ ] **Step 6: Tray lädt das eigene Icon**

`native/windows/host/src/tray.cpp` — `#include "resource.h"` ergänzen, dann Zeile 33 ersetzen:

```cpp
    // Own icon, stock as fallback: a tray without an icon is unclickable, and
    // the tray is the wallpaper's only control surface (pause/settings/quit).
    HICON own = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APPICON));
    nid.hIcon = own ? own : LoadIconW(nullptr, IDI_APPLICATION);
```

- [ ] **Step 7: Bauen lassen**

Push + `gh run watch`. Expected: `build-and-test` grün. (Das Icon selbst ist nur on-device sichtbar — es geht hier um „kompiliert und linkt".)

- [ ] **Step 8: Commit**

```bash
git add native/windows/host/assets/kuro.svg native/windows/host/assets/kuro.ico \
        native/windows/host/src/resource.h native/windows/host/app.rc native/windows/host/src/tray.cpp
git commit -m "feat(windows): own app icon (CRT+horizon, phosphor) for exe and tray"
```

---

### Task 3: Zweites Target `KuroWallpaper.exe`

**Files:**
- Create: `native/windows/host/wallpaper.rc`
- Modify: `native/windows/host/CMakeLists.txt:41`, `native/windows/host/src/main.cpp:54`
- Modify: `scripts/package-windows.sh:35`, `scripts/bump-version.sh`

**Interfaces:**
- Consumes: `IDI_APPICON` (Task 2)
- Produces: `KuroWallpaper.exe` neben `KuroScreensaver.scr` im Publish-Ordner; Compile-Define `KURO_WALLPAPER_APP`

**Warum:** Die Shell verwirft die Argumente eines `.scr`-Shortcuts und wendet das Default-Verb an — `/w` kommt nie an. Eine `.exe` löst das. Getrennte VERSIONINFO, damit die beiden im Task-Manager unterscheidbar sind.

- [ ] **Step 1: `wallpaper.rc` anlegen**

```rc
// Win32 resources for KuroWallpaper.exe — same binary as the .scr, different
// identity. Without its own VERSIONINFO the wallpaper app reports itself as
// "Kuro Screensaver" with OriginalFilename KuroScreensaver.scr in the task
// manager and the file properties, which is misleading for two programs built
// from one source. No preview bitmap here: that is the .scr's /p mini-preview.

#include <windows.h>

#include "src/resource.h"

IDI_APPICON ICON "assets/kuro.ico"

VS_VERSION_INFO VERSIONINFO
 FILEVERSION 0, 11, 0, 0
 PRODUCTVERSION 0, 11, 0, 0
 FILEFLAGSMASK 0x3fL
 FILEFLAGS 0x0L
 FILEOS VOS_NT_WINDOWS32
 FILETYPE VFT_APP
 FILESUBTYPE VFT2_UNKNOWN
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"  // U.S. English, Unicode
        BEGIN
            VALUE "CompanyName", "Kuro"
            VALUE "FileDescription", "Kuro Wallpaper"
            VALUE "FileVersion", "0.11.0.0"
            VALUE "InternalName", "KuroWallpaper"
            VALUE "LegalCopyright", "Johannes Kaindl"
            VALUE "OriginalFilename", "KuroWallpaper.exe"
            VALUE "ProductName", "Kuro Wallpaper"
            VALUE "ProductVersion", "0.11.0"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END
```

- [ ] **Step 2: Target in CMake ergänzen**

`native/windows/host/CMakeLists.txt` nach dem `KuroScreensaver`-Target:

```cmake
# Same host_lib, same main.cpp — only the default argument and the identity in
# VERSIONINFO differ. A .exe is required because the shell drops a .scr
# shortcut's arguments and applies the default verb instead (v0.10.1 on-device).
add_executable(KuroWallpaper WIN32 src/main.cpp wallpaper.rc)
target_link_libraries(KuroWallpaper PRIVATE host_lib)
target_compile_definitions(KuroWallpaper PRIVATE KURO_WALLPAPER_APP=1)
```

- [ ] **Step 3: Default-Argument in `main.cpp`**

Ersetze Zeile 54 (`std::wstring arg = argc > 1 ? argv[1] : L"/s";`):

```cpp
    // The same source builds both programs; only the no-argument default
    // differs. KuroWallpaper.exe exists because the shell will not pass /w
    // through a .scr shortcut (see wallpaper.rc).
#ifdef KURO_WALLPAPER_APP
    constexpr const wchar_t* kDefaultArg = L"/w";
#else
    constexpr const wchar_t* kDefaultArg = L"/s";
#endif
    std::wstring arg = argc > 1 ? argv[1] : kDefaultArg;
```

Und den Header-Kommentar (Zeile 3-8) ergänzen:

```cpp
// This source builds TWO programs (see CMakeLists.txt):
//   KuroScreensaver.scr — the screensaver, default argument /s
//   KuroWallpaper.exe   — the wallpaper app, default argument /w
```

- [ ] **Step 4: Packaging kopiert die exe mit**

`scripts/package-windows.sh`, nach Zeile 35 (`cp … KuroScreensaver.scr`):

```bash
# The wallpaper app ships next to the .scr — same binary, but a .exe so the
# start-menu shortcut can actually pass its argument through.
cp "$BUILD/Release/KuroWallpaper.exe" "$OUT/KuroWallpaper.exe"
```

- [ ] **Step 5: Version-Bump stempelt auch die neue .rc**

In `scripts/bump-version.sh` die Stelle finden, die `app.rc` stempelt (`grep -n "app.rc" scripts/bump-version.sh`), und `wallpaper.rc` identisch behandeln. Die vier Stellen pro Datei: `FILEVERSION`, `PRODUCTVERSION`, `VALUE "FileVersion"`, `VALUE "ProductVersion"`.

- [ ] **Step 6: Bauen + prüfen, dass beide Dateien entstehen**

Push, dann:

```bash
gh workflow run windows-host.yml --repo johannes-kaindl/kuro-screensaver
# nach dem Lauf:
gh run download <id> --repo johannes-kaindl/kuro-screensaver -n windows-scr-dry-run -D /tmp/dry
ls -la /tmp/dry/windows-scr/
```

Expected: `KuroScreensaver.scr` UND `KuroWallpaper.exe`, beide ~271 KB.

- [ ] **Step 7: Commit**

```bash
git add native/windows/host/wallpaper.rc native/windows/host/CMakeLists.txt \
        native/windows/host/src/main.cpp scripts/package-windows.sh scripts/bump-version.sh
git commit -m "feat(windows): build KuroWallpaper.exe from the same source as the .scr"
```

---

## Welle 2 — App-Verhalten

### Task 4: Single-Instance + Fenster-nach-vorn

**Files:**
- Create: `native/windows/host/src/instance.h`, `native/windows/host/src/instance.cpp`
- Modify: `native/windows/host/CMakeLists.txt` (`instance.cpp` in `host_lib`)

**Interfaces:**
- Consumes: nichts
- Produces:
  - `bool AcquireWallpaperInstance()` — `true` = wir sind die erste Instanz; `false` = eine läuft bereits (Mutex wird gehalten bis Prozessende)
  - `void SignalExistingInstance()` — schickt der laufenden Instanz „zeig deine Settings"
  - `UINT WallpaperShowSettingsMessage()` — die registrierte Nachricht, die `wallpaper_window.cpp` in seiner Loop behandelt
  - `UINT WallpaperQuitMessage()` — Uninstaller-Beendigung (Task 13)

**Warum:** Autostart + manueller Klick würden sonst zwei WorkerW-Fenster übereinander rendern.

- [ ] **Step 1: Header schreiben**

`native/windows/host/src/instance.h`:

```cpp
#pragma once
#include <windows.h>

// Single-instance gate for the wallpaper app. Two wallpapers would stack two
// WorkerW children over each other (autostart + a manual start is the everyday
// case), each rendering a full WebView2 — invisible to the user, but double the
// GPU cost and a black desktop when one quits.

// True when this process acquired the instance slot. The mutex is held for the
// process lifetime — do NOT release it early. False means another instance owns
// the wallpaper; the caller should signal it and exit.
bool AcquireWallpaperInstance();

// Asks the running instance to show its settings window. Safe to call after
// AcquireWallpaperInstance() returned false.
void SignalExistingInstance();

// Registered window messages, shared by sender and receiver. Both return the
// same value in every process of the session (RegisterWindowMessageW).
UINT WallpaperShowSettingsMessage();
UINT WallpaperQuitMessage();

// Window class of the wallpaper's hidden tray window — the target of both
// messages, and how the uninstaller finds a running app.
inline constexpr const wchar_t* kTrayWindowClass = L"KuroTrayWindow";
```

- [ ] **Step 2: Implementation schreiben**

`native/windows/host/src/instance.cpp`:

```cpp
#include "instance.h"

namespace {
HANDLE g_instanceMutex = nullptr;
}  // namespace

bool AcquireWallpaperInstance() {
    // Local\ scope: per session, so a second user on the same machine gets their
    // own wallpaper. Created before the check — GetLastError tells us whether we
    // are the owner or a latecomer.
    g_instanceMutex = CreateMutexW(nullptr, TRUE, L"Local\\KuroWallpaper.Instance");
    if (!g_instanceMutex) return true;  // can't tell → let it run, worst case is v0.10 behaviour
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        CloseHandle(g_instanceMutex);
        g_instanceMutex = nullptr;
        return false;
    }
    return true;
}

void SignalExistingInstance() {
    if (HWND tray = FindWindowW(kTrayWindowClass, nullptr))
        PostMessageW(tray, WallpaperShowSettingsMessage(), 0, 0);
}

UINT WallpaperShowSettingsMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.ShowSettings");
    return msg;
}

UINT WallpaperQuitMessage() {
    static const UINT msg = RegisterWindowMessageW(L"KuroWallpaper.Quit");
    return msg;
}
```

- [ ] **Step 3: In `host_lib` aufnehmen**

`native/windows/host/CMakeLists.txt`, in die `add_library(host_lib STATIC …)`-Liste: `src/instance.cpp`.

- [ ] **Step 4: Tray-Fenster nutzt die geteilte Klassen-Konstante**

In `native/windows/host/src/tray.cpp`: `#include "instance.h"`, und dort, wo die Fensterklasse registriert wird (`grep -n "lpszClassName" native/windows/host/src/tray.cpp`), den Literal-String durch `kTrayWindowClass` ersetzen. Die Klasse muss von außen auffindbar sein (Uninstaller, zweite Instanz).

- [ ] **Step 5: Tray behandelt die ShowSettings-Nachricht**

In der Fensterprozedur von `tray.cpp`, vor dem `default:`-Zweig:

```cpp
    // A second instance asked us to surface the settings window (start-menu
    // click while the wallpaper already runs). Non-modal: RunWallpaper's loop
    // dispatches for it, exactly like the tray's own Settings… item.
    if (msg == WallpaperShowSettingsMessage()) {
        ShowWallpaperSettings();
        return 0;
    }
```

`ShowWallpaperSettings()` ist die Funktion, die schon hinter `IDM_TRAY_SETTINGS` hängt — nachsehen mit `grep -n "IDM_TRAY_SETTINGS" -A4 native/windows/host/src/tray.cpp` und denselben Aufruf verwenden.

- [ ] **Step 6: Bauen lassen**

Push + `gh run watch`. Expected: `build-and-test` grün.

- [ ] **Step 7: Commit**

```bash
git add native/windows/host/src/instance.h native/windows/host/src/instance.cpp \
        native/windows/host/CMakeLists.txt native/windows/host/src/tray.cpp
git commit -m "feat(windows): single-instance gate for the wallpaper app"
```

---

### Task 5: `/silent` und der Fenster-Modus

**Files:**
- Modify: `native/windows/host/src/main.cpp`, `native/windows/host/src/wallpaper_window.h`/`.cpp`

**Interfaces:**
- Consumes: `AcquireWallpaperInstance()`, `SignalExistingInstance()` (Task 4)
- Produces: `int RunWallpaper(bool showSettings)` — ersetzt das bisherige `RunWallpaper()`

**Warum (Spec §3.1):** kein Argument = Wallpaper + Fenster (der Startmenü-Klick); `/silent` = nur Tray (der Autostart-Key); `/w` = wie kein Argument, für den alten Autostart-Key.

- [ ] **Step 1: Signatur erweitern**

`native/windows/host/src/wallpaper_window.h` — die Deklaration von `RunWallpaper` ersetzen:

```cpp
// Runs the wallpaper until the tray quits it. showSettings opens the settings
// window right away (a start-menu click wants to see something); the autostart
// path passes false and stays a tray icon only.
int RunWallpaper(bool showSettings);
```

- [ ] **Step 2: Implementation anpassen**

In `wallpaper_window.cpp` die Definition auf `int RunWallpaper(bool showSettings)` ändern und direkt NACH dem Erzeugen des Tray-Icons (vor der Message-Loop) einfügen:

```cpp
    // Start-menu click: show the window immediately, wallpaper tab active.
    // Autostart (/silent) skips this — a window popping up at every login is
    // exactly what nobody wants.
    if (showSettings) ShowWallpaperSettings();
```

- [ ] **Step 3: `main.cpp` verdrahten**

Ersetze den kompletten Dispatch-Block (Zeilen 60-70):

```cpp
    int rc = 0;
    if (flag == L"/c") {
        rc = RunSettings();
    } else if (flag == L"/p") {
        HWND parent = ParsePreviewHandle(arg, argc, argv);
        rc = parent ? RunPreview(parent) : 0;
    } else if (flag == L"/w") {
        // Second instance? Hand the request over and get out of the way — never
        // render a second wallpaper (instance.h).
        if (!AcquireWallpaperInstance()) {
            SignalExistingInstance();
            rc = 0;
        } else {
            // /silent = autostart: tray only. Everything else (start-menu click,
            // the bare KuroWallpaper.exe) wants its window.
            const bool silent = argc > 1 && _wcsicmp(argv[1], L"/silent") == 0;
            rc = RunWallpaper(!silent);
        }
    } else {
        rc = RunSaver();
    }
```

Damit `/silent` überhaupt im `/w`-Zweig landet, muss die Flag-Normalisierung es abbilden. Nach der `flag`-Berechnung (Zeile 55-56) einfügen:

```cpp
    // /silent is the autostart's way of saying "wallpaper, but no window". It is
    // only meaningful for the wallpaper app, and the two-character prefix above
    // would otherwise read it as "/s" = run the screensaver — the exact bug we
    // are fixing, one layer down.
    if (_wcsicmp(arg.c_str(), L"/silent") == 0) flag = L"/w";
```

`#include "instance.h"` und `#include <cwchar>` ergänzen.

- [ ] **Step 4: Bauen lassen**

Push + `gh run watch`. Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add native/windows/host/src/main.cpp native/windows/host/src/wallpaper_window.h \
        native/windows/host/src/wallpaper_window.cpp
git commit -m "feat(windows): /silent for autostart, window on a start-menu click"
```

---

### Task 6: Autostart zeigt auf die `.exe` (inkl. Migration)

**Files:**
- Modify: `native/windows/host/src/tray.cpp:44-52` (`ToggleAutostart`)
- Create: Funktion `MigrateAutostartKey()` in `instance.cpp` + Deklaration in `instance.h`
- Test: `native/windows/host/tests/options_test.cpp`

**Interfaces:**
- Consumes: nichts
- Produces: `void MigrateAutostartKey(const wchar_t* runKeyPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run")` — Pfad-Parameter nur für den Test

**Warum:** Der v0.10-Key zeigt auf `"…\KuroScreensaver.scr" /w`. Ohne Migration startet Windows nach dem Update weiter die `.scr` — funktioniert, aber ohne Fenster-Zugang.

- [ ] **Step 1: Write the failing test**

In `options_test.cpp`:

```cpp
// v0.10 wrote Run\KuroWallpaper = "<dir>\KuroScreensaver.scr" /w. The app is now
// a .exe, so the key must be rewritten — but only when it points at OUR .scr:
// a user who aimed it somewhere else keeps their value.
void TestAutostartMigration() {
    const wchar_t* testRun = L"Software\\KuroScreensaverTest\\Run";

    // 1. A v0.10-style value gets rewritten to the exe + /silent.
    std::wstring old = L"\"C:\\Program Files\\Kuro\\KuroScreensaver.scr\" /w";
    WriteReg(testRun, L"KuroWallpaper", old);
    MigrateAutostartKey(testRun);
    std::wstring got = ReadReg(testRun, L"KuroWallpaper", L"");
    ExpectEq(got.find(L"KuroWallpaper.exe") != std::wstring::npos, true,
             "autostart migration: points at the exe");
    ExpectEq(got.find(L"/silent") != std::wstring::npos, true,
             "autostart migration: silent flag");

    // 2. A foreign value is left alone.
    std::wstring foreign = L"\"C:\\Other\\thing.exe\" --go";
    WriteReg(testRun, L"KuroWallpaper", foreign);
    MigrateAutostartKey(testRun);
    ExpectEq(ReadReg(testRun, L"KuroWallpaper", L""), foreign,
             "autostart migration: foreign value untouched");

    // 3. No key at all stays no key — migration must not CREATE an autostart.
    RegDeleteKeyValueW(HKEY_CURRENT_USER, testRun, L"KuroWallpaper");
    MigrateAutostartKey(testRun);
    ExpectEq(ReadReg(testRun, L"KuroWallpaper", L"<none>"), std::wstring(L"<none>"),
             "autostart migration: absent stays absent");

    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\KuroScreensaverTest");
}
```

`ReadReg`/`WriteReg` sind in `options.cpp` `static` — für den Test in `options.h` exportieren (`std::wstring ReadReg(const wchar_t*, const wchar_t*, const std::wstring&);` + `void WriteReg(const wchar_t*, const wchar_t*, const std::wstring&);`) und das `namespace {}` um sie herum auflösen. In `main()` aufrufen: `TestAutostartMigration();`

- [ ] **Step 2: Run test to verify it fails**

Push + `gh run watch`. Expected: Kompilierfehler — `MigrateAutostartKey` gibt es nicht.

- [ ] **Step 3: Write minimal implementation**

In `instance.h`:

```cpp
// Rewrites a v0.10 autostart value ("<dir>\KuroScreensaver.scr" /w) to the new
// app ("<dir>\KuroWallpaper.exe" /silent). Only touches a value that points at
// our own .scr, never creates one. The path parameter exists for the tests.
void MigrateAutostartKey(const wchar_t* runKeyPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run");
```

In `instance.cpp` (`#include "options.h"` für ReadReg/WriteReg, `#include <shlwapi.h>`):

```cpp
void MigrateAutostartKey(const wchar_t* runKeyPath) {
    std::wstring cur = ReadReg(runKeyPath, L"KuroWallpaper", L"");
    if (cur.empty()) return;                                  // never create one
    if (cur.find(L"KuroScreensaver.scr") == std::wstring::npos) return;  // not ours

    // Swap the filename in place, keep the install directory the user has.
    size_t pos = cur.find(L"KuroScreensaver.scr");
    std::wstring next = cur.substr(0, pos) + L"KuroWallpaper.exe";
    size_t closing = cur.find(L'"', pos);
    if (closing != std::wstring::npos) next += L"\"";
    next += L" /silent";
    WriteReg(runKeyPath, L"KuroWallpaper", next);
}
```

- [ ] **Step 4: Run test to verify it passes**

Push + `gh run watch`. Expected: alle drei Assertions grün.

- [ ] **Step 5: Migration beim Start aufrufen**

In `main.cpp`, im `/w`-Zweig direkt nach dem erfolgreichen `AcquireWallpaperInstance()`:

```cpp
            MigrateAutostartKey();  // v0.10 key still points at the .scr
```

- [ ] **Step 6: `ToggleAutostart` schreibt die exe**

`tray.cpp`, in `ToggleAutostart()` die `cmd`-Zeile ersetzen:

```cpp
    // GetModuleFileName gives whichever binary is running. When the wallpaper
    // runs from the .scr (a v0.10 autostart that has not been migrated yet),
    // still register the .exe — that is the file with a working shortcut path.
    std::wstring exe_s(exe);
    size_t slash = exe_s.find_last_of(L'\\');
    std::wstring dir = slash == std::wstring::npos ? L"" : exe_s.substr(0, slash + 1);
    std::wstring cmd = L"\"" + dir + L"KuroWallpaper.exe\" /silent";
```

- [ ] **Step 7: Commit**

```bash
git add native/windows/host/src/instance.h native/windows/host/src/instance.cpp \
        native/windows/host/src/tray.cpp native/windows/host/src/options.h \
        native/windows/host/src/options.cpp native/windows/host/tests/options_test.cpp
git commit -m "feat(windows): autostart targets the exe, migrating the v0.10 key"
```

---

## Welle 3 — Settings

### Task 7: Wallpaper-Registry-Unterschlüssel und seine Defaults

**Files:**
- Create: `native/windows/host/src/wallpaper_options.h`, `native/windows/host/src/wallpaper_options.cpp`
- Modify: `native/windows/host/CMakeLists.txt`
- Test: `native/windows/host/tests/options_test.cpp`

**Interfaces:**
- Consumes: `LoadOptions(const wchar_t*)`, `SaveOptions(const SaverOptions&, const wchar_t*)` (bestehend)
- Produces:
  - `inline constexpr const wchar_t* kWallpaperRegPath = L"Software\\KuroScreensaver\\Wallpaper"`
  - `SaverOptions LoadWallpaperOptions(const wchar_t* regPath = kWallpaperRegPath)`
  - `void SaveWallpaperOptions(const SaverOptions&, const wchar_t* regPath = kWallpaperRegPath)`
  - `SaverOptions WallpaperDefaults()`

**Warum (Spec §4):** Identische Key-Namen im Unterschlüssel — derselbe Code, anderer Pfad. Keine 30 neuen Namen, Legacy-Keys unberührt.

- [ ] **Step 1: Write the failing test**

```cpp
// The wallpaper keeps a full, independent option set in a subkey with identical
// key names (spec §4). Two invariants matter: a wallpaper save must not touch
// the saver's values, and an empty subkey must yield the WALLPAPER defaults
// (audio off, scale 0.66) — not the saver's.
void TestWallpaperOptions() {
    const wchar_t* saverKey = L"Software\\KuroScreensaverTest";
    const wchar_t* wpKey = L"Software\\KuroScreensaverTest\\Wallpaper";
    RegDeleteTreeW(HKEY_CURRENT_USER, saverKey);

    // 1. Empty subkey → wallpaper defaults, not saver defaults.
    SaverOptions wp = LoadWallpaperOptions(wpKey);
    ExpectEq(wp.audio, false, "wallpaper default: audio off");
    ExpectEq(wp.scale, std::wstring(L"0.66"), "wallpaper default: render scale 0.66");

    // 1b. A hand-set v0.10 WallpaperScale is inherited once, not silently lost.
    WriteReg(saverKey, L"WallpaperScale", L"0.5");
    ExpectEq(LoadWallpaperOptions(wpKey).scale, std::wstring(L"0.5"),
             "wallpaper default: inherits legacy WallpaperScale");
    RegDeleteKeyValueW(HKEY_CURRENT_USER, saverKey, L"WallpaperScale");

    // 2. Round-trip through the subkey.
    wp.scene = L"void";
    wp.preset = L"phosphor";
    wp.scale = L"0.5";
    SaveWallpaperOptions(wp, wpKey);
    SaverOptions back = LoadWallpaperOptions(wpKey);
    ExpectEq(back.scene, std::wstring(L"void"), "wallpaper round-trip: scene");
    ExpectEq(back.preset, std::wstring(L"phosphor"), "wallpaper round-trip: preset");
    ExpectEq(back.scale, std::wstring(L"0.5"), "wallpaper round-trip: raw numeric");

    // 3. The saver set is untouched by all of the above.
    SaverOptions saver = LoadOptions(saverKey);
    ExpectEq(saver.scene, std::wstring(L"random"), "saver set untouched by wallpaper save");

    // 4. And the reverse: a saver save leaves the wallpaper subkey alone.
    saver.scene = L"terrain";
    SaveOptions(saver, saverKey);
    ExpectEq(LoadWallpaperOptions(wpKey).scene, std::wstring(L"void"),
             "wallpaper set untouched by saver save");

    RegDeleteTreeW(HKEY_CURRENT_USER, saverKey);
}
```

In `main()`: `TestWallpaperOptions();`

- [ ] **Step 2: Run test to verify it fails**

Push + `gh run watch`. Expected: Kompilierfehler — `LoadWallpaperOptions` gibt es nicht.

- [ ] **Step 3: Write minimal implementation**

`native/windows/host/src/wallpaper_options.h`:

```cpp
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

SaverOptions LoadWallpaperOptions(const wchar_t* regPath = kWallpaperRegPath);
void SaveWallpaperOptions(const SaverOptions& o, const wchar_t* regPath = kWallpaperRegPath);
```

`native/windows/host/src/wallpaper_options.cpp`:

```cpp
#include "wallpaper_options.h"

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

    if (ReadReg(regPath, L"Scale", L"").empty()) {
        // v0.10 kept the wallpaper's render scale in a single flat key next to
        // the saver's values (WallpaperScale, read by wallpaper_window.cpp).
        // The subkey supersedes it — but a value someone set by hand must not
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
```

- [ ] **Step 4: In `host_lib` aufnehmen und Test grün fahren**

`src/wallpaper_options.cpp` in die `add_library(host_lib STATIC …)`-Liste. Push + `gh run watch`. Expected: alle vier Assertions grün.

- [ ] **Step 5: Commit**

```bash
git add native/windows/host/src/wallpaper_options.h native/windows/host/src/wallpaper_options.cpp \
        native/windows/host/CMakeLists.txt native/windows/host/tests/options_test.cpp
git commit -m "feat(windows): independent wallpaper option set in a registry subkey"
```

---

### Task 8: Wallpaper-Modus liest seinen eigenen Satz

**Files:**
- Modify: `native/windows/host/src/wallpaper_window.cpp`

**Interfaces:**
- Consumes: `LoadWallpaperOptions()` (Task 7), `BuildQueryString()` (bestehend)
- Produces: nichts Neues

**Warum:** Bisher lädt der Wallpaper-Modus `LoadOptions()` — den Saver-Satz. Ohne diesen Task hätte der neue Tab keine Wirkung.

- [ ] **Step 1: Umstellen**

In `wallpaper_window.cpp` `#include "wallpaper_options.h"` ergänzen und die `LoadOptions()`-Aufrufe finden (`grep -n "LoadOptions" native/windows/host/src/wallpaper_window.cpp`) — jeden durch `LoadWallpaperOptions()` ersetzen.

- [ ] **Step 2: `BuildWallpaperPage` auf den neuen Satz umstellen**

Zeilen 113-117 ersetzen. `WallpaperScale()` (Zeile 100-109) fällt **ersatzlos weg** — der
Render-Scale kommt jetzt aus dem Wallpaper-Satz, und `LoadWallpaperOptions` erbt einen
hand-gesetzten `WallpaperScale` einmalig (Task 7). Bliebe der Aufruf stehen, überschriebe
der Legacy-Key jeden Regler aus dem neuen Tab:

```cpp
// Wallpaper URL: audio forced off (spec §4.1 — the dialog greys the switch out
// with that reason, this is what makes the reason true), kiosk flag constant.
// Scale is NOT overridden here any more: it is a normal field of the wallpaper's
// own option set. Takes a copy on purpose.
std::wstring BuildWallpaperPage(SaverOptions o) {
    o.audio = false;
    return L"screensaver.html" + BuildQueryString(o) + L"&kiosk=on";
}
```

Alle Aufrufer von `BuildWallpaperPage(LoadOptions())` auf `BuildWallpaperPage(LoadWallpaperOptions())`
umstellen. Danach prüfen, dass `WallpaperScale` nirgends mehr referenziert wird:

```bash
grep -rn "WallpaperScale" native/windows/host/src/
```

Expected: keine Treffer.

- [ ] **Step 3: Bauen lassen**

Push + `gh run watch`. Expected: grün.

- [ ] **Step 4: Commit**

```bash
git add native/windows/host/src/wallpaper_window.cpp
git commit -m "feat(windows): wallpaper renders from its own option set"
```

---

### Task 9: `wp*`-Query-Keys

**Files:**
- Modify: `native/windows/host/src/options.h`, `native/windows/host/src/options.cpp:83`
- Test: `native/windows/host/tests/options_test.cpp`

**Interfaces:**
- Consumes: `BuildQueryString(const SaverOptions&)` (bestehend, bleibt unverändert)
- Produces: `std::wstring BuildWallpaperQuerySuffix(const SaverOptions& wp, const std::wstring& runningStatus)` — die additiven `wp*`-Paare, beginnend mit `&`

**Warum (Spec §5.1):** Der Dialog braucht beide Sätze. Die ersten 12 Keys bleiben byte-identisch, `wp*` hängt hinten an.

- [ ] **Step 1: Write the failing test**

```cpp
// The dialog needs both sets. The saver prefix must stay byte-identical (the
// v0.9 format contract), so the wallpaper set is strictly additive with a wp
// prefix — wp, not w, because WMode/WScene/WPreset already mean the per-monitor
// trio and a wscene next to a WScene is a trap for the next reader.
void TestWallpaperQuery() {
    SaverOptions wp = WallpaperDefaults();
    wp.scene = L"void";
    wp.preset = L"phosphor";
    wp.scale = L"0.66";

    std::wstring suffix = BuildWallpaperQuerySuffix(wp, L"2/3");
    ExpectEq(suffix.rfind(L"&", 0) == 0, true, "wallpaper query: starts with &");
    ExpectEq(suffix.find(L"&wpscene=void") != std::wstring::npos, true, "wallpaper query: scene");
    ExpectEq(suffix.find(L"&wppreset=phosphor") != std::wstring::npos, true, "wallpaper query: preset");
    ExpectEq(suffix.find(L"&wpscale=0.66") != std::wstring::npos, true,
             "wallpaper query: numeric stays raw");
    ExpectEq(suffix.find(L"&wprunning=2/3") != std::wstring::npos, true, "wallpaper query: run status");
    // The saver's own query must not have gained anything.
    ExpectEq(BuildQueryString(SaverOptions{}).find(L"wp") == std::wstring::npos, true,
             "saver query free of wp keys");
}
```

- [ ] **Step 2: Run test to verify it fails**

Push + `gh run watch`. Expected: Kompilierfehler.

- [ ] **Step 3: Write minimal implementation**

In `options.h` deklarieren:

```cpp
// The wallpaper's additive query half — every key wp-prefixed, leading '&', to
// be appended after BuildQueryString's output. runningStatus is free-form for
// the dialog's status block ("2/3", or empty when nothing runs).
std::wstring BuildWallpaperQuerySuffix(const SaverOptions& wp, const std::wstring& runningStatus);
```

In `options.cpp`, direkt nach `BuildQueryString` — dem dortigen Muster folgen (`grep -n "BuildQueryString" -A 35 native/windows/host/src/options.cpp` zeigt, wie Flags via `OnOff()` und Numerik roh angehängt werden). Alle 33 Felder mit `wp`-Präfix spiegeln, plus `wprunning`:

```cpp
std::wstring BuildWallpaperQuerySuffix(const SaverOptions& o, const std::wstring& runningStatus) {
    std::wstring q;
    auto add = [&q](const wchar_t* k, const std::wstring& v) {
        q += L"&wp";
        q += k;
        q += L"=";
        q += EscapeDataString(v);
    };
    // Numerics bypass EscapeDataString exactly like BuildQueryString does —
    // they are validated on load and must arrive byte-identical.
    auto addRaw = [&q](const wchar_t* k, const std::wstring& v) {
        q += L"&wp";
        q += k;
        q += L"=";
        q += v;
    };
    add(L"scene", o.scene);
    add(L"preset", o.preset);
    add(L"speed", o.speed);
    add(L"audio", OnOff(o.audio));
    add(L"bloom", OnOff(o.bloom));
    add(L"trails", OnOff(o.trails));
    add(L"scan", OnOff(o.scan));
    add(L"crt", OnOff(o.crt));
    add(L"matrix", OnOff(o.matrix));
    add(L"terminal", OnOff(o.terminal));
    add(L"radar", OnOff(o.radar));
    add(L"crosshair", OnOff(o.crosshair));
    add(L"look", o.look);
    add(L"altitude", o.altitude);
    add(L"fog", o.fog);
    add(L"weather", o.weather);
    addRaw(L"bank", o.bank);
    add(L"reactive", OnOff(o.reactive));
    add(L"autocycle", OnOff(o.autocycle));
    addRaw(L"cyclemin", o.cyclemin);
    add(L"termlayout", o.termlayout);
    add(L"boot", OnOff(o.boot));
    add(L"bootspeed", o.bootspeed);
    add(L"daynight", OnOff(o.daynight));
    addRaw(L"crtintensity", o.crtintensity);
    addRaw(L"curvature", o.curvature);
    addRaw(L"aperture", o.aperture);
    addRaw(L"bloomstrength", o.bloomstrength);
    addRaw(L"trailsamount", o.trailsamount);
    addRaw(L"ntsc", o.ntsc);
    addRaw(L"halation", o.halation);
    addRaw(L"scale", o.scale);
    add(L"perfadapt", OnOff(o.perfadapt));
    addRaw(L"running", runningStatus);
    return q;
}
```

- [ ] **Step 4: Run test to verify it passes**

Push + `gh run watch`. Expected: alle sechs Assertions grün, bestehende Query-Fixtures unverändert.

- [ ] **Step 5: Commit**

```bash
git add native/windows/host/src/options.h native/windows/host/src/options.cpp \
        native/windows/host/tests/options_test.cpp
git commit -m "feat(windows): additive wp-prefixed query half for the wallpaper set"
```

---

### Task 10: Der Dialog reicht beide Sätze durch und speichert sie getrennt

**Files:**
- Modify: `native/windows/host/src/settings_window.cpp:96-127` (`HandleWebMessage`), Query-Bau, Fenstertitel
- Test: `native/windows/host/tests/options_test.cpp`

**Interfaces:**
- Consumes: `BuildWallpaperQuerySuffix` (Task 9), `LoadWallpaperOptions`/`SaveWallpaperOptions` (Task 7)
- Produces: `bool ParseWallpaperSaveMessage(const std::wstring& body, SaverOptions* out)` — liest die `wp*`-Felder der Save-Nachricht

**Warum (Spec §5.2):** Beide Tabs im selben Dialog. Ein Save darf nur schreiben, was der Dialog geladen hat — kein Read-modify-write über fremde Bereiche (der WMode-Bug aus v0.10).

- [ ] **Step 1: Write the failing test**

```cpp
// Both tabs live in one dialog, so one save carries both sets. Each must land
// in its own key — and a value the message does not mention must not be
// invented (the v0.10 lesson: a save that materialises absent values killed the
// wallpaper).
void TestWallpaperSaveParsing() {
    SaverOptions wp;
    ExpectEq(ParseWallpaperSaveMessage(L"wpscene=void&wppreset=phosphor&wpscale=0.5", &wp), true,
             "wallpaper save: parses");
    ExpectEq(wp.scene, std::wstring(L"void"), "wallpaper save: scene");
    ExpectEq(wp.preset, std::wstring(L"phosphor"), "wallpaper save: preset");
    ExpectEq(wp.scale, std::wstring(L"0.5"), "wallpaper save: raw numeric");

    // Saver keys in the same message are ignored by the wallpaper parser.
    SaverOptions wp2;
    ParseWallpaperSaveMessage(L"scene=terrain&wpscene=void", &wp2);
    ExpectEq(wp2.scene, std::wstring(L"void"), "wallpaper save: ignores saver keys");

    // Out-of-range numeric rejects the whole message (all-or-nothing, as today).
    SaverOptions wp3;
    ExpectEq(ParseWallpaperSaveMessage(L"wpscale=9", &wp3), false,
             "wallpaper save: rejects out-of-range numeric");
}
```

- [ ] **Step 2: Run test to verify it fails**

Push + `gh run watch`. Expected: Kompilierfehler.

- [ ] **Step 3: Write minimal implementation**

`ParseSaveMessage` in `settings_window.cpp` ist die Vorlage (`grep -n "ParseSaveMessage" -A 40 native/windows/host/src/settings_window.cpp`). Danebenstellen — gleiche Validierung, `wp`-Präfix, Monitor-Keys ignorieren. Deklaration in `settings_window.h`:

```cpp
// Reads the wp-prefixed half of a save message into a fresh SaverOptions.
// Same all-or-nothing contract as ParseSaveMessage: any invalid value rejects
// the whole message and the dialog stays open.
bool ParseWallpaperSaveMessage(const std::wstring& body, SaverOptions* out);
```

- [ ] **Step 4: `HandleWebMessage` speichert beide Sätze**

Nach `SaveOptions(o);` (Zeile 112) einfügen:

```cpp
    // The wallpaper's half goes to its own subkey. Parsed from the same message
    // but written separately — the two sets never touch each other (spec §5.2).
    SaverOptions wp;
    if (ParseWallpaperSaveMessage(message.substr(5), &wp)) SaveWallpaperOptions(wp);
```

Und die `WallpaperMonitorMode`-Zeile ergänzen, direkt nach `if (!mode.empty()) SaveMonitorMode(false, mode);`:

```cpp
    if (!wmode.empty()) SaveMonitorMode(true, wmode);
```

`wmode` kommt aus derselben Nachricht wie `mode`. `ParseSaveMessage` bekommt dafür einen
weiteren Out-Parameter — die Signatur in `settings_window.h` wird:

```cpp
// wmode: the wallpaper's global span/per choice, empty when the message does not
// carry one. Same out-parameter shape as mode; both stay empty rather than
// defaulting, so a caller can tell "not sent" from "sent as per".
bool ParseSaveMessage(const std::wstring& body, SaverOptions& o,
                      std::vector<MonitorSave>* mons, std::wstring* mode,
                      std::wstring* wmode);
```

Im Rumpf, an der Stelle, die heute `mode` liest (`grep -n "L\"mode\"" native/windows/host/src/settings_window.cpp`),
denselben Zweig für den Key `wmonitormode` ergänzen. Alle bestehenden Aufrufer um
`, &wmode` erweitern.

- [ ] **Step 5: Query-Bau erweitert**

Die Stelle finden, die `BuildQueryString` für den Dialog aufruft (`grep -n "BuildQueryString" native/windows/host/src/settings_window.cpp`), und anhängen:

```cpp
    query += BuildWallpaperQuerySuffix(LoadWallpaperOptions(), WallpaperRunStatus());
    query += L"&tab=" + std::wstring(openOnWallpaperTab ? L"wallpaper" : L"saver");
```

`WallpaperRunStatus()` liefert `"2/3"` oder `""` — in `wallpaper_window.h` deklarieren, in `wallpaper_window.cpp` aus der Zahl der aktiven Wallpaper-Fenster und `EnumMonitors().size()` bauen. Läuft kein Wallpaper (Dialog kam aus `/c`), gibt sie `""` zurück.

`openOnWallpaperTab` ist ein neuer Parameter von `OpenSettingsWindow(bool)` — `true`, wenn der Tray oder die Wallpaper-App den Dialog öffnet, `false` beim `/c`-Pfad des Screensavers.

- [ ] **Step 6: Fenstertitel**

Zeile 154: `L"Kuro Screensaver"` → `L"Kuro"`. Der Dialog bedient jetzt beides.

- [ ] **Step 7: Run test to verify it passes**

Push + `gh run watch`. Expected: grün.

- [ ] **Step 8: Commit**

```bash
git add native/windows/host/src/settings_window.cpp native/windows/host/src/settings_window.h \
        native/windows/host/src/wallpaper_window.h native/windows/host/src/wallpaper_window.cpp \
        native/windows/host/tests/options_test.cpp
git commit -m "feat(windows): dialog carries both option sets, saves them apart"
```

---

### Task 11: Tabs in der Settings-Oberfläche

**Files:**
- Modify: `src/settings/form-state.ts`, `src/settings/main.ts`
- Test: `tests/settings-form.test.ts`

**Interfaces:**
- Consumes: die `wp*`-Query-Keys (Task 9)
- Produces: `parseWallpaperQuery(params: URLSearchParams): SettingsFormState`, `serializeBothSets(saver, wallpaper): string`

**Warum (Spec §5):** Zwei Tabs, Statusblock und Autostart im Wallpaper-Tab, erzwungene Werte ausgegraut MIT Begründung.

- [ ] **Step 1: Write the failing test**

In `tests/settings-form.test.ts`:

```ts
describe('wallpaper tab', () => {
  it('reads the wp-prefixed half into its own state', () => {
    const p = new URLSearchParams('scene=terrain&wpscene=void&wppreset=phosphor&wpscale=0.66');
    const wp = parseWallpaperQuery(p);
    expect(wp.scene).toBe('void');
    expect(wp.preset).toBe('phosphor');
    expect(wp.scale).toBe('0.66');
  });

  it('leaves the saver state untouched', () => {
    const p = new URLSearchParams('scene=terrain&wpscene=void');
    expect(parseQuery(p).scene).toBe('terrain');
  });

  it('falls back to wallpaper defaults when the half is absent', () => {
    const wp = parseWallpaperQuery(new URLSearchParams('scene=terrain'));
    expect(wp.audio).toBe(false);
    expect(wp.scale).toBe('0.66');
  });

  it('serialises both sets, numerics unchanged', () => {
    const saver = { ...FORM_DEFAULTS, scene: 'terrain', crtintensity: '0.35' };
    const wallpaper = { ...FORM_DEFAULTS, scene: 'void', crtintensity: '0.35' };
    const out = serializeBothSets(saver, wallpaper);
    expect(out).toContain('scene=terrain');
    expect(out).toContain('wpscene=void');
    expect(out).toContain('crtintensity=0.35');
    expect(out).toContain('wpcrtintensity=0.35');
  });
});
```

(`parseQuery`/`FORM_DEFAULTS` existieren — Namen mit `grep -n "export" src/settings/form-state.ts` gegenprüfen und exakt übernehmen.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- settings-form
```

Expected: FAIL — `parseWallpaperQuery is not defined`.

- [ ] **Step 3: Write minimal implementation**

In `form-state.ts`:

```ts
// The wallpaper's defaults differ from the saver's on purpose (spec §4.1):
// sound is forced off, and 66% render scale is what keeps it cheap all day.
export const WALLPAPER_FORM_DEFAULTS: SettingsFormState = {
  ...FORM_DEFAULTS,
  audio: false,
  scale: '0.66',
};

// Reads the wp-prefixed half. Same field names as the saver half, one prefix
// deeper — mirrors BuildWallpaperQuerySuffix in options.cpp.
export function parseWallpaperQuery(params: URLSearchParams): SettingsFormState {
  const shifted = new URLSearchParams();
  for (const [k, v] of params) {
    if (k.startsWith('wp') && k !== 'wprunning') shifted.set(k.slice(2), v);
  }
  return parseQuery(shifted, WALLPAPER_FORM_DEFAULTS);
}
```

`parseQuery` nimmt heute vermutlich keine Defaults als Parameter — dann erweitern: `parseQuery(params, defaults = FORM_DEFAULTS)`. Bestehende Aufrufer bleiben unverändert.

Und `serializeBothSets` daneben — die bestehende Saver-Serialisierung, gefolgt von derselben mit Präfix:

```ts
// One save carries both sets; the host splits them by prefix and writes them to
// separate registry keys (settings_window.cpp). Numerics stay raw strings on
// both halves — the C++ side compares them byte-for-byte.
export function serializeBothSets(saver: SettingsFormState, wallpaper: SettingsFormState): string {
  const saverPart = serializeForm(saver);
  const wpPart = serializeForm(wallpaper)
    .split('&')
    .map((pair) => `wp${pair}`)
    .join('&');
  return `${saverPart}&${wpPart}`;
}
```

(`serializeForm` ist der bestehende Serialisierer — den exakten Namen mit
`grep -n "export function serialize" src/settings/form-state.ts` gegenprüfen und übernehmen.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- settings-form
```

Expected: PASS, und die bestehenden Format-Fixtures weiter grün.

- [ ] **Step 5: Tab-Leiste bauen**

In `src/settings/main.ts` über den Sektionen eine Tab-Leiste einziehen. Zwei Buttons (`Screensaver` / `Wallpaper`), die zwischen zwei `SettingsFormState`-Objekten umschalten und die `refreshers` neu laufen lassen. Initial aktiver Tab aus `?tab=`. Im Wallpaper-Tab zusätzlich oben:

```ts
// Status + autostart live in the wallpaper tab only: they concern the wallpaper
// alone — Windows starts the screensaver itself (spec E4).
const status = document.createElement('div');
status.className = 'status';
const running = params.get('wprunning') ?? '';
status.textContent = running
  ? `● Läuft auf ${running} Monitoren`
  : '○ Wallpaper läuft nicht';
```

- [ ] **Step 6: Erzwungene Werte ausgrauen — mit Begründung**

Im Wallpaper-Tab den Audio-Schalter `disabled` setzen und beschriften:

```ts
// Greyed out WITH a reason, not hidden: a missing switch reads as a bug, a
// greyed one with an explanation reads as a decision (spec §5).
if (isWallpaperTab && key === 'audio') {
  input.disabled = true;
  hint.textContent = 'aus — im Wallpaper immer';
}
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: alle grün (85+ Tests).

- [ ] **Step 8: Commit**

```bash
git add src/settings/form-state.ts src/settings/main.ts tests/settings-form.test.ts
git commit -m "feat(settings): screensaver/wallpaper tabs with separate option sets"
```

---

### Task 12: Live-Apply auf ein laufendes Wallpaper

**Files:**
- Modify: `native/windows/host/src/settings_window.cpp` (nach dem Save), `native/windows/host/src/wallpaper_window.h`/`.cpp`

**Interfaces:**
- Consumes: `SaveWallpaperOptions` (Task 7)
- Produces: `void ReloadWallpaper()` — navigiert alle Wallpaper-WebViews neu; no-op, wenn keins läuft

**Warum (Spec §5.3):** Der Wallpaper-Tab wendet direkt auf den Desktop an — das ist die Vorschau.

- [ ] **Step 1: `ReloadWallpaper` deklarieren**

`wallpaper_window.h`:

```cpp
// Re-navigates every running wallpaper WebView to a freshly built query, so a
// save from the dialog is visible at once. No-op when no wallpaper runs (the
// dialog can also come from the screensaver's /c path).
void ReloadWallpaper();
```

- [ ] **Step 2: Implementieren**

`wallpaper_window.cpp` hält bereits `std::vector<WallpaperWindow*> g_windows` (Zeile 59) mit
je einem `ICoreWebView2* webview`. `BuildWallpaperPage()` (Zeile 113) baut die Seite. Nach
`SetWallpaperPaused` einfügen:

```cpp
void ReloadWallpaper() {
    // g_windows is empty when the dialog came from the saver's /c path — then
    // this is a no-op and the saved values simply apply at the next start.
    for (WallpaperWindow* w : g_windows) {
        if (!w->webview) continue;
        std::wstring page = BuildWallpaperPage(LoadWallpaperOptions());
        w->webview->Navigate(page.c_str());
    }
}
```

**Achtung — `BuildWallpaperPage` muss zuerst auf den neuen Satz umgestellt sein (Task 8):**
Es liest heute den Saver-Satz und ersetzt `scale` durch `WallpaperScale()`. Nach Task 8
kommen beide aus `LoadWallpaperOptions()`, und `WallpaperScale()` entfällt ersatzlos —
sonst überschreibt der Legacy-Key den Regler aus dem neuen Tab.

`Navigate` will dieselbe URL-Form wie beim Start. Prüfen, wie `CreateWebView` (Zeile 254)
den `page`-Parameter zu einer vollen URL macht (`grep -n "kuro.local\|Navigate" native/windows/host/src/webview_host.cpp`),
und hier exakt dieselbe Form verwenden.

- [ ] **Step 3: Nach dem Save aufrufen**

In `HandleWebMessage`, nach `SaveWallpaperOptions(wp);`:

```cpp
    ReloadWallpaper();  // no-op unless a wallpaper is actually running
```

- [ ] **Step 4: Bauen lassen**

Push + `gh run watch`. Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add native/windows/host/src/wallpaper_window.h native/windows/host/src/wallpaper_window.cpp \
        native/windows/host/src/settings_window.cpp
git commit -m "feat(windows): saving the wallpaper tab applies to the desktop at once"
```

---

## Welle 4 — Installer

### Task 13: Zweisprachiger Installer mit Tasks und sauberem Uninstall

**Files:**
- Modify: `native/windows/installer/KuroScreensaver.iss`

**Interfaces:**
- Consumes: `KuroWallpaper.exe` (Task 3), `kTrayWindowClass` + `KuroWallpaper.Quit` (Task 4)
- Produces: nichts (Endpunkt)

**Warum (Spec §7):** Sprache nach Systemsprache; Häkchen für Startmenü/Desktop/Autostart; ein Uninstaller, der die laufende App beendet, bevor er löscht.

- [ ] **Step 1: Sprachen**

```pascal
[Languages]
Name: "german";  MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
```

Inno wählt nach Windows-Systemsprache; bei Mehrdeutigkeit erscheint der Sprachdialog.

- [ ] **Step 2: Tasks zweisprachig**

```pascal
[Tasks]
Name: "setactive"; Description: "{cm:TaskSetActive}"; GroupDescription: "{cm:GroupSaver}"
Name: "startmenu"; Description: "{cm:TaskStartMenu}"; GroupDescription: "{cm:GroupWallpaper}"
Name: "desktopicon"; Description: "{cm:TaskDesktopIcon}"; GroupDescription: "{cm:GroupWallpaper}"; Flags: unchecked
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:GroupWallpaper}"; Flags: unchecked

[CustomMessages]
german.GroupSaver=Bildschirmschoner:
german.GroupWallpaper=Animiertes Wallpaper:
german.TaskSetActive=Kuro als aktiven Bildschirmschoner setzen
german.TaskStartMenu=Startmenü-Eintrag anlegen
german.TaskDesktopIcon=Desktop-Verknüpfung anlegen
german.TaskAutostart=Wallpaper mit Windows starten
german.RunWallpaper=Animiertes Wallpaper jetzt starten
german.OpenSaverSettings=Bildschirmschoner-Einstellungen öffnen (Wartezeit einstellen)
english.GroupSaver=Screen saver:
english.GroupWallpaper=Animated wallpaper:
english.TaskSetActive=Set Kuro as my active screen saver now
english.TaskStartMenu=Create a Start menu entry
english.TaskDesktopIcon=Create a desktop shortcut
english.TaskAutostart=Start the wallpaper with Windows
english.RunWallpaper=Start the animated wallpaper now
english.OpenSaverSettings=Open Screen Saver settings (set the idle time)
```

- [ ] **Step 3: Icons + Registry + Run**

```pascal
[Icons]
; Points at the .exe, never the .scr: the shell drops a .scr shortcut's
; arguments and runs the screensaver instead (v0.10.1, confirmed on-device).
Name: "{autoprograms}\Kuro Wallpaper"; Filename: "{app}\{#WallpaperExe}"; Tasks: startmenu
Name: "{autodesktop}\Kuro Wallpaper"; Filename: "{app}\{#WallpaperExe}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Control Panel\Desktop"; ValueType: string; ValueName: "SCRNSAVE.EXE"; ValueData: "{app}\{#ScrName}"; Tasks: setactive
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "KuroWallpaper"; ValueData: """{app}\{#WallpaperExe}"" /silent"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{sys}\control.exe"; Parameters: "desk.cpl,screensaver,@screensaver"; Description: "{cm:OpenSaverSettings}"; Flags: postinstall skipifsilent nowait
Filename: "{app}\{#WallpaperExe}"; Description: "{cm:RunWallpaper}"; Flags: postinstall skipifsilent nowait unchecked
```

Oben bei den `#define`s ergänzen: `#define WallpaperExe "KuroWallpaper.exe"`. Und `UninstallDisplayIcon={app}\{#WallpaperExe}`.

- [ ] **Step 4: Laufende App vor dem Löschen beenden**

Im `[Code]`-Block ergänzen:

```pascal
// Windows will not delete a running .exe. Without this the uninstall either
// errors or demands a reboot, so ask the app to quit first — same registered
// message the second instance uses (src/instance.h).
procedure StopRunningWallpaper();
var
  tray: HWND;
  waited: Integer;
begin
  tray := FindWindowByClassName('KuroTrayWindow');
  if tray = 0 then exit;
  PostMessage(tray, RegisterWindowMessage('KuroWallpaper.Quit'), 0, 0);
  waited := 0;
  while (waited < 5000) and (FindWindowByClassName('KuroTrayWindow') <> 0) do
  begin
    Sleep(200);
    waited := waited + 200;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningWallpaper();
  Result := True;
end;
```

- [ ] **Step 5: Tray behandelt die Quit-Nachricht**

In `tray.cpp`, neben der ShowSettings-Behandlung aus Task 4:

```cpp
    // The uninstaller asks us to go before it deletes our files.
    if (msg == WallpaperQuitMessage()) {
        PostQuitMessage(0);
        return 0;
    }
```

- [ ] **Step 6: Run-Key-Cleanup bleibt**

Die `CurUninstallStepChanged`-Logik aus v0.10.1 unverändert lassen, aber die Substring-Prüfung auf beide Dateinamen erweitern (ein migrierter Key zeigt auf die `.exe`, ein alter auf die `.scr`):

```pascal
      if (Pos(Uppercase(ExpandConstant('{app}\{#ScrName}')), Uppercase(autostart)) > 0) or
         (Pos(Uppercase(ExpandConstant('{app}\{#WallpaperExe}')), Uppercase(autostart)) > 0) then
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'KuroWallpaper');
```

- [ ] **Step 7: Installer kompilieren lassen**

Push. Der `installer`-Job aus v0.10.1 baut die `.iss` bei jeder Änderung. Expected: grün, Artefakt `windows-installer-dry-run` enthält das Setup.

- [ ] **Step 8: Commit**

```bash
git add native/windows/installer/KuroScreensaver.iss native/windows/host/src/tray.cpp
git commit -m "feat(installer): bilingual, wallpaper tasks, quits the app before removing it"
```

---

### Task 14: `release.yml` entdoppeln + Doku

**Files:**
- Modify: `.github/workflows/release.yml:103-114`, `docs/WINDOWS-INSTALL.md`, `README.md`

**Interfaces:**
- Consumes: `scripts/package-windows-installer.sh` (läuft seit v0.10.1 auf Windows)
- Produces: nichts (Endpunkt)

**Warum:** Der inline-ISCC-Aufruf ist die Duplikation, die v0.7.0 einen kaputten Installer gekostet hat. Seit v0.10.1 funktioniert das Script auf Windows — der Grund für die Duplikation ist weg.

- [ ] **Step 1: Job auf das Script umstellen**

Den „Compile installer (Inno Setup / ISCC)"-Step ersetzen:

```yaml
      - name: Compile installer (same script as the installer CI job)
        shell: bash
        env:
          KURO_REQUIRE_ISCC: "1"
        run: |
          npm ci
          bash scripts/package-windows-installer.sh
```

Den vorangehenden `package-windows.sh`-Step entfernen — das Script ruft ihn selbst auf (das war der Grund für die v0.7.0-Divergenz).

- [ ] **Step 2: Doku**

`docs/WINDOWS-INSTALL.md` §„Animated wallpaper" umschreiben: kein `/w`-Kommandozeilen-Aufruf mehr als Hauptweg, sondern Startmenü → **Kuro Wallpaper**; eigene Einstellungen im Wallpaper-Tab; Autostart per Installer-Häkchen oder Tray. Den `.scr /w`-Weg als Fußnote für ZIP-Nutzer behalten.

`README.md` Zeile ~198 analog: „Start menu → **Kuro Wallpaper**" statt `KuroScreensaver.scr /w`.

- [ ] **Step 3: Prüfen, dass README/Doku keine Lüge mehr enthalten**

```bash
grep -rn "scr /w\|KuroScreensaver.scr /w" README.md docs/
```

Expected: nur noch in der ZIP-Fußnote von `WINDOWS-INSTALL.md`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml docs/WINDOWS-INSTALL.md README.md
git commit -m "ci: release uses the packaging script; docs describe the wallpaper app"
```

---

## Nach dem Plan

**On-device-Abnahme (nicht automatisierbar, in die TaskNote):**
1. Startmenü → „Kuro Wallpaper" startet das **Wallpaper** (nicht den Saver) und zeigt das Fenster.
2. Zweiter Klick bei laufendem Wallpaper → Fenster kommt nach vorn, kein zweites Wallpaper.
3. Tray-Menü: „Einstellungen…" ohne kryptische Zeichen; eigenes Icon sichtbar.
4. Wallpaper-Tab: Szene ändern → Desktop ändert sich sofort, Screensaver bleibt unverändert.
5. Screensaver-Tab: Szene ändern → Wallpaper bleibt unverändert.
6. Autostart-Häkchen im Installer → nach Reboot läuft das Wallpaper, **ohne** Fenster.
7. Upgrade von v0.10.1 mit gesetztem Autostart → Key zeigt danach auf die `.exe`.
8. Deinstallieren bei laufendem Wallpaper → keine Fehlermeldung, keine Neustart-Aufforderung.
9. Drei Monitore, einer Hochformat: Span- und Per-Monitor-Modus im Wallpaper-Tab.
