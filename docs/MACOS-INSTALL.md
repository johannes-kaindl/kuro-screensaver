# Installing on macOS

The **native app** (`KuroMetalApp.app`) is **notarized** — it just opens, no
workaround needed. It's the recommended way to run Kuro as a live screensaver.

The **other** macOS builds — the pre-rendered video `.saver`s and the legacy
WebGL `.app` — are unsigned (no per-file notarization), so on first use macOS
**Gatekeeper** warns that it "cannot verify" the file. That's expected and
harmless, clears in about a minute, and you only do it **once** per file.

---

## Native app (recommended) — `KuroMetalApp.app`

1. Download `KuroScreensaver-native-app-macos.zip` from the
   [release](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest),
   unzip → `KuroMetalApp.app`, and drag it into `/Applications`.
2. **Double-click to open.** It's notarized, so it launches straight away — no
   Gatekeeper workaround.
3. In its window, pick a scene / preset / effects (live preview), and turn on
   **"Bei Inaktivität automatisch starten"** to run it as a real screensaver
   (it then starts after the chosen idle time). Any input exits the fullscreen;
   **⌘Q** quits.

---

## Other (unsigned) builds

The rest of this page covers the **unsigned** downloads — the video `.saver`s and
the legacy WebGL `.app`.

---

## Video screensaver — `Kuro <Preset>.saver`

1. Download `Kuro-<Preset>.saver.zip` from the
   [release](https://codeberg.org/jkaindl/kuro-screensaver/releases/latest),
   unzip it → `Kuro <Preset>.saver`.

2. **Clear the download quarantine** — this is the reliable way for a `.saver`,
   because the System-Settings prompt for screensavers is easy to miss. In
   **Terminal**, run (mind the quotes — the name has a space):

   ```bash
   xattr -dr com.apple.quarantine "Kuro <Preset>.saver"
   ```

   e.g. `xattr -dr com.apple.quarantine ~/Downloads/"Kuro Crimson.saver"`

3. **Double-click** the `.saver` → choose *Install for this user* (or all users).

4. **System Settings ▸ Screen Saver** → pick `Kuro <Preset>`. Hover the tile and
   click to preview.

> If you skip step 2 and macOS blocks the screensaver, go to **System Settings →
> Privacy & Security**, scroll all the way to the bottom, and click **"Open
> Anyway"** next to the Kuro notice, then confirm with your password / Touch ID.

> **Note on the preview tile:** macOS shows a generic blue tile for *all* legacy
> `.saver` bundles in the new Sonoma/Sequoia grid — that's an Apple limitation,
> not a problem with the file. The live preview (and the running screensaver)
> show the real preset.

---

## Live app — `KuroScreensaver.app`

1. Download `KuroScreensaver-macos.zip`, unzip → `KuroScreensaver.app`
   (drag it into `/Applications` if you like).

2. First launch shows **"Apple could not verify…"** → click **Done**
   (*not* "Move to Trash").

3. **Apple menu → System Settings → Privacy & Security**, scroll to the bottom →
   **"Open Anyway"** next to the Kuro notice → confirm with password / Touch ID →
   in the final dialog click **"Open Anyway"** once more.

   Nothing further is needed on the next launch.

4. If the **"Open Anyway"** button is missing (some macOS versions), clear the
   quarantine in **Terminal** instead:

   ```bash
   xattr -dr com.apple.quarantine /Applications/KuroScreensaver.app
   ```

5. Move the mouse to reveal the cursor + on-screen controls; **Esc** or **⌘Q**
   exits.

---

## Why is this necessary?

Apple's Gatekeeper quarantines anything downloaded from the internet that isn't
signed with a paid Apple Developer ID and notarized. Removing the quarantine
flag (or clicking "Open Anyway") affects **only** that one file's Gatekeeper
check — every other macOS protection stays in place. The builds are open source;
you can inspect or build them yourself from this repo.

## Windows (`.scr`)

The Windows `.scr` is unsigned too — SmartScreen may show a blue warning. Click
**"More info" → "Run anyway"**, then right-click `KuroScreensaver.scr` →
**Install**. (Needs the WebView2 runtime, preinstalled on current Win10/11.)
