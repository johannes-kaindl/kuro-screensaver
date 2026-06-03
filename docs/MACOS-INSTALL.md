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

1. Download `KuroScreensaver-native-app-macos.zip` from the
   [latest release](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest),
   unzip → `KuroMetalApp.app`, and drag it into `/Applications`.
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

The Windows `.scr` is unsigned — SmartScreen may show a blue warning. Click
**"More info" → "Run anyway"**, then right-click `KuroScreensaver.scr` →
**Install**. (Needs the WebView2 runtime, preinstalled on current Win10/11.)

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
