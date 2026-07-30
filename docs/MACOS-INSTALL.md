# Installing on macOS

The macOS build is the **native Metal app** (`KuroMetalApp.app`). It is
**notarized**, so it just opens — no Gatekeeper workaround needed.

> The legacy `.saver` builds (pre-rendered video `.saver`s, the WebGL `.saver`,
> and the experimental live `.saver`) were **retired in v0.5.0** — the native app
> replaces them. macOS Tahoe's sandboxed `legacyScreenSaver` process broke the
> WebGL/Metal compositing those bundles relied on; the standalone app sidesteps it
> entirely.

---

## Native app — `KuroMetalApp.app`

1. Download `KuroScreensaver-native-app-macos.dmg` from the
   [latest release](https://git.jkaindl.de/jkaindl/kuro-screensaver/releases/latest),
   open it, and drag `KuroMetalApp.app` into the `Applications` shortcut.
   (Releases up to v0.9.0 shipped a `.zip` instead — unzip, then drag.)
2. **Double-click to open.** It's notarized, so it launches straight away — no
   "cannot verify" prompt, no quarantine fiddling.
3. In its window, pick a scene / preset / Look / effects (live preview), and turn
   on **"Bei Inaktivität automatisch starten"** to run it as a real screensaver
   (it then starts after the chosen idle time). Any input exits the fullscreen;
   **⌘Q** quits.

That's it. Because the app is notarized + stapled, it also works fully offline on
a fresh Mac — no internet round-trip to Apple on first launch.

---

## Windows (`.scr`)

On Windows, unzip into a folder you keep, then right-click `KuroScreensaver.scr`
→ **Install**. The `.scr` is unsigned, so SmartScreen may warn on first run —
click **"More info" → "Run anyway"**. (Needs the WebView2 runtime, present on
almost all current Win10/11 machines.) Full steps + troubleshooting: **[WINDOWS-INSTALL.md](WINDOWS-INSTALL.md)**.

---

## Why notarized + why no `.saver`?

Apple's Gatekeeper quarantines anything downloaded that isn't signed with a paid
Apple Developer ID and notarized. The native app **is** signed + notarized +
stapled, so none of the old "Open Anyway" / `xattr -dr com.apple.quarantine`
dances apply on macOS anymore.

The old `.saver` bundles couldn't be stapled (a `.saver` can't carry a stapled
ticket) and, more importantly, the screensaver host process on recent macOS no
longer composites a live GPU layer reliably — which is why the live `.saver` was
never shipped and the video `.saver`s have now been retired in favour of the app.
The build is open source; you can inspect or build it yourself from this repo.
