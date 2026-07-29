# Windows-Mikro-Host (Phase 1, v0.9.0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der .NET-WinForms-.scr-Host wird durch einen C++/Win32-Mikro-Host mit WebView2 ersetzt — Parität `/s /c /p`, HTML-Settings-Dialog, Paket <5 MB statt ~65 MB.

**Architecture:** Kleine native exe (statisch gelinkter WebView2-Loader) hostet das unveränderte Web-Bundle über den Virtual-Host `https://kuro.local/`. Registry-Layout und Query-String-Bridge bleiben byte-identisch zum C#-Host, damit `src/screensaver/params.ts` und bestehende Nutzer-Settings unangetastet weiterlaufen. Der Settings-Dialog wird eine HTML-Seite (`settings.html`, neue Vite-Entry), die Szenen-/Preset-Listen direkt aus den Engine-Daten importiert.

**Tech Stack:** C++17/Win32 (MSVC, CMake), WebView2 SDK (NuGet 1.0.2478.35, `WebView2LoaderStatic.lib`), TypeScript/Vite (Settings-Seite), GitHub Actions `windows-latest`.

**Spec:** `docs/specs/2026-07-15-windows-micro-host-design.md` (ratifiziert). Dieser Plan deckt **nur Phase 1 (v0.9.0)** — kein `/w`-Wallpaper, kein Tray, keine PowerPolicy (das ist Phase 2 / v0.10.0).

## Global Constraints

- **Kein lokaler C++-Build:** MSVC gibt es nur im CI (`windows-latest`). Der Feedback-Loop ist: committen → `git push github <branch>` (direkt zu GitHub — der Codeberg→GitHub-Mirror hängt oft) → `gh run watch`. Deshalb gilt für die C++-Tasks: Test **und** Implementierung in einem Push validieren (ein CI-Roundtrip kostet ~5 min); die Fixture-Strings in den Tests sind aus dem C#-Referenzverhalten abgeleitet und im Plan vorgegeben. Für die Web-Task gilt normales lokales TDD (vitest).
- **Registry-Layout byte-identisch** zum C#-Host: Pfad `HKCU\Software\KuroScreensaver`, Value-Namen `Scene/Preset/Speed/Audio/Bloom/Trails/Scan/Crt/Matrix/Terminal/Radar/Crosshair`, Strings `on`/`off`, Defaults wie `src/engine/data/defaults.ts`.
- **Query-String byte-identisch** zur C#-`Options.QueryString()`-Ausgabe (Key-Reihenfolge: scene, preset, speed, audio, bloom, trails, scan, crt, matrix, terminal, radar, crosshair).
- **.scr-Kontrakt:** exe → `.scr` umbenannt; Args `/s` (Fullscreen), `/c`/`/c:<hwnd>` (Settings), `/p <hwnd>` oder `/p:<hwnd>` (Preview); Default ohne Arg = `/s`.
- **OS-Floor:** Windows 11 offiziell, Windows 10 best-effort (Runtime-Check + MessageBox mit Download-Link; kein Bootstrapper).
- **Single-Source-Packaging:** `scripts/package-windows.sh` bleibt das einzige Build-Kommando; CI-Jobs rufen NUR dieses Script (Lektion v0.7.1 — nie Build-Flags im Workflow duplizieren).
- **Branch:** `feat/windows-micro-host` (von `main`). Push für CI immer zusätzlich nach `github`.
- **Commits:** Conventional Commits mit Trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Code-Kommentare Englisch** (Codebasis-Stil), Plan-/Vault-Sprache Deutsch.

## File Structure (Endzustand Phase 1)

```
settings.html                              NEU  (Vite-Entry, Root wie screensaver.html)
src/settings/form-state.ts                 NEU  (pures Form-Modell, vitest-getestet)
src/settings/main.ts                       NEU  (DOM/Bridge der Settings-Seite)
tests/settings-form.test.ts                NEU
vite.config.ts                             EDIT (settings-Entry)
native/windows/host/CMakeLists.txt         NEU
native/windows/host/src/main.cpp           NEU  (wWinMain, Dispatch)
native/windows/host/src/options.{h,cpp}    NEU  (Registry + Query-String, pur testbar)
native/windows/host/src/webview_host.{h,cpp} NEU (WebView2-Setup, geteilt)
native/windows/host/src/saver_window.{h,cpp} NEU (/s: Fullscreen + Input-Watch)
native/windows/host/src/preview_window.{h,cpp} NEU (/p)
native/windows/host/src/settings_window.{h,cpp} NEU (/c)
native/windows/host/tests/options_test.cpp NEU
.github/workflows/windows-host.yml         NEU  (Build+Test-Loop, Push/Dispatch)
.github/workflows/release.yml              EDIT (windows-Jobs: dotnet → cmake-Script)
scripts/package-windows.sh                 EDIT (dotnet → cmake, 7z-Fallback)
scripts/package-windows-installer.sh       EDIT (nur Doku/PATH-Zeile)
native/windows/installer/KuroScreensaver.iss EDIT (SourceDir, .NET-Kommentare)
native/windows/KuroScreensaver.csproj      DELETE
native/windows/Program.cs                  DELETE
.gitignore                                 EDIT (+ native/windows/host/build)
AGENTS.md, docs/WINDOWS-INSTALL.md         EDIT
```

---

### Task 1: Settings-Web-Seite (form-state + settings.html)

**Files:**
- Create: `src/settings/form-state.ts`
- Create: `src/settings/main.ts`
- Create: `settings.html`
- Test: `tests/settings-form.test.ts`
- Modify: `vite.config.ts` (rollupOptions.input)

**Interfaces:**
- Consumes: `SCENES`/`SceneId` aus `src/engine/data/defaults.ts`, `PRESETS` aus `src/engine/data/presets.ts` (existieren).
- Produces: Save-Message-Format `save:scene=<v>&preset=<v>&speed=<v>&audio=on|off&bloom=…&trails=…&scan=…&crt=…&matrix=…&terminal=…&radar=…&crosshair=…` — Task 4 (C++ `ParseSaveMessage`) parst exakt dieses Format; die Seite antwortet auf „Cancel" mit dem String `cancel`.

- [ ] **Step 1: Branch anlegen**

```bash
git checkout -b feat/windows-micro-host main
```

- [ ] **Step 2: Failing Test schreiben** — `tests/settings-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FORM_DEFAULTS, buildSaveMessage, readInitial } from '../src/settings/form-state';

describe('settings form state (native /c dialog bridge)', () => {
  it('serialises the defaults in the pinned key order', () => {
    // Byte-identical to the C# host's default Options.QueryString() output,
    // with the "save:" prefix instead of "?".
    expect(buildSaveMessage(FORM_DEFAULTS)).toBe(
      'save:scene=random&preset=toxic-haze&speed=norm&audio=off&bloom=on&trails=off' +
        '&scan=on&crt=on&matrix=off&terminal=on&radar=on&crosshair=on',
    );
  });

  it('reads host query params over the defaults', () => {
    const s = readInitial(new URLSearchParams('?scene=city&preset=kuro&audio=on&bloom=off'));
    expect(s.scene).toBe('city');
    expect(s.preset).toBe('kuro');
    expect(s.audio).toBe(true);
    expect(s.bloom).toBe(false);
    expect(s.terminal).toBe(true); // untouched default
  });

  it('round-trips: what readInitial parses, buildSaveMessage re-serialises', () => {
    const q =
      'scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on' +
      '&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off';
    expect(buildSaveMessage(readInitial(new URLSearchParams('?' + q)))).toBe('save:' + q);
  });
});
```

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/settings-form.test.ts`
Expected: FAIL (`Cannot find module '../src/settings/form-state'`)

- [ ] **Step 4: `src/settings/form-state.ts` implementieren**

```ts
// Pure form-state model for the native settings dialog (settings.html).
//
// The Win32 host opens settings.html with the current registry values as
// query params (same serialisation as screensaver.html) and expects a
// "save:key=value&..." string message back — parsed by ParseSaveMessage in
// native/windows/host/src/options.cpp. Key order and on/off encoding are
// pinned by tests/settings-form.test.ts and options_test.cpp on both sides.

