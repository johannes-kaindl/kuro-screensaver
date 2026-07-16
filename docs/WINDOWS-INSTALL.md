# Installing on Windows (Windows 10 / 11)

The Windows build is a real screensaver — a `KuroScreensaver.scr` that hosts the
live web engine in an embedded **WebView2** (Chromium). You get the full
experience: the procedural film, the unfolding story arcs, automatic scene
switching, every CRT effect — the same engine the browser runs.

> **Do I need an installer?** No. Windows 11 installs `.scr` files natively
> (right-click → **Install**). This build ships as a small **folder** (the `.scr`
> plus a `web/` asset folder), so the only rule is: keep
> that folder together and install from where it lives. See
> [Do we need an installer?](#do-we-need-an-installer) for the trade-offs.

---

## Requirements

- **Windows 10 (x64) or Windows 11.**
- **No .NET / no runtime bundle** — since v0.9.0 the host is a tiny native exe;
  the whole download is <5 MB. (v0.7.1–v0.8.0 bundled a ~65 MB .NET runtime; even
  older builds needed a manual .NET install.)
- **WebView2 runtime** — Microsoft ships it with Windows 11, so it's present on
  almost every machine (and on Windows 10 with a recent Edge) — but it isn't
  guaranteed on *every* device. If the screen stays black, install the free
  **Evergreen Bootstrapper** from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/). Since
  v0.9.0 the host itself shows a message with a download link on start if
  WebView2 is missing, instead of just staying black.
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
Screen Saver Settings dialog). Since **v0.10.0** the dialog matches the macOS
app's config window (settings are saved to `HKCU\Software\KuroScreensaver`).
Since **v0.11.0** it opens on a **Screensaver** tab, with a **Wallpaper** tab
next to it holding the same controls for a separate set of values — see
[Animated wallpaper](#animated-wallpaper). Everything below describes both:

- **Look** — one-click vibe bundles (*Clean · Heavy CRT · Broken Terminal ·
  Vaporwave · Matrix*) that set every CRT knob at once; touching a slider
  switches to *Custom*.
- **Picture** — Scene (`random` runs the procedural film from a calm start),
  Color (13 phosphor presets), Speed, City altitude, View distance/fog, Weather.
- **CRT effects** — seven sliders: glitch intensity, curvature, aperture mask,
  bloom, phosphor trails, NTSC shimmer, halation — plus Scanlines and the CRT
  simulation toggle.
- **Motion & story** — flight banking, reactive world, automatic scene warps
  (+ interval), story terminal.
- **Terminal** — layout: off, bottom strip, or the Apple-Lisa center window.
- **Display & automation** — HUD, Radar, Crosshair, Matrix rain, boot sequence
  (+ speed), day/night cycle, audio.
- **Monitors** — see [Multiple monitors](#multiple-monitors).
- **Performance** — see [Performance](#performance).

> The web version's **live** control bar and hotkeys don't exist in a
> screensaver by design — a screensaver exits the moment you touch the keyboard
> or mouse (since v0.10.0 the saver runs fully chrome-less; the bar no longer
> flashes up at start). Everything that can be a *persistent* setting is in the
> Configure dialog instead.

The story, the corruption escalation, and the automatic scene warps all run on
their own — no input required.

---

## Multiple monitors

Two modes (Configure → **Monitors**, visible when more than one display is
connected):

- **Span** — ONE panoramic image stretches across the whole desktop, following
  your monitor layout from Windows display settings. A portrait monitor shows
  its tall slice of the panorama. With three displays, pair this with a render
  scale of ~66 % (see Performance).
- **Per monitor** (default) — every display gets its own instance. Each monitor
  card in the dialog offers: **on** (global settings), **random** (rolls its own
  scene), a **fixed scene** with an optional own color preset, or **off**
  (covered in black, no engine running — costs nothing).

Monitors are identified by their hardware ID, so a docking station can come and
go: reconnected displays keep their configuration, unknown ones default to
**on** with the global settings.

---

## Animated wallpaper

The engine also runs as your **desktop wallpaper** — behind the icons, on top of
nothing. Since **v0.11.0** it is its own program, `KuroWallpaper.exe`, shipped in
the same folder as the screensaver. There is no separate wallpaper download.

Start it from the **Start menu → Kuro Wallpaper** (the installer creates that
entry by default). It puts the wallpaper on your desktop and opens its settings
window right away. Click it again while the wallpaper runs and the existing
window comes forward — you never get a second wallpaper.

- A **tray icon** appears: pause/resume, **Settings…**, **Autostart**, and quit.
- **Its own settings.** The settings window has two tabs, **Screensaver** and
  **Wallpaper**, each with a complete, independent set: the wallpaper can fly
  through `void` in green while your screensaver stays on `terrain`. Changing
  the wallpaper tab applies to the desktop immediately. (The wallpaper's values
  live under `HKCU\Software\KuroScreensaver\Wallpaper`; the screensaver's stay
  where they were.)
- **Autostart** — tick it in the installer, in the wallpaper tab, or in the tray
  menu. All three write the same `HKCU\…\Run\KuroWallpaper` entry, which starts
  the wallpaper without a window at login.
- By default only the **primary monitor** animates (the wallpaper runs all
  day — this keeps it cheap). Configure per-monitor or span mode in the
  wallpaper tab's **Monitors** section (its own set of per-monitor switches,
  separate from the screensaver's).
- Audio is always off in wallpaper mode, and the render scale defaults to 66 %.
- A **power policy** keeps it invisible in daily use: it freezes behind
  fullscreen apps and presentations, suspends completely (RAM drops too) when
  the session is locked or the display sleeps, and freezes on battery. On AC it
  animates at 30 fps.

> **Installed from the ZIP?** `KuroWallpaper.exe` is in it — double-click it, or
> make your own shortcut to it. Do **not** point a shortcut at the `.scr`: the
> shell throws a `.scr` shortcut's arguments away and runs the screensaver
> instead (that was v0.10's Start-menu entry, and the reason the wallpaper is a
> `.exe` now). `KuroScreensaver.scr /w` still works when the flag really reaches
> the process — from <kbd>Win</kbd>+<kbd>R</kbd>, a batch file, or a Task
> Scheduler entry — but the `.exe` is the shorter road, and it is the only one
> with the settings window and the migrated autostart.

> Wallpaper mode hooks into the desktop's `WorkerW` window — a Windows
> implementation detail that shifted in 24H2. The host detects both layouts; if
> your desktop icons ever vanish, quit via the tray icon and they return.

---

## Performance

If the animation stutters:

1. **Render scale** (Configure → Performance) — drop to 66 % or 50 %. The CRT
   aesthetic hides the lower resolution remarkably well.
2. **Adaptive quality** (default on) — automatically dials back bloom/trails,
   then resolution, when the frame rate drops; recovers when there's headroom.
3. **Hybrid-GPU laptops** — Windows decides which GPU renders the WebView2
   process. If it picks the integrated one: **Settings → System → Display →
   Graphics**, add `msedgewebview2.exe`, set **High performance**.
4. The heaviest effects are **Bloom** and the **CRT simulation** — turning
   either off buys the most frames.

---

## Test it

Right-click `KuroScreensaver.scr` → **Test**, or click **Preview** in the Screen
Saver Settings dialog. Move the mouse or press any key to exit (this is normal
screensaver behaviour).

---

## Uninstall

Installed with the installer? Use **Settings → Apps → Installed apps → Kuro
Screensaver → Uninstall**; it handles all of the below. From the ZIP:

1. If the wallpaper runs, **quit it from the tray icon** — Windows won't delete a
   running program.
2. Open **Screen Saver Settings** (search "screen saver" in the Start menu) and
   set the screensaver back to **(None)**, then **OK**.
3. Delete the extracted `KuroScreensaver` folder.
4. *(Optional)* Remove the autostart entry, if you ever enabled it:
   `reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v KuroWallpaper /f`.
5. *(Optional)* Remove leftover settings (both sets):
   `reg delete "HKCU\Software\KuroScreensaver" /f`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **Preview/Settings/Test do nothing — the process dies instantly** | You're on **v0.7.0 or older**: those builds were framework-dependent and need the .NET 8 Desktop Runtime, which Windows doesn't ship. Update to **v0.7.1+** (self-contained), or install the [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0). From **v0.9.0** on, the host is a native exe and the .NET dependency is gone entirely. |
| **Black screen, nothing renders** | The WebView2 runtime is missing, or the folder was moved/incomplete. Install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), and make sure the `.scr` still sits next to its `web/` folder. From **v0.9.0** on, the host shows a message box with the WebView2 download link instead of just staying black. |
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
- checks for the WebView2 runtime and warns if it's missing,
- speaks **German or English**, following your Windows display language,
- registers a clean **Add/Remove Programs** uninstall (which only unsets the
  screen saver and the autostart entry if they still point at Kuro, and asks a
  running wallpaper to quit before removing its files).

The checkboxes it offers:

| | Default | |
|---|---|---|
| Set Kuro as my active screen saver now | ☑ on | writes `SCRNSAVE.EXE` |
| Create a Start menu entry | ☑ on | **Kuro Wallpaper** → `KuroWallpaper.exe` |
| Create a desktop shortcut | ☐ off | same target |
| Start the wallpaper with Windows | ☐ off | `Run\KuroWallpaper` = `"…\KuroWallpaper.exe" /silent` |

On the last page it offers to open the Screen Saver settings (so you can set the
idle time) and to start the wallpaper right away — the latter unchecked, since a
long-running process shouldn't be a side effect of installing.

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

The host is C++/Win32 + WebView2, built via CMake/MSVC — it only builds on
**Windows** (no macOS/Linux cross-build):

```bash
bash scripts/package-windows.sh   # → dist-native/KuroScreensaver-windows.zip
```

This bundles a fresh web build (`scripts/bundle-web.sh`), builds the host with
CMake (Release, x64), and zips the distributable folder (`.scr` + `web/`).

On macOS/Linux, dispatch the CI build instead and pull down the result:

```bash
gh workflow run windows-host --ref <branch>
# then, once the run finishes:
gh run download --workflow windows-host -n windows-scr-dry-run
```

See [`AGENTS.md`](../AGENTS.md) for the native build layout.
