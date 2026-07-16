# Windows: das Wallpaper wird eine App — Design (v0.11)

**Status:** ratifiziert 2026-07-16 (Brainstorming mit Johannes)
**Vorgänger:** `2026-07-16-windows-v0.10-saver-wallpaper-design.md` (v0.10 brachte `/w` überhaupt erst)
**Auslöser:** on-device-Abnahme v0.10.1 — der Saver war grün, aber das Wallpaper praktisch unbenutzbar.

## 1. Problem

v0.10.0 hat den Wallpaper-Modus ausgeliefert, v0.10.1 einen Startmenü-Eintrag dafür
nachgereicht. Der on-device-Test zeigt: beides trägt nicht.

1. **Der Startmenü-Eintrag startet den Screensaver, nicht das Wallpaper.** Die Shell
   wendet auf eine `.scr` das Default-Verb an und verwirft die Argumente des Shortcuts.
   `/w` kommt nie an, `main.cpp` fällt auf seinen Default `/s` zurück. Das ist mit keiner
   Shortcut-Konfiguration zu heilen — die Dateiendung ist die Ursache.
2. **Das Wallpaper hat keine eigenen Einstellungen.** Tray → „Einstellungen…" öffnet den
   Screensaver-Dialog. Wallpaper und Saver teilen sich EINEN Satz Optionen; getrennt ist
   nur die Monitor-Zuordnung (`WMode`/`WScene`/`WPreset`). Szene, Farbe, CRT-Effekte,
   Story, Leistung — alles gilt für beide gleichzeitig.
3. **Kein eigenes Icon.** `tray.cpp` lädt `IDI_APPLICATION` (Windows-Stock), `app.rc` hat
   keine `ICON`-Ressource — auch das Explorer- und Startmenü-Icon ist generisch.
4. **Kryptische Zeichen im Tray-Menü.** „Einstellungen…" erscheint als „Einstellungenâ€¦".
5. **Kein Autostart-Angebot beim Installieren**, keine Wahl, wo die App auffindbar ist.

## 2. Ratifizierte Entscheidungen