export interface SettingsFormState {
  scene: string;
  preset: string;
  speed: string;
  audio: boolean;
  bloom: boolean;
  trails: boolean;
  scan: boolean;
  crt: boolean;
  matrix: boolean;
  terminal: boolean;
  radar: boolean;
  crosshair: boolean;
}

/** Mirrors the engine defaults (defaults.ts) and the host's SaverOptions defaults. */
export const FORM_DEFAULTS: SettingsFormState = {
  scene: 'random',
  preset: 'toxic-haze',
  speed: 'norm',
  audio: false,
  bloom: true,
  trails: false,
  scan: true,
  crt: true,
  matrix: false,
  terminal: true,
  radar: true,
  crosshair: true,
};

export type BoolKey = {
  [K in keyof SettingsFormState]: SettingsFormState[K] extends boolean ? K : never;
}[keyof SettingsFormState];

const BOOL_KEYS: readonly BoolKey[] = [
  'audio', 'bloom', 'trails', 'scan', 'crt', 'matrix', 'terminal', 'radar', 'crosshair',
];

export function readInitial(params: URLSearchParams): SettingsFormState {
  const s: SettingsFormState = { ...FORM_DEFAULTS };
  for (const key of ['scene', 'preset', 'speed'] as const) {
    const v = params.get(key);
    if (v) s[key] = v;
  }
  for (const key of BOOL_KEYS) {
    const v = params.get(key);
    if (v === 'on') s[key] = true;
    else if (v === 'off') s[key] = false;
  }
  return s;
}

/** Serialises in the same key order as the host's BuildQueryString. */
export function buildSaveMessage(s: SettingsFormState): string {
  const on = (b: boolean) => (b ? 'on' : 'off');
  return (
    `save:scene=${s.scene}&preset=${s.preset}&speed=${s.speed}` +
    `&audio=${on(s.audio)}&bloom=${on(s.bloom)}&trails=${on(s.trails)}` +
    `&scan=${on(s.scan)}&crt=${on(s.crt)}&matrix=${on(s.matrix)}` +
    `&terminal=${on(s.terminal)}&radar=${on(s.radar)}&crosshair=${on(s.crosshair)}`
  );
}
```

- [ ] **Step 5: Test laufen lassen — muss grün sein**

Run: `npx vitest run tests/settings-form.test.ts`
Expected: PASS (3 Tests)

- [ ] **Step 6: `settings.html` (Repo-Root) anlegen**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kuro Screensaver — Settings</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; padding: 20px 24px;
        background: #050807; color: #9dffb0;
        font-family: "Cascadia Mono", Consolas, monospace; font-size: 13px;
        user-select: none;
      }
      h1 { font-size: 14px; letter-spacing: 2px; margin: 0 0 16px; color: #d4ffdd; }
      .row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .row label { width: 64px; opacity: 0.8; }
      select {
        flex: 1; background: #0a120d; color: #9dffb0;
        border: 1px solid #1e3a28; padding: 5px 6px; font: inherit;
      }
      .toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 16px 0; }
      .toggles label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      input[type="checkbox"] { accent-color: #3ddc84; }
      .buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
      button {
        background: #0a120d; color: #9dffb0; border: 1px solid #2c5a3c;
        padding: 6px 22px; font: inherit; letter-spacing: 1px; cursor: pointer;
      }
      button:hover { background: #12241a; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/settings/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: `src/settings/main.ts` implementieren**

```ts
// Native settings dialog (Windows .scr `/c`) — renders the persistent options
// and posts them back to the Win32 host via window.chrome.webview.postMessage
// ("save:<query>" or "cancel"). Loads standalone in a browser too (styling /
// dev loop); without the host bridge the messages go to the console instead.
//
// Scene / preset lists come straight from the engine data — the retired C#
// ConfigForm duplicated them by hand.

import { SCENES } from '../engine/data/defaults';
import { PRESETS } from '../engine/data/presets';
import { buildSaveMessage, readInitial, type BoolKey } from './form-state';

const SPEEDS = ['slow', 'norm', 'fast'] as const;

// Same labels as the old WinForms dialog (docs/WINDOWS-INSTALL.md documents them).
const TOGGLES: ReadonlyArray<{ key: BoolKey; label: string }> = [
  { key: 'audio', label: 'Audio' },
  { key: 'bloom', label: 'Bloom' },
  { key: 'scan', label: 'Scanlines' },
  { key: 'crt', label: 'CRT simulation' },
  { key: 'crosshair', label: 'Crosshair' },
  { key: 'matrix', label: 'Matrix rain' },
  { key: 'trails', label: 'Afterburn' },
  { key: 'terminal', label: 'Story terminal' },
  { key: 'radar', label: 'Radar' },
];

const state = readInitial(new URLSearchParams(location.search));

function post(message: string): void {
  const bridge = (window as unknown as {
    chrome?: { webview?: { postMessage(m: string): void } };
  }).chrome?.webview;
  if (bridge) bridge.postMessage(message);
  else console.log('[settings] no host bridge —', message);
}

function row(labelText: string, control: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'row';
  const label = document.createElement('label');
  label.textContent = labelText;
  div.append(label, control);
  return div;
}

function select(values: readonly string[], current: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.append(opt);
  }
  sel.value = values.includes(current) ? current : values[0];
  onChange(sel.value); // normalise unknown registry values to a real option
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const toggles = document.createElement('div');
toggles.className = 'toggles';
for (const { key, label } of TOGGLES) {
  const wrap = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state[key];
  box.addEventListener('change', () => (state[key] = box.checked));
  wrap.append(box, document.createTextNode(label));
  toggles.append(wrap);
}

const buttons = document.createElement('div');
buttons.className = 'buttons';
const save = document.createElement('button');
save.textContent = 'Save';
save.addEventListener('click', () => post(buildSaveMessage(state)));
const cancel = document.createElement('button');
cancel.textContent = 'Cancel';
cancel.addEventListener('click', () => post('cancel'));
buttons.append(save, cancel);

const title = document.createElement('h1');
title.textContent = 'KURO // SCREENSAVER SETTINGS';

document.getElementById('app')!.append(
  title,
  row('Scene', select(['random', ...SCENES], state.scene, (v) => (state.scene = v))),
  row('Color', select(Object.keys(PRESETS), state.preset, (v) => (state.preset = v))),
  row('Speed', select(SPEEDS, state.speed, (v) => (state.speed = v))),
  toggles,
  buttons,
);
```

- [ ] **Step 8: Vite-Entry ergänzen** — `vite.config.ts`, im `input`-Block:

```ts
      input: {
        main: 'index.html',
        screensaver: 'screensaver.html',
        settings: 'settings.html',
      },
```

- [ ] **Step 9: Verifizieren**

Run: `npm run typecheck && npm test && npm run build && ls dist/settings.html`
Expected: alles grün; `dist/settings.html` existiert (damit `bundle-web.sh` sie automatisch mit ins `web/`-Bundle kopiert — das Script entfernt nur `index.html`).

Optional visuell: `npm run dev` → `http://localhost:5173/settings.html` (Save/Cancel loggen in die Konsole).

