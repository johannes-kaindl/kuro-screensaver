# Installing on Windows (Windows 10 / 11)

The Windows build is a real screensaver — a `KuroScreensaver.scr` that hosts the
live web engine in an embedded **WebView2** (Chromium). You get the full
experience: the procedural film, the unfolding story arcs, automatic scene
switching, every CRT effect — the same engine the browser runs.

> **Do I need an installer?** No. Windows 11 installs `.scr` files natively
> (right-click → **Install**). This build ships as a small **folder** (the `.scr`
> plus its WebView2 DLLs and a `web/` asset folder), so the only rule is: keep
> that folder together and install from where it lives. See
> [Do we need an installer?](#do-we-need-an-installer) for the trade-offs.

---

## Requirements

- **Windows 10 (x64) or Windows 11.**
- **No .NET install needed** — the build is *self-contained* and ships its own
  .NET runtime (that's most of the download size). Versions **before 0.7.1**
  were framework-dependent by mistake and silently died without the .NET 8
  Desktop Runtime — if Preview/Settings "do nothing", update.
- **WebView2 runtime** — Microsoft ships it with Windows 11, so it's present on
  almost every machine (and on Windows 10 with a recent Edge) — but it isn't
  guaranteed on *every* device. If the screen stays black, install the free
  **Evergreen Bootstrapper** from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
- **No admin rights needed** for the steps below — the screensaver is registered
  per-user (`HKCU`), nothing is written to `System32`.

---

## Quick install (recommended)

1. **Download** `KuroScreensaver-windows.zip` from the
   [latest release](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest).
2. **Unblock the ZIP first** (clears the "downloaded from the internet" flag from
   everything inside, so SmartScreen won't nag): right-click the ZIP →
   **Properties** → tick **Unblock** → **OK**.
3. **Extract the whole folder** (use Windows' built-in **Extract All**) to a
   stable location you won't move or delete — e.g. `C:\Tools\KuroScreensaver\`
   or `%LOCALAPPDATA%\KuroScreensaver\`. Keep **all** files together (the `.scr`
   loads its DLLs and `web/` folder from its own directory).
4. Inside that folder, **right-click `KuroScreensaver.scr` → Install**. This sets
   Kuro as your active screensaver (it writes the `.scr`'s full path to
   `HKCU\Control Panel\Desktop\SCRNSAVE.EXE`).
   - On **Windows 11**, the entry may be hidden behind **Show more options**
     (or press <kbd>Shift</kbd>+<kbd>F10</kbd>) to reveal the classic menu with
     **Install / Configure / Test**.
5. **Open Screen Saver Settings** to set the idle time and preview — the Install
   verb registers the saver but doesn't reliably pop the dialog itself. Press the
   Windows key, type **"screen saver"**, open **"Change screen saver"** (or
   <kbd>Win</kbd>+<kbd>R</kbd> → `control desk.cpl,screensaver,@screensaver`).
   Confirm *Kuro Screensaver* is selected, set the
   **Wait** time (idle minutes), optionally tick **On resume, display logon
   screen**, then click **OK**.

Done. The screensaver now starts after the idle time you chose.

> **Why not just drop it in the dropdown list?** The Screen Saver Settings
> dropdown only lists `.scr` files from the standard Windows system folders
> (mainly `C:\Windows\System32`). Because this build is multi-file, copying
> *only* the `.scr` there would break it (the DLLs and `web/` folder wouldn't be
> found). **Right-click → Install** is the correct route — it stores the
> screensaver's full path, so it runs from your folder.

---

## Configure it

Right-click `KuroScreensaver.scr` → **Configure** (or click **Settings…** in the
Screen Saver Settings dialog). The config dialog mirrors the persistent options
of the web version (settings are saved to `HKCU\Software\KuroScreensaver`):

- **Scene** — opening scene (`random` runs the procedural film from a calm start;
  `terrain · city · rift · tunnel · void · wreckage · matrix`).
- **Color** — one of the 13 phosphor presets (e.g. `toxic-haze`, `crimson`,
  `phosphor`, `voidwitch`…).
- **Speed** — flight speed (`slow · norm · fast`).
- **Audio** — on/off (off by default).
- **FX / HUD toggles** — Bloom, Scanlines, CRT simulation, Crosshair, Matrix
  rain, Afterburn, Story terminal, Radar.

> The web version's **live** control bar and hotkeys (← → course-correction,
> scene hotkeys, etc.) don't exist in a screensaver by design — a screensaver
> exits the moment you touch the keyboard or mouse. Everything that can be a
> *persistent* setting is in the Configure dialog instead.

The story, the corruption escalation, and the automatic scene warps all run on
their own — no input required. Multi-monitor is supported (one instance per
display).

---

## Test it

Right-click `KuroScreensaver.scr` → **Test**, or click **Preview** in the Screen
Saver Settings dialog. Move the mouse or press any key to exit (this is normal
screensaver behaviour).

---

## Uninstall

1. Open **Screen Saver Settings** (search "screen saver" in the Start menu) and
   set the screensaver back to **(None)**, then **OK**.
2. Delete the extracted `KuroScreensaver` folder.
3. *(Optional)* Remove leftover settings:
   `reg delete "HKCU\Software\KuroScreensaver" /f`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **Preview/Settings/Test do nothing — the process dies instantly** | You're on **v0.7.0 or older**: those builds were framework-dependent and need the .NET 8 Desktop Runtime, which Windows doesn't ship. Update to **v0.7.1+** (self-contained), or install the [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0). |
| **Black screen, nothing renders** | The WebView2 runtime is missing, or the folder was moved/incomplete. Install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), and make sure the `.scr` still sits next to its DLLs + `web/` folder. |
| **"Windows protected your PC" (SmartScreen)** | The `.scr` is **unsigned** (the project has no Windows code-signing cert). Click **More info → Run anyway**. To avoid it entirely, **Unblock the ZIP before extracting** (see step 2). |
| **No "Install" in the right-click menu (Win 11)** | Click **Show more options** (or <kbd>Shift</kbd>+<kbd>F10</kbd>) to get the classic menu. |
| **Not listed in the Screen Saver dropdown** | Expected — multi-file screensavers aren't enumerated there. Use **right-click → Install** instead (it sets the full path). |
| **Doesn't start on idle** | Set a **Wait** time in Screen Saver Settings; note that fullscreen apps / games and some power settings suppress the screensaver. |

---

## Installer (alternative to the manual route)

A one-click **Inno Setup** installer is available — it does the manual steps for
you and removes the "don't move the folder" footgun:

- installs the whole folder to a fixed **per-user** location (`%LOCALAPPDATA%\
  Programs\Kuro Screensaver`) — **no admin rights**,
- optionally sets Kuro as your active screen saver and opens the Settings dialog,
- checks for the WebView2 runtime and warns if it's missing,
- registers a clean **Add/Remove Programs** uninstall (which only unsets the
  screen saver if it still points at Kuro).

Run `KuroScreensaver-Setup-<version>.exe`, click through, done. (It's still
**unsigned**, so SmartScreen warns once — see the troubleshooting table.)

The installer is built from `native/windows/installer/KuroScreensaver.iss` via
`scripts/package-windows-installer.sh` (needs the Inno Setup 6 compiler / ISCC;
the script publishes the `.scr` first, then compiles).

## Do we need an installer?

**No — it's optional.** The native right-click → **Install** flow works on a
current Windows 11 with no admin rights and no extra tooling. The installer above
is pure *convenience*: it guarantees the multi-file folder stays together, gives a
proper uninstall entry, and does the WebView2 check.

Neither route removes the SmartScreen prompt — that needs a paid Windows
code-signing certificate, which the project doesn't currently have (an unsigned
installer triggers the same warning a bare `.scr` does). The ZIP + manual install
remains the simplest path; reach for the installer when one-click install /
uninstall is worth it.

---

## Building the `.scr` yourself

Cross-builds on macOS/Linux (no Windows needed), see
[`AGENTS.md`](../AGENTS.md):

```bash
bash scripts/package-windows.sh   # → dist-native/KuroScreensaver-windows.zip
```

This bundles a fresh web build (`scripts/bundle-web.sh`) next to the `.scr` and
zips the distributable folder. Requires the .NET 8 SDK on `PATH`. The publish is
**self-contained** (bundled .NET runtime) — don't switch it back to
framework-dependent; end-user machines don't have the .NET 8 Desktop Runtime.