| # | Frage | Entscheidung | Warum |
|---|---|---|---|
| E1 | Verhältnis Saver- ↔ Wallpaper-Settings | **Komplett getrennt** | WYSIWYG pro Tab. Vererbung mit Sentinel-Semantik hat uns in v0.10 bereits ein dauerhaft schwarzes Wallpaper beschert (LESSONS 2026-07-16). |
| E2 | Startmenü-Klick | **Wallpaper an + Fenster; läuft es schon → Fenster nach vorn** | Muster von Wallpaper Engine / Lively: eine App, die im Tray lebt, das Fenster ist ihr Gesicht. Autostart startet still. |
| E3 | Icon | **CRT-Rahmen mit Terrain-Horizont, phosphor (#39ff7a)** | Überlebt 16 px (Tray). Das Kanji 黒 (Preset `kuro`) lief bei 16 px zu und hinge an einer installierten Japanisch-Font. |
| E4 | Fenster-Layout | **Zwei Tabs: Screensaver \| Wallpaper** | Autostart + Laufstatus wohnen im Wallpaper-Tab — sie betreffen nur das Wallpaper; den Saver startet Windows selbst. Ein „App"-Tab für drei Schalter wäre dünn. |
| E5 | Installer-Sprache | **Zweisprachig nach Windows-Systemsprache** | Für Johannes wird der Installer deutsch (passend zur UI), für fremde Nutzer bleibt alles wie bisher. Strikt besser als der Status quo, ohne Tray/Settings übersetzen zu müssen. |

**Verworfen:** „Tray" als Installations-Häkchen. Startmenü und Desktop sind Verknüpfungen
— Dateien. Das Tray-Icon existiert nur, solange die App läuft, und ist ihre **einzige**
Bedienung (anhalten, einstellen, beenden). Abschaltbar gemacht, wäre das Wallpaper ohne
Task-Manager nicht mehr loszuwerden.

## 3. Binary-Architektur: eine Quelle, zwei Targets

`host_lib` ist bereits eine statische Lib — das zweite Target kostet fast nichts:

```cmake
add_executable(KuroWallpaper WIN32 src/main.cpp wallpaper.rc)
target_link_libraries(KuroWallpaper PRIVATE host_lib)
target_compile_definitions(KuroWallpaper PRIVATE KURO_WALLPAPER_APP=1)
```

Der Installer legt beide Dateien ab: `KuroScreensaver.scr` **und** `KuroWallpaper.exe`
(je ~271 KB, gemeinsames `web/`). Kein zweites Programm zu pflegen; die `.exe`-Endung
befreit vom Shell-Verb-Problem aus §1.1.

**Kein Umbenennen der `.scr` zur Laufzeit, keine Kopie im Installer-Script** — zwei echte
Targets, weil sie unterschiedliche VERSIONINFO und ein unterschiedliches Icon brauchen:

| | `KuroScreensaver.scr` | `KuroWallpaper.exe` |
|---|---|---|
| FileDescription | Kuro Screensaver | Kuro Wallpaper |
| OriginalFilename | KuroScreensaver.scr | KuroWallpaper.exe |
| Default-Argument | `/s` (Saver) | `/w` (Wallpaper) |

Ohne getrennte VERSIONINFO meldet sich die Wallpaper-App im Task-Manager und in den
Dateieigenschaften als „Kuro Screensaver" — bei zwei Programmen aus einer Binary
irreführend.

`main.cpp` bleibt eine Datei. Der einzige Unterschied:

```cpp
#ifdef KURO_WALLPAPER_APP
constexpr const wchar_t* kDefaultArg = L"/w";
#else
constexpr const wchar_t* kDefaultArg = L"/s";
#endif
```

### 3.1 Argumente von `KuroWallpaper.exe`

| Argument | Verhalten |
|---|---|
| *(keins)* | Wallpaper starten + Tray + **Settings-Fenster öffnen** (Wallpaper-Tab aktiv) |
| `/silent` | Wallpaper starten + Tray, **kein** Fenster — das schreibt der Autostart-Key |
| `/w` | wie *(keins)*, für Rückwärtskompatibilität mit dem v0.10-Autostart-Key |

### 3.2 Single-Instance

Benannter Mutex (`Local\KuroWallpaper.Instance`, `CreateMutexW` + `ERROR_ALREADY_EXISTS`).
Zweite Instanz sendet der ersten eine registrierte Fenster-Nachricht
(`RegisterWindowMessageW(L"KuroWallpaper.ShowSettings")`) und beendet sich. Die erste
holt ihr Settings-Fenster nach vorn (`ShowWindow` + `SetForegroundWindow`).

**Invariante:** Es rendert nie ein zweites Wallpaper. Der Mutex wird vor jeder
Fenster-Erzeugung geprüft — auch im `/silent`-Pfad, sonst startet ein Doppel-Login
(Autostart + manueller Klick) zwei WorkerW-Fenster übereinander.

**Migration:** Der v0.10-Autostart-Key zeigt auf `"<pfad>\KuroScreensaver.scr" /w`. Beim
ersten Start der neuen App wird ein solcher Key auf `"<pfad>\KuroWallpaper.exe" /silent`
umgeschrieben (nur, wenn er auf unsere `.scr` zeigt — sonst nicht anfassen). Sonst startet
Windows nach dem Update weiterhin die `.scr`, was funktioniert, aber ohne Fenster-Zugang.

## 4. Registry-Layout

**Der Saver-Satz bleibt unangetastet** unter `HKCU\Software\KuroScreensaver`. Der
Wallpaper-Satz kommt als **Unterschlüssel** mit **identischen Key-Namen**:

```
HKCU\Software\KuroScreensaver              ← Saver (unverändert, erste 12 Keys byte-identisch)
  ├── Scene, Preset, Speed, Audio, …       ← 33 Felder (SaverOptions)
  ├── Monitors\<id>\Mode|Scene|Preset      ← Saver-Monitor-Zuordnung
  ├── Monitors\<id>\WMode|WScene|WPreset   ← Wallpaper-Monitor-Zuordnung (BLEIBT HIER)
  ├── MonitorMode, WallpaperMonitorMode
  └── Wallpaper\                            ← NEU
        └── Scene, Preset, Speed, Audio, … ← dieselben 33 Key-Namen
```

`LoadOptions()`/`SaveOptions()` nehmen den Registry-Pfad bereits als Parameter — der
Wallpaper-Satz ist **derselbe Code auf `kRegPath + L"\\Wallpaper"`**. Keine 30 neuen
Key-Namen, keine Berührung der Legacy-Keys, Format-Invariante hält ohne Zutun.

**Bewusst NICHT gemacht:** Das W-Trio (`WMode`/`WScene`/`WPreset`) nach
`Wallpaper\Monitors\<id>\Mode` migrieren. Das wäre konsistenter, verlangt aber die
Migration eines gerade erst veröffentlichten Formats — an genau der Stelle, die als
einzige bereits getestet ist und deren Leer-Sentinel funktioniert. Die Inkonsistenz ist
der geringere Preis. **Der Leer-Sentinel bleibt unverändert gültig** (LESSONS 2026-07-16:
`SaveMonitorConfig` schreibt die W-Werte nur bei nicht-leerem `wmode`).

### 4.1 Wallpaper-Defaults ≠ Saver-Defaults

Beim ersten Laden eines **leeren** `Wallpaper`-Unterschlüssels gelten nicht die
Saver-Defaults, sondern:

| Feld | Wallpaper-Default | Warum |
|---|---|---|
| `audio` | `false` (**erzwungen**, nicht nur Default) | Ein Wallpaper, das den ganzen Tag tönt, ist unbrauchbar. Der Host setzt es hart. |
| `scale` | `0.66` | v0.8-Erkenntnis: die volle Geräteauflösung durch die Bloom+CRT-Post-Kette ist die Ruckel-Ursache. |
| Rest | wie Saver-Defaults | |

## 5. Settings-Fenster

Die Tabs entstehen **web-seitig in `settings.html`**, nicht als Win32-Control — der Dialog
ist bereits eine WebView. Titel wird `Kuro` (statt „Kuro Screensaver"), weil er jetzt
beides bedient.

```
┌─ Kuro ───────────────────────────────── — ✕ ┐
│ [ Screensaver ] [ Wallpaper ]               │
├─────────────────────────────────────────────┤
│ ● Läuft auf 2 von 3 Monitoren   [Anhalten]  │  ← nur im Wallpaper-Tab
│ ☑ Mit Windows starten                       │  ← nur im Wallpaper-Tab
│ ┌ Bild ────────────────────────────────────┐│
│ │ Szene: Void ▾   Farbe: Phosphor ▾        ││
│ …  (die bekannten 7 Sektionen)              │
│ ┌ Anzeige & Automatik ─────────────────────┐│
│ │ Ton   [aus — im Wallpaper immer]  (grau) ││  ← erzwungen, MIT Begründung
└─────────────────────────────────────────────┘
```

**Erzwungene Werte werden ausgegraut und begründet, nicht versteckt.** Ein fehlender
Schalter wirkt wie ein Bug; ein grauer mit Erklärung wie eine Entscheidung. Betroffen:
`audio` (immer aus).

`scale` ist **kein** erzwungener Wert — 0.66 ist nur der Default, der Regler bleibt bedienbar.

### 5.1 Wie die Werte in den Dialog kommen

Der Host reicht beide Sätze per Query durch. Der Wallpaper-Satz **additiv mit `w`-Präfix**:

```
?scene=terrain&preset=ember&…       ← Saver (erste 12 Keys byte-identisch, UNVERÄNDERT)
&tab=wallpaper                       ← initial aktiver Tab
&wpscene=void&wppreset=phosphor&…   ← Wallpaper-Satz, additiv, wp-Präfix
&wprunning=2/3                       ← Laufstatus für den Statusblock
```

**Format-Invariante bleibt:** Die ersten 12 Query-Keys sind byte-identisch zur v0.9,
alles Neue ist additiv und hängt hinten dran. Numerik reist weiterhin als **rohe
validierte Strings** — nie reformatieren (v0.10-Invariante).

**Präfix ist `wp`, nicht `w`** — und zwar bewusst: `w` allein grenzt zu dicht an das
bereits vergebene Monitor-Vokabular (`WMode`/`WScene`/`WPreset` in der Registry,
`m<N>…` im Query). Ein `wscene` neben einem `WScene` mit anderer Bedeutung ist eine
Falle für den nächsten Leser. Also durchgängig `wpscene`, `wppreset`, `wpspeed`, …

### 5.2 Speichern

Der Dialog schickt beide Sätze zurück. `settings_window.cpp` schreibt:

- Saver-Felder → `kRegPath`
- `wp*`-Felder → `kRegPath\Wallpaper`
- Monitor-Trios → wie bisher (inkl. Leer-Sentinel)

**Invariante (aus dem v0.10-Review):** Ein Save aus dem Screensaver-Tab darf den
Wallpaper-Unterschlüssel nicht anfassen und umgekehrt. Beide Tabs sind im selben Dialog,
also wird immer alles geschrieben — aber nur, was der Dialog auch tatsächlich geladen
hat. Kein Read-modify-write über fremde Bereiche.

### 5.3 Live-Anwendung

Speichern im Wallpaper-Tab wendet die Werte **sofort** auf ein laufendes Wallpaper an
(WebView neu navigieren, wie beim Szenen-Wechsel). Der Saver-Tab braucht das nicht — der
Saver läuft beim Konfigurieren nicht.

## 6. Icon

`assets/kuro.ico`, generiert aus SVG (Variante B/phosphor), mit den Größen **16, 32, 48,
256**. Windows greift je nach Kontext auf eine andere zu: 16 = Tray + Titelleiste,
32 = Startmenü/Explorer, 48 = Alt-Tab, 256 = „Apps & Features" und große Kachelansicht.

- `app.rc` + `wallpaper.rc`: `IDI_APPICON ICON "assets/kuro.ico"` — dieselbe Datei für
  beide Targets. Beim Screensaver hebt das zusätzlich die Darstellung im
  Bildschirmschoner-Picker.
- `tray.cpp`: `LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APPICON))` statt
  `IDI_APPLICATION`. Fällt auf das Stock-Icon zurück, falls das Laden scheitert (der Tray
  darf nie ohne Icon dastehen — er wäre unbedienbar).
- Installer: `UninstallDisplayIcon={app}\KuroWallpaper.exe`.

Die `.ico` wird **eingecheckt**, nicht im Build erzeugt: Ein Build-Schritt mit
ImageMagick/Inkscape wäre eine neue Toolchain-Abhängigkeit für ein Asset, das sich fast
nie ändert. Das SVG liegt als Quelle daneben (`assets/kuro.svg`), damit es reproduzierbar
bleibt.

## 7. Installer

```
[Languages]
Name: "german";  MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
```

Inno wählt automatisch nach Windows-Systemsprache und zeigt bei Mehrdeutigkeit den
Sprachdialog. Alle eigenen `Description:`-Texte brauchen beide Varianten
(`german.Description:` / `english.Description:`).

**Häkchen:**

| Task | Default | Wirkung |
|---|---|---|
| Startmenü-Eintrag „Kuro Wallpaper" | ☑ an | `[Icons] {autoprograms}` → `KuroWallpaper.exe` |
| Desktop-Verknüpfung | ☐ aus | `[Icons] {autodesktop}` → `KuroWallpaper.exe` |
| Mit Windows starten | ☐ aus | `Run\KuroWallpaper` = `"…\KuroWallpaper.exe" /silent` |
| Kuro als Bildschirmschoner setzen | ☑ an | bestehend, unverändert |
| Wallpaper jetzt starten (postinstall) | ☐ aus | zeigt künftig auf die `.exe` statt `.scr /w` |

Kein Tray-Häkchen (§2).

**Uninstall:** Der Uninstaller beendet eine laufende App, bevor er löscht — Windows gibt
eine laufende `.exe` nicht frei, sonst gäbe es eine Fehlermeldung oder eine
Neustart-Aufforderung. Weg: die registrierte Nachricht `KuroWallpaper.Quit` an das
Tray-Fenster (`FindWindowW` auf die Fensterklasse), mit kurzem Timeout, dann löschen.
Danach wie gehabt: `Run\KuroWallpaper` und `SCRNSAVE.EXE` nur räumen, wenn sie auf unsere
Dateien zeigen.

## 8. Mitgeführte Fixes

| Fix | Wo |
|---|---|
| `/utf-8` für MSVC | `CMakeLists.txt`: `add_compile_options($<$<CXX_COMPILER_ID:MSVC>:/utf-8>)`. Die Quellen sind UTF-8 ohne BOM; ohne das Flag liest MSVC sie als System-Codepage → „Einstellungenâ€¦". Fixt alle Nicht-ASCII-Strings auf einmal, nicht nur den einen. |
| Postinstall-Task | zeigt auf `KuroWallpaper.exe` statt `KuroScreensaver.scr /w` |
| `release.yml` | ruft `package-windows-installer.sh` auf, statt ISCC inline zu duplizieren (das Script läuft seit v0.10.1 auf Windows; die Duplikation IST die v0.7.0-Fehlerklasse) |

## 9. Tests

**`options_test.cpp` (C++, läuft in CI):**
- Wallpaper-Satz round-trip über `kRegPath\Wallpaper`, ohne den Saver-Satz zu berühren
- Ein Save des Saver-Satzes lässt den Wallpaper-Unterschlüssel unverändert (und umgekehrt)
- Leerer Wallpaper-Unterschlüssel → Wallpaper-Defaults (`audio=false`, `scale=0.66`)
- W-Trio-Leer-Sentinel unverändert grün (bestehende Tests dürfen nicht brechen)
- Autostart-Key-Migration: `.scr /w` → `.exe /silent`; fremder Wert bleibt unangetastet

**`tests/settings-form.test.ts` (web):**
- `wp*`-Query-Keys werden gelesen und in den Wallpaper-Tab gefüllt
- Erste 12 Query-Keys bleiben byte-identisch (bestehende Fixture, darf nicht brechen)
- Save serialisiert beide Sätze; Numerik unverändert als roher String
- Fixtures bleiben beidseitig gepinnt (`options_test.cpp` ↔ `settings-form.test.ts`)

**Nicht automatisiert testbar (on-device):** Single-Instance über echte Prozesse, das
Tray-Icon in Realgröße, ob der Uninstaller die laufende App wirklich freibekommt, und ob
der Startmenü-Shortcut jetzt tatsächlich das Wallpaper startet. Diese vier gehen in die
Abnahme-TaskNote.

## 10. Bewusste Skips

- **W-Trio-Migration** (§4) — Kosmetik an der einzigen getesteten Stelle.
- **Tray-Icon abschaltbar** (§2) — machte das Wallpaper unkündbar.
- **Tray/Settings übersetzen** (§2/E5) — deutlich größerer Umbau, geringer Nutzen für
  Johannes als einzigen Nutzer; der Installer deckt den Sprachbruch ausreichend ab.
- **Live-Vorschau im Dialog** — der Wallpaper-Tab wendet direkt auf den Desktop an, das
  ist die Vorschau.
- **`animateOnBattery`-UI, Monitor-Cap > 8, Thermal-Signal** — unverändert offen aus v0.10.

## 11. Wellen

1. **Fundament** — `/utf-8`, Icon-Assets, zweites CMake-Target + VERSIONINFO, Default-Arg.
2. **App-Verhalten** — Single-Instance-Mutex, `/silent`, Fenster-Modus, Autostart-Migration.
3. **Settings** — Registry-Unterschlüssel, `wp*`-Query, Tabs in `settings.html`, Live-Apply.
4. **Installer** — Zweisprachigkeit, Tasks, Uninstall-Beendigung, `release.yml`-Entdopplung.

Jede Welle ist für sich lauffähig und testbar. Welle 1+2 allein reparieren bereits den
Startmenü-Eintrag aus §1.1.