- [ ] **Step 10: Commit**

```bash
git add settings.html src/settings/ tests/settings-form.test.ts vite.config.ts
git commit -m "feat(windows): HTML settings page for the native /c dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: C++-Grundgerüst — Options, options_test, CMake, CI-Loop

**Files:**
- Create: `native/windows/host/CMakeLists.txt`
- Create: `native/windows/host/src/options.h`
- Create: `native/windows/host/src/options.cpp`
- Create: `native/windows/host/tests/options_test.cpp`
- Create: `.github/workflows/windows-host.yml`
- Modify: `.gitignore` (+ `native/windows/host/build`)

**Interfaces:**
- Produces (für Task 3–5):
  - `struct SaverOptions` — Felder `scene/preset/speed` (`std::wstring`), 9 `bool`-Flags; Defaults = Engine-Defaults.
  - `std::wstring BuildQueryString(const SaverOptions&)` — beginnt mit `?`.
  - `std::wstring EscapeDataString(const std::wstring&)`.
  - `SaverOptions LoadOptions(const wchar_t* regPath = kRegPath)` / `void SaveOptions(const SaverOptions&, const wchar_t* regPath = kRegPath)`.
  - `bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out)` — `msg` OHNE `save:`-Präfix.

- [ ] **Step 1: `native/windows/host/src/options.h`**

```cpp
#pragma once
#include <string>

// Registry home of the persisted options — same layout as the retired C# host
// so existing user settings survive the upgrade untouched.
inline constexpr const wchar_t* kRegPath = L"Software\\KuroScreensaver";

// Persisted user options. Defaults mirror the engine defaults in
// src/engine/data/defaults.ts — an unset registry reproduces the web defaults.
struct SaverOptions {
    std::wstring scene = L"random";
    std::wstring preset = L"toxic-haze";
    std::wstring speed = L"norm";
    bool audio = false;
    bool bloom = true;
    bool trails = false;
    bool scan = true;
    bool crt = true;
    bool matrix = false;
    bool terminal = true;
    bool radar = true;
    bool crosshair = true;
};

// Percent-encodes everything outside RFC 3986 unreserved characters, UTF-8
// based — parity with .NET Uri.EscapeDataString for our value charset.
std::wstring EscapeDataString(const std::wstring& value);

// Builds the query string handed to screensaver.html / settings.html. Must
// stay byte-identical to the old C# Options.QueryString() so the web bridge
// (src/screensaver/params.ts) keeps working unchanged.
std::wstring BuildQueryString(const SaverOptions& o);

// Registry I/O (HKCU). regPath is overridable for tests only.
SaverOptions LoadOptions(const wchar_t* regPath = kRegPath);
void SaveOptions(const SaverOptions& o, const wchar_t* regPath = kRegPath);

// Parses a "key=value&key=value" save message from settings.html (WITHOUT the
// "save:" prefix). Starts from `out`'s current values; returns false — and
// leaves `out` untouched — on any unknown key or invalid value.
bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out);
```

- [ ] **Step 2: `native/windows/host/src/options.cpp`**

```cpp
#include "options.h"

#include <windows.h>

#include <cstdio>
#include <vector>

namespace {

std::wstring ReadReg(const wchar_t* path, const wchar_t* name, const std::wstring& def) {
    wchar_t buf[256];
    DWORD size = sizeof(buf);
    LSTATUS rc = RegGetValueW(HKEY_CURRENT_USER, path, name, RRF_RT_REG_SZ, nullptr, buf, &size);
    return rc == ERROR_SUCCESS ? std::wstring(buf) : def;
}

void WriteReg(const wchar_t* path, const wchar_t* name, const std::wstring& value) {
    RegSetKeyValueW(HKEY_CURRENT_USER, path, name, REG_SZ, value.c_str(),
                    static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
}

bool ReadFlag(const wchar_t* path, const wchar_t* name, bool def) {
    return ReadReg(path, name, def ? L"on" : L"off") == L"on";
}

std::wstring OnOff(bool b) { return b ? L"on" : L"off"; }

// Value charset for scene/preset slugs coming back from settings.html.
bool IsSlug(const std::wstring& v) {
    if (v.empty() || v.size() > 64) return false;
    for (wchar_t c : v) {
        bool ok = (c >= L'a' && c <= L'z') || (c >= L'0' && c <= L'9') || c == L'-';
        if (!ok) return false;
    }
    return true;
}

}  // namespace

std::wstring EscapeDataString(const std::wstring& value) {
    int len = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::vector<char> utf8(static_cast<size_t>(len));
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), len, nullptr, nullptr);

    std::wstring out;
    for (int i = 0; i + 1 < len; ++i) {  // len includes the trailing NUL
        unsigned char c = static_cast<unsigned char>(utf8[static_cast<size_t>(i)]);
        bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved) {
            out += static_cast<wchar_t>(c);
        } else {
            wchar_t hex[4];
            swprintf(hex, 4, L"%%%02X", c);
            out += hex;
        }
    }
    return out;
}

std::wstring BuildQueryString(const SaverOptions& o) {
    return L"?scene=" + EscapeDataString(o.scene) +
           L"&preset=" + EscapeDataString(o.preset) +
           L"&speed=" + EscapeDataString(o.speed) +
           L"&audio=" + OnOff(o.audio) +
           L"&bloom=" + OnOff(o.bloom) +
           L"&trails=" + OnOff(o.trails) +
           L"&scan=" + OnOff(o.scan) +
           L"&crt=" + OnOff(o.crt) +
           L"&matrix=" + OnOff(o.matrix) +
           L"&terminal=" + OnOff(o.terminal) +
           L"&radar=" + OnOff(o.radar) +
           L"&crosshair=" + OnOff(o.crosshair);
}

SaverOptions LoadOptions(const wchar_t* regPath) {
    SaverOptions o;
    o.scene = ReadReg(regPath, L"Scene", o.scene);
    o.preset = ReadReg(regPath, L"Preset", o.preset);
    o.speed = ReadReg(regPath, L"Speed", o.speed);
    o.audio = ReadFlag(regPath, L"Audio", o.audio);
    o.bloom = ReadFlag(regPath, L"Bloom", o.bloom);
    o.trails = ReadFlag(regPath, L"Trails", o.trails);
    o.scan = ReadFlag(regPath, L"Scan", o.scan);
    o.crt = ReadFlag(regPath, L"Crt", o.crt);
    o.matrix = ReadFlag(regPath, L"Matrix", o.matrix);
    o.terminal = ReadFlag(regPath, L"Terminal", o.terminal);
    o.radar = ReadFlag(regPath, L"Radar", o.radar);
    o.crosshair = ReadFlag(regPath, L"Crosshair", o.crosshair);
    return o;
}

void SaveOptions(const SaverOptions& o, const wchar_t* regPath) {
    WriteReg(regPath, L"Scene", o.scene);
    WriteReg(regPath, L"Preset", o.preset);
    WriteReg(regPath, L"Speed", o.speed);
    WriteReg(regPath, L"Audio", OnOff(o.audio));
    WriteReg(regPath, L"Bloom", OnOff(o.bloom));
    WriteReg(regPath, L"Trails", OnOff(o.trails));
    WriteReg(regPath, L"Scan", OnOff(o.scan));
    WriteReg(regPath, L"Crt", OnOff(o.crt));
    WriteReg(regPath, L"Matrix", OnOff(o.matrix));
    WriteReg(regPath, L"Terminal", OnOff(o.terminal));
    WriteReg(regPath, L"Radar", OnOff(o.radar));
    WriteReg(regPath, L"Crosshair", OnOff(o.crosshair));
}

bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out) {
    SaverOptions parsed = out;
    size_t pos = 0;
    while (pos < msg.size()) {
        size_t amp = msg.find(L'&', pos);
        std::wstring pair = msg.substr(pos, amp == std::wstring::npos ? std::wstring::npos : amp - pos);
        pos = (amp == std::wstring::npos) ? msg.size() : amp + 1;

        size_t eq = pair.find(L'=');
        if (eq == std::wstring::npos) return false;
        std::wstring key = pair.substr(0, eq);
        std::wstring val = pair.substr(eq + 1);

        if (key == L"scene") {
            if (!IsSlug(val)) return false;
            parsed.scene = val;
        } else if (key == L"preset") {
            if (!IsSlug(val)) return false;
            parsed.preset = val;
        } else if (key == L"speed") {
            if (val != L"slow" && val != L"norm" && val != L"fast") return false;
            parsed.speed = val;
        } else {
            bool* flag = nullptr;
            if (key == L"audio") flag = &parsed.audio;
            else if (key == L"bloom") flag = &parsed.bloom;
            else if (key == L"trails") flag = &parsed.trails;
            else if (key == L"scan") flag = &parsed.scan;
            else if (key == L"crt") flag = &parsed.crt;
            else if (key == L"matrix") flag = &parsed.matrix;
            else if (key == L"terminal") flag = &parsed.terminal;
            else if (key == L"radar") flag = &parsed.radar;
            else if (key == L"crosshair") flag = &parsed.crosshair;
            if (!flag) return false;
            if (val == L"on") *flag = true;
            else if (val == L"off") *flag = false;
            else return false;
        }
    }
    out = parsed;
    return true;
}
```

- [ ] **Step 3: `native/windows/host/tests/options_test.cpp`**

```cpp
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
```

- [ ] **Step 4: `native/windows/host/CMakeLists.txt`** (Task-2-Stand — noch ohne WebView2/exe, kommt in Task 3):

```cmake
cmake_minimum_required(VERSION 3.20)
project(KuroScreensaverHost CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT — pairs with WebView2LoaderStatic.lib for a single-file exe.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE _WIN32_WINNT=0x0A00)

add_library(host_lib STATIC src/options.cpp)
target_include_directories(host_lib PUBLIC src)
target_link_libraries(host_lib PUBLIC advapi32)

add_executable(options_test tests/options_test.cpp)
target_link_libraries(options_test PRIVATE host_lib)
```

- [ ] **Step 5: `.github/workflows/windows-host.yml`**

```yaml
# Builds + tests the C++/Win32 micro-host on every push that touches it.
# The host is MSVC-only, so this workflow IS the dev feedback loop — there is
# no local build on macOS. Manual run: gh workflow run windows-host.
name: windows-host

on:
  workflow_dispatch:
  push:
    branches: ["**"]
    paths:
      - "native/windows/host/**"
      - ".github/workflows/windows-host.yml"

jobs:
  build-and-test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure (CMake, MSVC x64)
        run: cmake -S native/windows/host -B native/windows/host/build -A x64
      - name: Build (Release)
        run: cmake --build native/windows/host/build --config Release
      - name: Run options tests
        run: native\windows\host\build\Release\options_test.exe
```

- [ ] **Step 6: `.gitignore` ergänzen** — unter `# Native build artifacts`:

```
native/windows/host/build
```

- [ ] **Step 7: Commit + Push + CI abwarten (red/green in einem Roundtrip)**

```bash
git add native/windows/host .github/workflows/windows-host.yml .gitignore
git commit -m "feat(windows): C++ micro-host scaffold — options + registry parity tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push github feat/windows-micro-host
sleep 10  # give Actions a moment to register the run before watching
gh run watch --repo johannes-kaindl/kuro-screensaver \
  "$(gh run list --repo johannes-kaindl/kuro-screensaver --workflow windows-host --limit 1 --json databaseId --jq '.[0].databaseId')" \
  --exit-status
```

