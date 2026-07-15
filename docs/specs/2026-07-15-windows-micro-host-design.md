# Windows-Mikro-Host: C++/Win32 + WebView2, Paket-Schrumpfung + Animated Desktop

**Datum:** 2026-07-15 · **Status:** ratifiziert (Brainstorming mit Johannes)
**Scope:** nur `native/windows/` + eine neue Vite-Entry (`settings.html`) + kleiner
Engine-Patch (Render-Scale-Param). Web-Engine-Logik und macOS unberührt.

## Ziel

Zwei Probleme, ein Host:

1. **Paket-Schrumpfung:** Das heutige Windows-Paket (~50 MB Setup / ~65 MB zip)
   ist fast vollständig self-contained .NET-8-Runtime — unser eigener Code sind
   371 Zeilen C#. Ziel: **<5 MB** (exe ~200–400 KB + `web/`-Bundle ~2–3 MB).
2. **Animated-Desktop-Modus für Windows 11:** Wallpaper hinter den Desktop-Icons,
   analog zum macOS-`--wallpaper`-Modus, mit demselben Zielbild
   **„unsichtbar im Alltag"** (PowerPolicy-Port von v0.8.0).

## Entscheidung (Weg A von A/B/C)

**A: C++/Win32-Mikro-Host + WebView2** — kein .NET. WebView2 ist auf Windows 11
inbox; der Host ist eine kleine native exe, die weiterhin das unveränderte
Web-Bundle (`screensaver.html` + Query-Param-Bridge `src/screensaver/params.ts`)
hostet.

Verworfen:

- **B (C# NativeAOT + CsWin32):** WinForms ist nicht AOT-fähig — Config-Dialog und
  Fenster-Management müssten sowieso auf Win32-APIs neu geschrieben werden, dazu
  fummeliges AOT-COM-Interop mit WebView2. Spart kaum Arbeit gegenüber A bei
  größerem Paket (~5–10 MB).
- **C (Direct3D-Engine-Twin):** Effizienz-Ideal (kein Chromium), aber ein DRITTER
  handgepflegter Engine-Zwilling neben TS+Swift → Paritäts-Falle verdreifacht.
  Bleibt als **gemessener Fallback** dokumentiert: nur falls der
  pausier-disziplinierte WebView2-Wallpaper on-device zu teuer ist.

Weitere ratifizierte Entscheidungen:

- **OS-Floor:** Windows 11 offiziell, Windows 10 best-effort (Runtime-Check +
  Hinweis mit Download-Link, kein Bootstrapper-Bundling im Installer).
- **Wallpaper-UX:** Tray-Icon (Start/Stop/Settings/Autostart/Beenden).
- **Settings-UI:** HTML-Seite im WebView2 statt nativem Win32-Dialog
  (zahlt auf Roadmap-Brick F ein).
- **Phasierung:** zwei Release-Schnitte — v0.9.0 = Mikro-Host als .scr-Ersatz,
  v0.10.0 = Wallpaper + Tray + PowerPolicy. Entkoppelt das WorkerW-Risiko vom
  Paket-Gewinn; jede on-device-Runde testet eine Sache.

## Design

### §1 Mikro-Host (`native/windows/host/`)

Neues C++/Win32-Projekt, ersetzt das .NET-Projekt vollständig. Gleicher
.scr-Kontrakt: exe wird zu `.scr` umbenannt, versteht `/s`, `/c`, `/p <hwnd>`
(auch `/p:<hwnd>`), neu `/w` (Phase 2). Struktur (~6 Übersetzungseinheiten,
geschätzt <1500 Zeilen):

| Datei | Aufgabe |
| --- | --- |
| `main.cpp` | WinMain, Argument-Parsing, Dispatch |
| `options.cpp` | 1:1-Port der C#-`Options`-Klasse: HKCU `Software\KuroScreensaver` lesen/schreiben, Query-String bauen |
| `webview_host.cpp` | WebView2-Setup: Environment, Virtual-Host `kuro.local` → `web/`, Settings-Härtung (kein Kontextmenü/Zoom/DevTools/Statusbar/Accelerators), WebMessage-Callback |
| `saver_window.cpp` | Fullscreen-Fenster pro Monitor (`EnumDisplayMonitors`), Input-Watch |
| `preview_window.cpp` | Child-Window im übergebenen hwnd (Settings-Vorschau) |
| `settings_window.cpp` | Host-Fenster für `settings.html` (§2) |
| `tray.cpp` | Tray-Icon + Menü (Phase 2, §3) |

Festgelegte Ports/Invarianten:

- **Registry-Layout bleibt byte-identisch** (Pfad, Value-Namen, `on`/`off`-Strings,
  Defaults) — bestehende Nutzer-Settings überleben das Upgrade unsichtbar.
- **Input-Watch bleibt Polling** (120-ms-Timer, 10-px-Maus-Schwelle, 1 s Grace,
  `GetAsyncKeyState`-Sweep 0x08–0xFE): der WebView frisst den Fokus, Fenster-Events
  reichen nicht — exakt der Grund für die heutige C#-Lösung.
- **WebView2-Loader statisch linken** (`WebView2LoaderStatic.lib`) → eine einzige
  exe ohne Neben-DLL.
- **Runtime-Check beim Start:** `GetAvailableCoreWebView2BrowserVersionString`;
  fehlt die Runtime (Win10-Randfall) → MessageBox mit Download-Link statt Crash.
- Web → Native: `WebMessageReceived` beendet den Saver (Close-Button der Engine),
  wie heute.
- User-Data-Ordner: `%TEMP%\KuroScreensaverWV2` (wie heute).

### §2 Settings-UI als HTML (ersetzt ConfigForm)

`/c` öffnet ein kleines Host-Fenster (~420×480, zentriert), das
`https://kuro.local/settings.html` lädt — **neue Vite-Multi-Page-Entry** im
Web-Build, wird mit ins `web/`-Bundle kopiert.

- Host übergibt die aktuellen Registry-Werte als Query-Params (dieselbe
  Serialisierung wie für `screensaver.html`).
- Die Seite rendert Scene/Preset/Speed-Dropdowns + die 9 Toggles im
  Kuro-CRT-Look; **Listen kommen aus den Engine-Daten** (`presets.ts` etc.) —
  die heutige Duplizierung der Listen im C#-Code entfällt ersatzlos.
- „Save" schickt ein JSON via `window.chrome.webview.postMessage` → Host
  validiert (bekannte Keys, Whitelist-Werte) und schreibt HKCU; „Cancel"/Schließen
  schreibt nichts.
- Die Seite läuft auch im normalen Browser (postMessage-Guard), damit sie im
  Web-Dev-Loop gestaltbar bleibt — das ist der Brick-F-Anteil.

### §3 Wallpaper-Modus `/w` + Tray (Phase 2)

- **Hinter die Icons:** Progman/WorkerW-Trick — `SendMessageTimeout(Progman,
  0x052C, …)`, dann WorkerW finden und das eigene Fenster einhängen.
  **24H2-Quirk:** die Hierarchie hat sich geändert (WorkerW direkt unter
  Progman); der Host implementiert **beide Strategien mit Feature-Detection**.
- **MVP: nur primärer Monitor.** Ein Chromium pro Monitor kostet je 150–300 MB
  RAM; Multi-Monitor wird eine spätere Option, kein v0.10-Ziel.
- **Tray-Icon** (`Shell_NotifyIcon`): Wallpaper an/aus · Einstellungen (öffnet
  §2-Fenster) · Autostart-Toggle (HKCU-Run-Key mit `/w`) · Beenden. Ohne Tray
  wäre der Wallpaper nur per Task-Manager stoppbar.
- **Wallpaper-Defaults:** `audio` wird im `/w`-Modus **erzwungen off** (ein
  tönender Desktop ist ein Bug, kein Feature). Optionaler `scale`-Query-Param
  (Render-Scale-Parität zu macOS 0,66) → kleiner Engine-Patch, mappt auf
  `renderer.setPixelRatio`.

### §4 PowerPolicy-Port („unsichtbar im Alltag", Phase 2)

Gleiche Architektur wie macOS v0.8.0: Signale sammeln → **pure
Entscheidungstabelle** (C++-Port von `Core/RenderPolicy.swift`, ~50 Zeilen,
Zustände hidden/frozen/animating) → pro Wallpaper-Fenster anwenden. Der
Vollbild-Saver (`/s`) ist strukturell ausgenommen, wie auf macOS.

Signalquellen (Windows-Äquivalente der 6 macOS-Signale):

| Signal | API |
| --- | --- |
| Session gesperrt / Fast-User-Switch | `WTSRegisterSessionNotification` |
| Vollbild-App im Vordergrund | `SHQueryUserNotificationState` (`QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE`) |
| Monitor von maximiertem Fenster verdeckt | Occlusion-Check (Foreground-Fenster-Bounds vs. Monitor-Rect, Poll im Timer) |
| Batterie / Stromsparmodus | `GetSystemPowerStatus` + `RegisterPowerSettingNotification` |
| Display aus / Modern Standby | Power-Broadcast (`PBT_POWERSETTINGCHANGE`, Console-Display-State) |

Durchsetzung zweistufig:

1. Zustandswechsel per `postMessage` an die Seite → Engine pausiert/limitiert
   ihren rAF-Loop (kleiner Engine-Hook, analog reduced-motion).
2. Bei `hidden` zusätzlich `CoreWebView2.TrySuspend()` — pausiert Chromium
   komplett und senkt auch den RAM; `Resume()` beim Zurückwechseln.

### §5 Build, CI, Tests

- **Build:** CMake + MSVC, nur im Windows-CI-Job (GitHub Actions
  `windows-latest`) — wie bisher kein Mac-Testloop; Iteration über
  CI-Artefakte. WebView2-SDK via NuGet-Restore im CI-Schritt.
- **Packaging:** `scripts/package-windows.sh` wird von dotnet auf cmake
  umgestellt (bauen → exe zu `.scr` → mit `web/` zippen) und bleibt die
  **Single Source, die CI aufruft** — kein dupliziertes Build-Kommando im
  Workflow (Lektion aus dem v0.7.1-Hotfix). Der
  Inno-Installer (`native/windows/installer/KuroScreensaver.iss`) bleibt und
  zeigt auf die neue Mini-exe; der WebView2-Runtime-Hinweis steht in
  `docs/WINDOWS-INSTALL.md`, kein Bootstrapper.
- **Tests:** `options_test.exe` im CI-Job prüft Registry-Roundtrip +
  Query-String-Parität gegen die dokumentierte C#-Ausgabe (Fixture-Strings).
  Der übrige Win32-Glue ist dünn → on-device-Checkliste als TaskNote
  (je Release-Schnitt eine). Web-Engine unverändert → Typecheck/Golden decken
  sie weiter ab.
- **Migration:** Das C#-Projekt (`KuroScreensaver.csproj`, `Program.cs`) fliegt
  im selben PR raus, in dem der C++-Host die .scr-Parität erreicht
  (git-Historie behält es).

### §6 Releases

- **v0.9.0** — Phase 1: Mikro-Host ersetzt .NET-.scr (Parität `/s /c /p`,
  HTML-Settings, Paket <5 MB, Installer umgestellt).
- **v0.10.0** — Phase 2: `/w`-Wallpaper + Tray + PowerPolicy + Render-Scale.

## Risiken (benannt, akzeptiert)

- **WorkerW-Quirk 24H2:** beide Einhäng-Strategien implementiert, Rest-Risiko
  nur on-device prüfbar.
- **Chromium-RAM im Wallpaper-Dauerbetrieb** (~150–300 MB): `TrySuspend` bei
  hidden mildert; Weg C bleibt als gemessener Fallback dokumentiert.
- **Kein lokaler Build auf dem Mac** (MSVC-only): Iteration nur über CI —
  bekannter Zustand, unverändert gegenüber heute.