Expected: Workflow grün, `options_test.exe` meldet `all options tests passed`. Bei FAIL: Fehlermeldung im Log lesen (`gh run view --log-failed`), fixen, erneut pushen — NICHT das Fixture an die Implementierung anpassen (das Fixture ist die C#-Referenz).

---

### Task 3: WebView2-Glue + Saver-/Preview-Fenster + main.cpp (`/s`, `/p`)

**Files:**
- Create: `native/windows/host/src/webview_host.h` / `.cpp`
- Create: `native/windows/host/src/saver_window.h` / `.cpp`
- Create: `native/windows/host/src/preview_window.h` / `.cpp`
- Create: `native/windows/host/src/main.cpp`
- Modify: `native/windows/host/CMakeLists.txt` (WebView2-SDK, host_lib-Quellen, exe-Target)

**Interfaces:**
- Consumes: `BuildQueryString`, `LoadOptions` (Task 2).
- Produces: `bool EnsureWebView2Runtime()`, `void CreateWebView(HWND, const std::wstring& pageAndQuery, std::function<void(const std::wstring&)> onWebMessage, std::function<void(ICoreWebView2Controller*)> onCreated)` (webview_host.h) · `int RunSaver()` (saver_window.h) · `int RunPreview(HWND parent)` (preview_window.h). Task 4 konsumiert `CreateWebView` und ersetzt den `/c`-Stub in main.cpp durch `RunSettings()`.

- [ ] **Step 1: `native/windows/host/src/webview_host.h`**

```cpp
#pragma once
#include <windows.h>

#include <functional>
#include <string>

struct ICoreWebView2Controller;

// Returns true when the WebView2 Evergreen runtime is available; otherwise
// shows a MessageBox with the download link (Win10 best-effort case — the
// runtime is inbox on Windows 11) and returns false.
bool EnsureWebView2Runtime();

// Creates a WebView2 filling `hwnd` and navigates it to
// https://kuro.local/<pageAndQuery>, with kuro.local mapped to the web/
// folder next to the exe (Chromium refuses ES modules over file://).
// `onWebMessage` (nullable) receives string messages posted by the page.
// `onCreated` hands over the controller holding ONE extra AddRef — the
// window owns that reference and must Release() it when it is destroyed.
void CreateWebView(HWND hwnd, const std::wstring& pageAndQuery,
                   std::function<void(const std::wstring&)> onWebMessage,
                   std::function<void(ICoreWebView2Controller*)> onCreated);
```

- [ ] **Step 2: `native/windows/host/src/webview_host.cpp`**

```cpp
#include "webview_host.h"

#include <shlwapi.h>
#include <wrl.h>

#include <WebView2.h>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

std::wstring ExeDir() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    PathRemoveFileSpecW(path);
    return path;
}

std::wstring UserDataDir() {
    wchar_t tmp[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    return std::wstring(tmp) + L"KuroScreensaverWV2";
}

}  // namespace

bool EnsureWebView2Runtime() {
    wchar_t* version = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    if (SUCCEEDED(hr) && version) {
        CoTaskMemFree(version);
        return true;
    }
    MessageBoxW(nullptr,
                L"Kuro needs the Microsoft Edge WebView2 Runtime (built into Windows 11).\n\n"
                L"Install it from:\n"
                L"https://developer.microsoft.com/microsoft-edge/webview2/",
                L"Kuro Screensaver", MB_OK | MB_ICONERROR);
    return false;
}

void CreateWebView(HWND hwnd, const std::wstring& pageAndQuery,
                   std::function<void(const std::wstring&)> onWebMessage,
                   std::function<void(ICoreWebView2Controller*)> onCreated) {
    std::wstring url = L"https://kuro.local/" + pageAndQuery;

    CreateCoreWebView2EnvironmentWithOptions(
        nullptr, UserDataDir().c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, url, onWebMessage, onCreated](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(hr) || !env) return hr;
                env->CreateCoreWebView2Controller(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, url, onWebMessage, onCreated](HRESULT hr,
                                                             ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(hr) || !controller) return hr;
                            controller->AddRef();  // owned by the window, released on destroy

                            ComPtr<ICoreWebView2> webview;
                            controller->get_CoreWebView2(&webview);

                            ComPtr<ICoreWebView2Settings> settings;
                            webview->get_Settings(&settings);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_IsZoomControlEnabled(FALSE);
                            settings->put_AreDevToolsEnabled(FALSE);
                            settings->put_IsStatusBarEnabled(FALSE);
                            ComPtr<ICoreWebView2Settings3> settings3;
                            if (SUCCEEDED(settings.As(&settings3)))
                                settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);

                            ComPtr<ICoreWebView2_3> webview3;
                            if (SUCCEEDED(webview.As(&webview3))) {
                                std::wstring webDir = ExeDir() + L"\\web";
                                webview3->SetVirtualHostNameToFolderMapping(
                                    L"kuro.local", webDir.c_str(),
                                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                            }

                            if (onWebMessage) {
                                webview->add_WebMessageReceived(
                                    Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                        [onWebMessage](ICoreWebView2*,
                                                       ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                            wchar_t* msg = nullptr;
                                            if (SUCCEEDED(args->TryGetWebMessageAsString(&msg)) && msg) {
                                                onWebMessage(msg);
                                                CoTaskMemFree(msg);
                                            }
                                            return S_OK;
                                        })
                                        .Get(),
                                    nullptr);
                            }

                            RECT rc;
                            GetClientRect(hwnd, &rc);
                            controller->put_Bounds(rc);
                            controller->put_IsVisible(TRUE);

                            ComPtr<ICoreWebView2Controller> cp(controller);
                            ComPtr<ICoreWebView2Controller2> c2;
                            if (SUCCEEDED(cp.As(&c2)))
                                c2->put_DefaultBackgroundColor({255, 0, 0, 0});  // opaque black

                            webview->Navigate(url.c_str());
                            if (onCreated) onCreated(controller);
                            return S_OK;
                        })
                        .Get());
                return S_OK;
            })
            .Get());
}
```

- [ ] **Step 3: `native/windows/host/src/saver_window.h`**

```cpp
#pragma once

// Fullscreen screensaver mode (/s): one borderless topmost window per monitor,
// each hosting its own WebView2. Returns when input is detected (message loop
// ends). Ports SaverForm from the retired C# host 1:1.
int RunSaver();
```

- [ ] **Step 4: `native/windows/host/src/saver_window.cpp`**

```cpp
#include "saver_window.h"

#include <windows.h>

#include <cstdlib>
#include <string>
#include <vector>

#include <WebView2.h>

#include "options.h"
#include "webview_host.h"

namespace {

constexpr UINT_PTR kWatchTimer = 1;
constexpr ULONGLONG kGraceMs = 1000;  // ignore the keypress that launched us
constexpr int kMouseThreshold = 10;   // px, same as the C# host

// The WebView grabs keyboard/mouse focus, so window events never arrive —
// poll global input instead (same approach and constants as the C# host).
struct SaverState {
    POINT origin{};
    bool haveOrigin = false;
    ULONGLONG startTick = 0;
    ICoreWebView2Controller* controller = nullptr;
};

bool g_exiting = false;

void ExitSaver() {
    if (g_exiting) return;
    g_exiting = true;
    PostQuitMessage(0);
}

LRESULT CALLBACK SaverWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    auto* st = reinterpret_cast<SaverState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (msg) {
        case WM_TIMER: {
            if (!st || GetTickCount64() - st->startTick < kGraceMs) return 0;
            POINT p;
            if (GetCursorPos(&p)) {
                if (!st->haveOrigin) {
                    st->origin = p;
                    st->haveOrigin = true;
                } else if (abs(p.x - st->origin.x) > kMouseThreshold ||
                           abs(p.y - st->origin.y) > kMouseThreshold) {
                    ExitSaver();
                    return 0;
                }
            }
            for (int vk = 0x08; vk <= 0xFE; ++vk) {
                if (GetAsyncKeyState(vk) & 0x8000) {
                    ExitSaver();
                    return 0;
                }
            }
            return 0;
        }
        case WM_SIZE:
            if (st && st->controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                st->controller->put_Bounds(rc);
            }
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

BOOL CALLBACK MonitorEnum(HMONITOR, HDC, LPRECT rect, LPARAM lp) {
    reinterpret_cast<std::vector<RECT>*>(lp)->push_back(*rect);
    return TRUE;
}

}  // namespace

int RunSaver() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = SaverWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSaverWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    std::vector<RECT> monitors;
    EnumDisplayMonitors(nullptr, nullptr, MonitorEnum, reinterpret_cast<LPARAM>(&monitors));
    if (monitors.empty()) return 0;

    std::wstring page = L"screensaver.html" + BuildQueryString(LoadOptions());
    ShowCursor(FALSE);

    // States leak intentionally: the windows live until process exit — the
    // message loop ends via PostQuitMessage, never by destroying them one by one.
    for (const RECT& rc : monitors) {
        HWND hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, L"KuroSaverWindow", L"",
                                    WS_POPUP | WS_VISIBLE, rc.left, rc.top,
                                    rc.right - rc.left, rc.bottom - rc.top,
                                    nullptr, nullptr, wc.hInstance, nullptr);
        if (!hwnd) continue;
        auto* st = new SaverState();
        st->startTick = GetTickCount64();
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
        SetTimer(hwnd, kWatchTimer, 120, nullptr);
        CreateWebView(
            hwnd, page,
            [](const std::wstring&) { ExitSaver(); },  // engine close button (×)
            [st](ICoreWebView2Controller* c) { st->controller = c; });
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    ShowCursor(TRUE);
    return 0;
}
```

- [ ] **Step 5: `native/windows/host/src/preview_window.h`**

```cpp
#pragma once
#include <windows.h>

// Preview mode (/p <hwnd>): renders the saver into the small preview area of
// the Windows Screen Saver settings dialog as a WS_CHILD of `parent`.
int RunPreview(HWND parent);
```

- [ ] **Step 6: `native/windows/host/src/preview_window.cpp`**

```cpp
#include "preview_window.h"

#include <string>

#include <WebView2.h>

#include "options.h"
#include "webview_host.h"

namespace {

ICoreWebView2Controller* g_controller = nullptr;

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;
        case WM_DESTROY:
            if (g_controller) {
                g_controller->Release();
                g_controller = nullptr;
            }
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int RunPreview(HWND parent) {
    RECT rc{};
    GetClientRect(parent, &rc);

    WNDCLASSW wc{};
    wc.lpfnWndProc = PreviewWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroPreviewWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, L"KuroPreviewWindow", L"", WS_CHILD | WS_VISIBLE, 0, 0,
                                max(rc.right - rc.left, 1L), max(rc.bottom - rc.top, 1L),
                                parent, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return 0;

    CreateWebView(hwnd, L"screensaver.html" + BuildQueryString(LoadOptions()), nullptr,
                  [](ICoreWebView2Controller* c) { g_controller = c; });

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
```

- [ ] **Step 7: `native/windows/host/src/main.cpp`**

```cpp
// Kuro Screensaver — Windows .scr micro-host (C++/Win32 + WebView2).
//
// A .scr is a normal Windows executable the OS invokes with one of:
//   /s            run the screensaver fullscreen
//   /c  /c:<hwnd> show the configuration dialog
//   /p  <hwnd>    render a small preview into the given parent window
//
// The visuals are the project's web build: the host embeds WebView2 (inbox on
// Windows 11) and loads the bundled web/screensaver.html via the
// https://kuro.local/ virtual host. Options live in
// HKCU\Software\KuroScreensaver and reach the page as URL query params
// (bridge: src/screensaver/params.ts) — layout identical to the retired
// .NET host, so existing user settings carry over.

#include <windows.h>

#include <objbase.h>
#include <shellapi.h>

#include <cstdlib>
#include <cwctype>
#include <string>

#include "options.h"
#include "preview_window.h"
#include "saver_window.h"
#include "webview_host.h"

namespace {

// Handle may arrive as "/p:12345" or "/p 12345".
HWND ParsePreviewHandle(const std::wstring& arg, int argc, LPWSTR* argv) {
    size_t colon = arg.find(L':');
    if (colon != std::wstring::npos)
        return reinterpret_cast<HWND>(static_cast<INT_PTR>(wcstoll(arg.c_str() + colon + 1, nullptr, 10)));
    if (argc > 2)
        return reinterpret_cast<HWND>(static_cast<INT_PTR>(wcstoll(argv[2], nullptr, 10)));
    return nullptr;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    // Fullscreen windows must see real pixel bounds on scaled displays.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::wstring arg = argc > 1 ? argv[1] : L"/s";
    std::wstring flag = arg.substr(0, arg.size() < 2 ? arg.size() : 2);
    for (wchar_t& c : flag) c = static_cast<wchar_t>(towlower(c));

    if (!EnsureWebView2Runtime()) return 1;

    int rc = 0;
    if (flag == L"/c") {
        rc = 0;  // settings dialog lands in the next task
    } else if (flag == L"/p") {
        HWND parent = ParsePreviewHandle(arg, argc, argv);
        rc = parent ? RunPreview(parent) : 0;
    } else {
        rc = RunSaver();
    }

    CoUninitialize();
    return rc;
}
```

- [ ] **Step 8: `CMakeLists.txt` erweitern** — kompletter neuer Stand:

```cmake
cmake_minimum_required(VERSION 3.20)
project(KuroScreensaverHost CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT — pairs with WebView2LoaderStatic.lib for a single-file exe.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_definitions(UNICODE _UNICODE _WIN32_WINNT=0x0A00)

# --- WebView2 SDK (headers + static loader) via NuGet ------------------------
set(WEBVIEW2_VERSION "1.0.2478.35")
set(WEBVIEW2_DIR "${CMAKE_BINARY_DIR}/webview2")
if(NOT EXISTS "${WEBVIEW2_DIR}/build/native/include/WebView2.h")
  file(DOWNLOAD
    "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}"
    "${CMAKE_BINARY_DIR}/webview2.nupkg"
    STATUS dl_status)
  list(GET dl_status 0 dl_code)
  if(NOT dl_code EQUAL 0)
    message(FATAL_ERROR "WebView2 NuGet download failed: ${dl_status}")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${CMAKE_BINARY_DIR}/webview2.nupkg" DESTINATION "${WEBVIEW2_DIR}")
endif()

add_library(host_lib STATIC
  src/options.cpp
  src/webview_host.cpp
  src/saver_window.cpp
  src/preview_window.cpp)
target_include_directories(host_lib PUBLIC src "${WEBVIEW2_DIR}/build/native/include")
target_link_libraries(host_lib PUBLIC
  "${WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib"
  user32 gdi32 shell32 shlwapi ole32 oleaut32 advapi32 version)

add_executable(KuroScreensaver WIN32 src/main.cpp)
target_link_libraries(KuroScreensaver PRIVATE host_lib)

add_executable(options_test tests/options_test.cpp)
target_link_libraries(options_test PRIVATE host_lib)
```

- [ ] **Step 9: Commit + Push + CI abwarten**

```bash
git add native/windows/host
git commit -m "feat(windows): WebView2 micro-host — fullscreen saver + preview (/s, /p)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push github feat/windows-micro-host
sleep 10  # give Actions a moment to register the run before watching
gh run watch --repo johannes-kaindl/kuro-screensaver \
  "$(gh run list --repo johannes-kaindl/kuro-screensaver --workflow windows-host --limit 1 --json databaseId --jq '.[0].databaseId')" \
  --exit-status
```

Expected: Build + options_test grün. Typische Fehlerquellen, falls rot: fehlende `#include <WebView2.h>`-Reihenfolge (nach `<wrl.h>`), Loader-Lib-Pfad (`build/native/x64/WebView2LoaderStaticLib` heißt in manchen SDK-Versionen anders — im Log den extrahierten Pfad unter `webview2/build/native/x64/` prüfen), `min/max`-Makro-Konflikte.

---

### Task 4: Settings-Fenster (`/c`)

**Files:**
- Create: `native/windows/host/src/settings_window.h` / `.cpp`
- Modify: `native/windows/host/src/main.cpp` (Stub → `RunSettings()`)
- Modify: `native/windows/host/CMakeLists.txt` (+ `src/settings_window.cpp` in `host_lib`)

**Interfaces:**
- Consumes: `CreateWebView` (Task 3), `LoadOptions`/`SaveOptions`/`ParseSaveMessage` (Task 2), Save-Message-Format aus Task 1 (`save:<query>` / `cancel`).
- Produces: `int RunSettings()` (settings_window.h).

- [ ] **Step 1: `native/windows/host/src/settings_window.h`**

```cpp
#pragma once

// Configuration dialog (/c): a small host window loading settings.html from
// the web bundle. The page posts "save:<query>" or "cancel" back; save is
// validated by ParseSaveMessage and persisted to HKCU. Replaces the WinForms
// ConfigForm of the retired .NET host.
int RunSettings();
```

- [ ] **Step 2: `native/windows/host/src/settings_window.cpp`**

```cpp
#include "settings_window.h"

#include <windows.h>

#include <string>

#include <WebView2.h>

#include "options.h"
#include "webview_host.h"

namespace {

ICoreWebView2Controller* g_controller = nullptr;

LRESULT CALLBACK SettingsWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;
        case WM_DESTROY:
            if (g_controller) {
                g_controller->Release();
                g_controller = nullptr;
            }
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int RunSettings() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = SettingsWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"KuroSettingsWindow";
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);

    // 440×560 client area, centred on the primary work area.
    RECT desired{0, 0, 440, 560};
    AdjustWindowRect(&desired, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, FALSE);
    int w = desired.right - desired.left;
    int h = desired.bottom - desired.top;
    RECT wa{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);

    HWND hwnd = CreateWindowExW(0, L"KuroSettingsWindow", L"Kuro Screensaver",
                                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
                                wa.left + ((wa.right - wa.left) - w) / 2,
                                wa.top + ((wa.bottom - wa.top) - h) / 2, w, h,
                                nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return 0;

    CreateWebView(
        hwnd, L"settings.html" + BuildQueryString(LoadOptions()),
        [hwnd](const std::wstring& message) {
            if (message == L"cancel") {
                DestroyWindow(hwnd);
                return;
            }
            if (message.rfind(L"save:", 0) == 0) {
                SaverOptions o = LoadOptions();
                if (ParseSaveMessage(message.substr(5), o)) SaveOptions(o);
                DestroyWindow(hwnd);
            }
        },
        [](ICoreWebView2Controller* c) { g_controller = c; });

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
```

- [ ] **Step 3: `main.cpp` verdrahten** — Include ergänzen und den Stub ersetzen:

```cpp
#include "settings_window.h"
```

```cpp
    if (flag == L"/c") {
        rc = RunSettings();
    } else if (flag == L"/p") {
```

- [ ] **Step 4: CMake ergänzen** — in `add_library(host_lib STATIC …)`:

```cmake
  src/settings_window.cpp
```

- [ ] **Step 5: Commit + Push + CI abwarten**

```bash
git add native/windows/host
git commit -m "feat(windows): /c settings window hosting settings.html

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push github feat/windows-micro-host
sleep 10  # give Actions a moment to register the run before watching
gh run watch --repo johannes-kaindl/kuro-screensaver \
  "$(gh run list --repo johannes-kaindl/kuro-screensaver --workflow windows-host --limit 1 --json databaseId --jq '.[0].databaseId')" \
  --exit-status
```

Expected: grün.

---

### Task 5: Packaging + Release-CI + Installer + C#-Abbau + Docs

**Files:**
- Modify: `scripts/package-windows.sh` (kompletter Rewrite)
- Modify: `scripts/package-windows-installer.sh` (Kommentar + dotnet-PATH-Zeile)
- Modify: `.github/workflows/release.yml` (windows- + windows-installer-Job)
- Modify: `.github/workflows/windows-host.yml` (+ `package`-Job für Dry-Runs)
- Modify: `native/windows/installer/KuroScreensaver.iss` (SourceDir, Kommentare)
- Delete: `native/windows/KuroScreensaver.csproj`, `native/windows/Program.cs`
- Modify: `AGENTS.md` (Windows-Absatz), `docs/WINDOWS-INSTALL.md`

**Interfaces:**
- Consumes: CMake-Build (Task 3/4), `dist/settings.html` im Web-Bundle (Task 1).
- Produces: `dist-native/windows-scr/` (Ordner: `KuroScreensaver.scr` + `web/`) und `dist-native/KuroScreensaver-windows.zip` — Pfade, die `release.yml` (publish-Job, unverändert) und die `.iss` konsumieren.

- [ ] **Step 1: `scripts/package-windows.sh` ersetzen** (kompletter neuer Inhalt):

```bash
#!/usr/bin/env bash
# Build the Windows .scr distributable (C++/Win32 micro-host + web bundle).
#
# Single source for CI: both the `windows` and `windows-installer` release
# jobs call this script so build flags can never diverge (v0.7.0 shipped a
# broken installer because a CI step duplicated the build command).
#
# MSVC-only — must run on Windows (CI windows-latest runner or a local
# Windows box). There is no macOS/Linux cross-build for the Win32 host; the
# old dotnet cross-build died with the .NET host (v0.9.0).
#
# Usage: bash scripts/package-windows.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo "ERROR: the C++/Win32 host needs MSVC — run on Windows (CI: windows-latest)" >&2; exit 1 ;;
esac

bash "$ROOT/scripts/bundle-web.sh"

BUILD="$ROOT/native/windows/host/build"
echo "=== cmake build (MSVC x64, Release) ==="
cmake -S "$ROOT/native/windows/host" -B "$BUILD" -A x64
cmake --build "$BUILD" --config Release

OUT="$ROOT/dist-native/windows-scr"
rm -rf "$OUT"
mkdir -p "$OUT"

# A .scr is just the renamed executable; the web/ assets ride next to it.
cp "$BUILD/Release/KuroScreensaver.exe" "$OUT/KuroScreensaver.scr"
cp -R "$ROOT/native/windows/web" "$OUT/web"

ZIP="$ROOT/dist-native/KuroScreensaver-windows.zip"
rm -f "$ZIP"
# Git-Bash on the Windows runners has no `zip`, but 7z is preinstalled.
if command -v 7z >/dev/null 2>&1; then
  (cd "$OUT" && 7z a -tzip -r "$ZIP" . >/dev/null)
  echo "✓ $ZIP"
elif command -v zip >/dev/null 2>&1; then
  (cd "$OUT" && zip -rq "$ZIP" .)
  echo "✓ $ZIP"
else
  echo "⚠ neither 7z nor zip found — publish folder is ready: $OUT"
fi

echo "  Install on Windows: extract, right-click KuroScreensaver.scr → Install."
echo "  Needs the WebView2 runtime (inbox on Windows 11; download link shows on start if missing)."
```

- [ ] **Step 2: `scripts/package-windows-installer.sh` anpassen** — Zeile `export PATH="$HOME/.dotnet:$PATH"` löschen; im Kopfkommentar `dotnet publish` durch `cmake build (MSVC, Windows-only)` ersetzen. Sonst unverändert (es ruft weiter `package-windows.sh` + ISCC).

- [ ] **Step 3: `release.yml` — `windows`-Job ersetzen:**

```yaml
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Typecheck + web tests
        shell: bash
        run: |
          npm ci
          npm run typecheck
          npm test
      - name: Build .scr (C++ micro-host, MSVC)
        shell: bash
        run: bash scripts/package-windows.sh
      - uses: actions/upload-artifact@v4
        with:
          name: dist-windows
          path: dist-native/KuroScreensaver-windows.zip
```

- [ ] **Step 4: `release.yml` — `windows-installer`-Job anpassen:** den `actions/setup-dotnet@v4`-Block entfernen; der `Build web bundle + publish the .scr folder`-Step bleibt (ruft weiter `scripts/package-windows.sh`); im ISCC-Step keine Änderung nötig (die `.iss` findet den neuen Ordner über ihr angepasstes `SourceDir`, Step 5). Kopfkommentar des Jobs aktualisieren: der `.scr` cross-buildet nicht mehr auf Linux, beide Windows-Jobs laufen auf `windows-latest`. Auch den Workflow-Kopfkommentar (Zeilen zu „the .scr itself still cross-builds on Linux") entsprechend kürzen.

- [ ] **Step 5: `KuroScreensaver.iss` anpassen** — `SourceDir`-Default auf den neuen Ordner:

```
; Folder holding the packaged .scr + web/ (output of scripts/package-windows.sh).
#ifndef SourceDir
  #define SourceDir "..\..\..\dist-native\windows-scr"
#endif
```

Außerdem im Kopfkommentar (Zeilen 3–9) die .NET-Sätze streichen: das Paket ist jetzt `KuroScreensaver.scr + web/` (kein bundled .NET, keine WebView2-DLLs); der Satz zum self-contained-publish entfällt. Der `[Files]`-Kommentar wird zu `; The whole packaged folder (.scr + web\) — kept together.` Die WebView2-Erkennung in `[Code]` bleibt unverändert (jetzt erst recht relevant).

- [ ] **Step 6: C#-Host löschen**

```bash
git rm native/windows/KuroScreensaver.csproj native/windows/Program.cs
rm -rf native/windows/bin native/windows/obj
```

- [ ] **Step 7: `windows-host.yml` um Dry-Run-Package-Job ergänzen** (validiert den ganzen Packaging-Pfad ohne Release-Tag):

```yaml
  package:
    if: github.event_name == 'workflow_dispatch'
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Package the .scr zip (same script as release CI)
        shell: bash
        run: |
          npm ci
          bash scripts/package-windows.sh
      - uses: actions/upload-artifact@v4
        with:
          name: windows-scr-dry-run
          path: dist-native/
```

- [ ] **Step 8: `AGENTS.md` — Windows-Absatz unter „## Native builds" ersetzen durch:**

```markdown
- **Windows** — a real `.scr` (`native/windows/host/`, C++/Win32 + WebView2
  hosting `screensaver.html`; the `/c` dialog hosts `settings.html`). MSVC-only:
  built via CMake in CI (`windows-host.yml` on push for the dev loop,
  `release.yml` for releases) — there is no local macOS build. Package is
  `KuroScreensaver.scr` + `web/` (<5 MB; the .NET WinForms host and its
  self-contained runtime were removed in v0.9.0). Optional Inno Setup installer
  (`native/windows/installer/KuroScreensaver.iss`) compiles on the Windows CI
  runner. Persistent settings (scene/colour/speed/FX/HUD) live in
  `HKCU\Software\KuroScreensaver` and are bridged web↔.scr via query params
  (`src/screensaver/params.ts`; dialog: `src/settings/`). Requires the WebView2
  runtime (inbox on Windows 11; the host shows a download link if missing).
  Install steps: `docs/WINDOWS-INSTALL.md`.
```

- [ ] **Step 9: `docs/WINDOWS-INSTALL.md` aktualisieren** — vier gezielte Änderungen:
  1. **Requirements:** den „No .NET install needed"-Punkt ersetzen durch: `**No .NET / no runtime bundle** — since v0.9.0 the host is a tiny native exe; the whole download is <5 MB. (v0.7.1–v0.8.0 bundled a ~65 MB .NET runtime; even older builds needed a manual .NET install.)` Der WebView2-Punkt bleibt, ergänzt um: seit v0.9.0 zeigt der Host beim Start selbst eine Meldung mit Download-Link, statt schwarz zu bleiben.
  2. **Intro-Kasten:** „plus its WebView2 DLLs and a `web/` asset folder" → „plus a `web/` asset folder" (es gibt keine DLLs mehr daneben).
  3. **Troubleshooting-Tabelle:** In der ersten Zeile („Preview/Settings do nothing") ergänzen: ab v0.9.0 entfällt die .NET-Abhängigkeit komplett. In der „Black screen"-Zeile ergänzen: ab v0.9.0 zeigt der Host stattdessen eine MessageBox mit dem WebView2-Link.
  4. **„Building the `.scr` yourself":** Text ersetzen — baut NUR auf Windows (MSVC/CMake); auf macOS/Linux stattdessen den `windows-host`-Workflow per `gh workflow run windows-host` dispatchen und das `windows-scr-dry-run`-Artefakt ziehen. Den Satz zum self-contained .NET publish ersatzlos streichen.

- [ ] **Step 10: Commit + Push + beide Verifikationen**

```bash
git add -A
git commit -m "feat(windows)!: replace .NET host with C++ micro-host in packaging, CI and docs

Package drops from ~65 MB (self-contained .NET) to <5 MB (native exe + web/).
Registry layout and query-param bridge are unchanged — existing user settings
carry over.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push github feat/windows-micro-host
gh workflow run windows-host --repo johannes-kaindl/kuro-screensaver --ref feat/windows-micro-host
sleep 10
gh run watch --repo johannes-kaindl/kuro-screensaver \
  "$(gh run list --repo johannes-kaindl/kuro-screensaver --workflow windows-host --limit 1 --json databaseId --jq '.[0].databaseId')" \
  --exit-status
```

Expected: `build-and-test` UND `package` grün; das Artefakt `windows-scr-dry-run` existiert. Größen-Check (Paket <5 MB ohne `web/`-Anteil ≈ nur die exe):

```bash
gh run download --repo johannes-kaindl/kuro-screensaver -n windows-scr-dry-run -D /tmp/kuro-dry-run "$(gh run list --repo johannes-kaindl/kuro-screensaver --workflow windows-host --limit 1 --json databaseId --jq '.[0].databaseId')"
ls -lh /tmp/kuro-dry-run/KuroScreensaver-windows.zip /tmp/kuro-dry-run/windows-scr/KuroScreensaver.scr
```

Expected: zip deutlich unter 5 MB, `.scr` einige hundert KB. (Danach `/tmp/kuro-dry-run` löschen.)

---

### Task 6: Merge + Release-Vorbereitung v0.9.0 (User-Go-Gate)

**Files:**
- Modify: `package.json` + `native/macos/KuroMetalApp/Info.plist` (via `scripts/bump-version.sh`)

**Interfaces:**
- Consumes: grüner Branch aus Task 1–5.
- Produces: getaggtes Release v0.9.0 (nach explizitem Go von Johannes).

- [ ] **Step 1: Finale Gesamtprüfung auf dem Branch**

Run: `npm run typecheck && npm test && bash scripts/run-native-tests.sh`
Expected: alles grün (Web + macOS-Logiktests unberührt — beweist, dass nur die Windows-Hülle getauscht wurde).

- [ ] **Step 2: Merge nach main**

```bash
git checkout main
git merge --no-ff feat/windows-micro-host -m "Merge feat/windows-micro-host: C++ micro-host replaces .NET .scr (<5 MB)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Version bumpen**

```bash
bash scripts/bump-version.sh 0.9.0
git add -A
git commit -m "chore(release): v0.9.0

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: STOPP — User-Go einholen.** Johannes fragen: „v0.9.0 (Windows-Mikro-Host, Paket <5 MB) ist merge- und tag-fertig, CI-Dry-Run grün. Tag pushen und Release auslösen?" Der on-device-Test ist erst NACH dem Release möglich (Johannes braucht die Artefakte), aber der Tag-Push publiziert — deshalb das Gate.

- [ ] **Step 5 (nach Go): Tag + Push (Codeberg + GitHub direkt — Mirror hängt oft)**

```bash
git tag v0.9.0
git push origin main v0.9.0
git push github main v0.9.0
git branch -d feat/windows-micro-host
git push github --delete feat/windows-micro-host
```

Expected: `release`-Workflow läuft auf GitHub; `dist-windows` (zip) + Installer werden ans Codeberg-Release gehängt (publish-Job). Mit `gh run watch` verfolgen.

- [ ] **Step 6: Vault-TaskNote für die on-device-Abnahme anlegen** — `$VAULT/25_Coding/kuro-screensaver/_Tasks/v0.9.0 on-device-Abnahme Windows.md` (Frontmatter-Muster: bestehende TaskNotes im selben Ordner, `type: 💪 Aufgabe`, `status: 2_geplant_📅`, `projekt: ["[[25_Coding/kuro-screensaver/kuro-screensaver]]"]`). Checkliste: zip entpacken → `/s` Fullscreen (Multi-Monitor) · rechtsklick → Test · Preview im Settings-Dialog (`/p`) · Configure (`/c`, HTML-Dialog: Werte ändern → speichern → erneut öffnen → Werte da? → Saver zeigt sie?) · Upgrade-Pfad: Settings aus v0.8.0-Installation überleben? · Installer-exe · SmartScreen-Verhalten · Win10-Maschine falls greifbar (Runtime-Hinweis-MessageBox).

---

## Bekannte Risiken für den Executor

- **WebView2-SDK-Layout:** Falls `WebView2LoaderStatic.lib` in der gepinnten NuGet-Version anders liegt/heißt, im CI-Log den extrahierten Baum unter `build/webview2/` ansehen und den `target_link_libraries`-Pfad anpassen — NICHT auf den dynamischen Loader (`WebView2Loader.dll`) ausweichen, das bricht die Single-exe-Anforderung.
- **`min`/`max`:** windows.h definiert sie als Makros; der Code nutzt sie bewusst (keine `<algorithm>`-Varianten mischen). Bei Konflikten in neuen Dateien `#define NOMINMAX` NICHT einführen, ohne alle Verwendungen zu prüfen.
- **CI-Roundtrips sparen:** Vor jedem Push die betroffenen C++-Dateien noch einmal vollständig lesen (Tippfehler, fehlende Includes) — jeder vermeidbare rote Lauf kostet ~5 min.
- **Nichts am Registry-/Query-Format „verbessern":** Jede Abweichung bricht entweder bestehende Nutzer-Settings oder `params.ts`. Die Fixtures in beiden Testdateien sind die Referenz.
