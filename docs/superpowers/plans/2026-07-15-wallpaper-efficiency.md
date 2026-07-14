# Wallpaper-Effizienz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der `--wallpaper`-Modus (und mittelbar der Screensaver) der nativen macOS-Metal-App wird „unsichtbar im Alltag": keine Wegwerf-Wakeups, kein CPU/GPU-Serialisieren, Pause bei Unsichtbarkeit, adaptive Power-Policy, reduzierte Render-Auflösung.

**Architecture:** Spec: `docs/specs/2026-07-14-wallpaper-efficiency-design.md`. Drei Blöcke, einzeln messbar und committbar: §1 Frame-Pacing (CADisplayLink + async GPU-Timing), §2 PowerPolicy (pure Entscheidungstabelle in Core + Signal-Sammler in der App), §3 Render-Scale. Vorher Baseline-Messung; nach jedem Block dieselbe Messung + Golden-PNG-Vergleich.

**Tech Stack:** Swift (swiftc, kein Xcode), AppKit, Metal, CAMetalLayer, CADisplayLink (macOS 14+). Tests: assert-basiertes `tests/main.swift` via `scripts/run-native-tests.sh`; headless Golden-Renders via `scripts/build-native-harness.sh`.

## Global Constraints

- Nur `native/macos/` + `scripts/` anfassen — Web-/Windows-Targets bleiben unberührt (Spec „Nicht-Ziele").
- §1/§2 müssen **pixelidentische** Harness-Frames liefern (Golden-Hash-Vergleich); §3 ändert nur den Wallpaper-Pfad.
- macOS-Minimum wird 14.0 (Info.plist `LSMinimumSystemVersion` + `-target arm64-apple-macos14.0`); kein `#available`-Doppelpfad, CVDisplayLink-Code wird gelöscht.
- Der Vollbild-Screensaver darf durch die PowerPolicy **nie** pausiert werden (Policy greift nur auf `wallpaperViews`).
- Jede Task endet grün: `bash scripts/run-native-tests.sh` && `bash scripts/smoke-test-native.sh` && `bash scripts/build-native-app.sh`.
- Commits: Conventional Commits, Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Messwerte in `.claude/logs/2026-07-15-wallpaper-messungen.md` sammeln (gitignored); Ergebnis-Tabelle am Ende in die Spec (Task 7).
- `sudo powermetrics` kann nur Johannes ausführen — der Executor sammelt die CPU-%-Messung selbst und druckt das powermetrics-Kommando für Johannes.

---

### Task 1: Mess-Skript + Baseline (CPU, Golden-Hashes)

**Files:**
- Create: `scripts/measure-wallpaper.sh`
- Create (gitignored, nur lokal): `.claude/logs/2026-07-15-wallpaper-messungen.md`

**Interfaces:**
- Produces: `scripts/measure-wallpaper.sh [SECONDS]` — druckt `CPU avg X%  max Y%`; Golden-Baseline-Hashes unter `/tmp/kuro-golden-base/hashes.txt` (von Task 2/3 konsumiert).

- [ ] **Step 1: Mess-Skript schreiben**

```bash
#!/usr/bin/env bash
# Measure the wallpaper mode's CPU cost: launches `--wallpaper` with a fixed
# scene/preset (deterministic load), samples the process CPU% once per second,
# prints avg/max. GPU + package power need root → the matching powermetrics
# command is printed at the end for a manual sudo run.
#
# NOTE: stop any already-running wallpaper instance first (▦ menu → "Hintergrund
# beenden"), otherwise two instances render at once and the numbers are garbage.
#
#   scripts/measure-wallpaper.sh [SECONDS]   # default 60
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUR="${1:-60}"
APP="$ROOT/native/macos/build/KuroMetalApp.app/Contents/MacOS/KuroMetalApp"
[ -x "$APP" ] || bash "$ROOT/scripts/build-native-app.sh"

"$APP" --wallpaper --scene terrain --preset toxic-haze &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT
sleep 8   # settle: boot overlay + window setup

echo "sampling ${DUR}s (pid $PID)…"
samples="$(for _ in $(seq 1 "$DUR"); do ps -o %cpu= -p "$PID" 2>/dev/null || break; sleep 1; done)"
echo "$samples" | awk '{s+=$1; if ($1>m) m=$1; n++}
  END {if (n==0) {print "no samples — app died?"; exit 1}
       printf "CPU avg %.1f%%  max %.1f%%  (n=%d)\n", s/n, m, n}'

echo
echo "GPU/Power/Wakeups (manuell, braucht sudo — bitte Johannes):"
echo "  sudo powermetrics -i 1000 -n 20 --samplers gpu_power,tasks 2>/dev/null | grep -E 'GPU Power|KuroMetalApp'"
```

Datei als `scripts/measure-wallpaper.sh` anlegen, dann: `chmod +x scripts/measure-wallpaper.sh`

- [ ] **Step 2: Baseline-CPU-Messung laufen lassen**

Run: `bash scripts/measure-wallpaper.sh 60`
Expected: eine Zeile wie `CPU avg 12.3%  max 18.0%  (n=60)` — Werte in `.claude/logs/2026-07-15-wallpaper-messungen.md` notieren (Abschnitt „Baseline"). Hinweis: `--scene terrain --preset toxic-haze` fixiert die Last; das Kommando für Johannes' powermetrics-Lauf ebenfalls ins Log kopieren.

- [ ] **Step 3: Golden-Baseline rendern + Hashes sichern**

```bash
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-base --scene terrain --at 8 --seed 1337
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-base-city --scene city --at 8 --seed 1337
(cd /tmp/kuro-golden-base && shasum -a 256 *.png) > /tmp/kuro-golden-base/hashes.txt
(cd /tmp/kuro-golden-base-city && shasum -a 256 *.png) >> /tmp/kuro-golden-base/hashes.txt
cat /tmp/kuro-golden-base/hashes.txt
```

Expected: zwei Hash-Zeilen. Diese Datei ist der Referenzpunkt für Task 2 + 3.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-wallpaper.sh
git commit -m "chore(native): add wallpaper CPU measurement script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Renderer — async GPU-Timing statt waitUntilCompleted (§1b)

**Files:**
- Modify: `native/macos/KuroNativeSaver/Core/Renderer.swift` (Felder ~Zeile 64, `draw(into:)` Zeilen 412–576)
- Modify: `native/macos/KuroNativeSaver/harness/main.swift` (~Zeile 180, nach Renderer-Init)

**Interfaces:**
- Produces: `Renderer.synchronousDraws: Bool` (default `false`) — Harness/Readback-Hosts setzen `true`, dann blockiert `draw()` wie bisher bis GPU-Ende. App-Pfad bleibt `false`.
- Konsumiert von Task 3: nichts Neues (MetalHostView ruft `draw(into:)` unverändert).

- [ ] **Step 1: Felder ergänzen**

In `Renderer.swift` direkt unter `private(set) var qualityTier = 0` (Zeile 65) einfügen:

```swift
    /// Harness/tests set this: draw() then blocks until the GPU finished, so a
    /// texture readback right after draw() sees the completed frame. The app
    /// leaves it false (async timing, no per-frame CPU⇄GPU serialisation).
    var synchronousDraws = false
    // Cap the CPU's lead over the GPU; signalled by each command buffer's
    // completed handler. 2 = current frame encoding + one in flight.
    private let inFlight = DispatchSemaphore(value: 2)
    private let gpuMsLock = NSLock()
    private var pendingGpuMs: Double = 0
```

- [ ] **Step 2: draw() umbauen**

In `draw(into:)` den Anfang (Zeilen 412–415) ändern von:

```swift
    func draw(into target: MTLTexture) {
        ensureTextures(target.width, target.height)
        guard let sceneHDR, let depthTex else { return }
        let cb = queue.makeCommandBuffer()!
```

zu (Semaphore NACH dem guard — ein early-return darf keinen Slot verlieren):

```swift
    func draw(into target: MTLTexture) {
        ensureTextures(target.width, target.height)
        guard let sceneHDR, let depthTex else { return }
        // Quality controller: consume the newest async GPU-time sample (written
        // by a completed handler; one frame of latency is irrelevant for the
        // hysteretic controller).
        gpuMsLock.lock(); let gpuSample = pendingGpuMs; pendingGpuMs = 0; gpuMsLock.unlock()
        if gpuSample > 0 { updateQuality(gpuMs: gpuSample) }
        inFlight.wait()
        let cb = queue.makeCommandBuffer()!
```

Und das Ende (Zeilen 573–575) ändern von:

```swift
        cb.commit()
        cb.waitUntilCompleted()
        updateQuality(gpuMs: (cb.gpuEndTime - cb.gpuStartTime) * 1000)
```

zu:

```swift
        // Semaphore captured directly (not self): a buffer completing after the
        // renderer is gone must still signal, and the handler's strong reference
        // keeps the semaphore alive until then (value back at 2 before dispose).
        let sem = inFlight
        cb.addCompletedHandler { [weak self] done in
            sem.signal()
            guard let self else { return }
            let ms = (done.gpuEndTime - done.gpuStartTime) * 1000
            self.gpuMsLock.lock(); self.pendingGpuMs = ms; self.gpuMsLock.unlock()
        }
        cb.commit()
        if synchronousDraws { cb.waitUntilCompleted() }
```

- [ ] **Step 3: Harness auf synchron stellen**

In `harness/main.swift` nach der Renderer-Erzeugung (Zeile ~180, `renderer = try Renderer(...)`) einfügen:

```swift
    renderer.synchronousDraws = true   // getBytes() reads right after draw()
```

(Exakte Stelle: direkt nach der `try Renderer(…)`-Zuweisung, vor der ersten `draw`-Nutzung. Falls die Variable dort `let renderer` in einem anderen Scope ist: die Zeile unmittelbar nach dem Zuweisungs-Statement einfügen.)

- [ ] **Step 4: Tests + Smoke laufen lassen**

Run: `bash scripts/run-native-tests.sh && bash scripts/smoke-test-native.sh`
Expected: alle `ok - …`-Zeilen, Smoke `rendered … bytes`, Exit 0.

- [ ] **Step 5: Golden-Vergleich — muss pixelidentisch sein**

```bash
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-t2 --scene terrain --at 8 --seed 1337
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-t2-city --scene city --at 8 --seed 1337
{ (cd /tmp/kuro-golden-t2 && shasum -a 256 *.png); (cd /tmp/kuro-golden-t2-city && shasum -a 256 *.png); } | diff /tmp/kuro-golden-base/hashes.txt -
```

Expected: kein Output (identische Hashes). Bei Diff: STOPP, Ursache finden (Task nicht committen).

- [ ] **Step 6: Messung + Commit**

Run: `bash scripts/build-native-app.sh && bash scripts/measure-wallpaper.sh 60` — Werte ins Log (Abschnitt „nach Task 2").

```bash
git add native/macos/KuroNativeSaver/Core/Renderer.swift native/macos/KuroNativeSaver/harness/main.swift
git commit -m "perf(native): async GPU timing — drop per-frame waitUntilCompleted

Quality controller now consumes the completed-handler sample (1 frame
latency); 2-frames-in-flight semaphore bounds CPU lead. Harness opts back
into synchronous draws for its readback.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: MetalHostView — CADisplayLink + macOS-14-Floor (§1)

**Files:**
- Modify (Komplett-Rewrite): `native/macos/KuroMetalApp/MetalHostView.swift`
- Modify: `native/macos/KuroMetalApp/Info.plist` (Zeile 24: `11.0` → `14.0`)
- Modify: `scripts/build-native-app.sh` (swiftc-Aufruf: `-target` ergänzen)
- Modify: `AGENTS.md` (macOS-Abschnitt: Floor dokumentieren)

**Interfaces:**
- Produces (API unverändert für alle Hosts): `MetalHostView(frame:settings:autoCycleSec:)`, `start()`, `stop()`, `setPaused(Bool)`, `setFrameCap(Double)`, `cycleScene(by:)`. Rendering läuft jetzt auf dem Main-Thread.
- Konsumiert von Task 5/6: `setPaused`/`setFrameCap` (Task 5), Task 6 erweitert die Datei um `setRenderScale`.

- [ ] **Step 1: MetalHostView.swift komplett ersetzen**

```swift
// MetalHostView — an NSView that hosts the shared Core renderer in a CAMetalLayer,
// driven by a CADisplayLink (NSView.displayLink(target:selector:), macOS 14+).
// The system paces callbacks to preferredFrameRateRange (no manual vsync skipping,
// ProMotion can down-clock), and everything — start/stop/render — runs on the main
// thread, so the old display-thread teardown barrier is gone entirely.
//
// Invariant: hosts call stop() before dropping the view (CADisplayLink retains its
// target); viewDidMoveToWindow(nil) is the safety net.

import AppKit
import Metal
import QuartzCore

final class MetalHostView: NSView {
    private let device = MTLCreateSystemDefaultDevice()
    private var metalLayer: CAMetalLayer?
    private var renderer: Renderer?
    private var link: CADisplayLink?
    private var lastTime: CFTimeInterval = 0
    // Fallback cap for displays that don't honour the range hint exactly
    // (fixed-rate external panels): skip callbacks that arrive early. dt stays
    // correct (measured from the last *rendered* frame).
    private var minFrameInterval: CFTimeInterval = 1.0 / 61.0
    private var frameRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    private var paused = false

    private let settings: Settings
    private let autoCycleSec: Double

    /// Wallpaper power policy: target frame rate (e.g. 30 on AC, 10 on battery).
    func setFrameCap(_ fps: Double) {
        let f = Float(max(1, fps))
        frameRange = CAFrameRateRange(minimum: max(1, f / 3), maximum: f, preferred: f)
        minFrameInterval = 1.0 / (Double(f) + 1)
        link?.preferredFrameRateRange = frameRange
    }
    /// Power policy: pause the display link entirely (0 wakeups). The last
    /// rendered frame stays on the layer (= the "frozen" still).
    func setPaused(_ p: Bool) { paused = p; link?.isPaused = p }
    /// Manual scene-switch hotkey (deliberate fullscreen only): +1 next, -1 previous.
    func cycleScene(by delta: Int) { renderer?.cycleScene(by: delta) }

    init(frame: NSRect, settings: Settings, autoCycleSec: Double) {
        self.settings = settings
        self.autoCycleSec = autoCycleSec
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setupMetal()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    private func setupMetal() {
        guard let device else { return }
        let ml = CAMetalLayer()
        ml.device = device
        ml.pixelFormat = .bgra8Unorm
        ml.isOpaque = true
        ml.frame = bounds
        layer?.addSublayer(ml)
        metalLayer = ml

        let ctx = SceneContext(device: device, rng: LCG(seed: settings.seed ?? freshSeed()),
                               settings: settings, accent: settings.preset.accentRGB)
        let scene = SceneRegistry.make(settings.scene, ctx: ctx)
        do {
            let r = try Renderer(device: device, settings: settings, scene: scene, targetFormat: .bgra8Unorm)
            r.autoCycleSec = autoCycleSec
            renderer = r
        } catch {
            // Don't hard-crash: leave renderer nil so start()/renderFrame() no-op
            // (black layer) and the app stays alive with a logged reason.
            NSLog("[Kuro] Renderer init failed — rendering disabled: \(error)")
            renderer = nil
        }
        updateDrawableSize()
    }

    private func updateDrawableSize() {
        guard let ml = metalLayer else { return }
        let scale = window?.backingScaleFactor ?? 2.0
        ml.frame = bounds
        ml.contentsScale = scale
        ml.drawableSize = CGSize(width: max(1, bounds.width * scale),
                                 height: max(1, bounds.height * scale))
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { stop() } else { updateDrawableSize() }
    }
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateDrawableSize()
    }

    func start() {
        guard link == nil, renderer != nil, metalLayer != nil else { return }
        lastTime = 0
        let l = displayLink(target: self, selector: #selector(tick))
        l.preferredFrameRateRange = frameRange
        l.isPaused = paused
        l.add(to: .main, forMode: .common)
        link = l
    }

    func stop() {
        link?.invalidate()   // removes it from the run loop + drops its target ref
        link = nil
    }

    @objc private func tick() {
        guard !paused, let ml = metalLayer, let renderer else { return }
        let now = CACurrentMediaTime()
        if lastTime != 0, now - lastTime < minFrameInterval { return }
        if lastTime == 0 { lastTime = now }
        let dt = min(0.05, max(0, now - lastTime))
        lastTime = now
        renderer.advance(dt: dt)
        guard let drawable = ml.nextDrawable() else { return }
        renderer.draw(into: drawable.texture)
        drawable.present()
    }
}
```

(Bewusst entfernt: `runLock`/`isRunning`-Barriere, `sizeLock`/`pendingDrawableSize`, `autoreleasepool` im Tick — der Main-RunLoop hat einen ambienten Pool pro Iteration.)

- [ ] **Step 2: Info.plist-Floor anheben**

In `native/macos/KuroMetalApp/Info.plist`: `<string>11.0</string>` → `<string>14.0</string>` (unter `LSMinimumSystemVersion`).

- [ ] **Step 3: Build-Target festnageln**

In `scripts/build-native-app.sh` den swiftc-Aufruf ändern von:

```bash
swiftc -O \
  "${core_src[@]}" "${app_src[@]}" \
```

zu:

```bash
swiftc -O \
  -target arm64-apple-macos14.0 \
  "${core_src[@]}" "${app_src[@]}" \
```

- [ ] **Step 4: AGENTS.md dokumentieren**

Im Abschnitt „## Native builds (`native/`)", macOS-Bullet: nach „Built with `swiftc` (no Xcode) via `scripts/build-native-app.sh`" einfügen: „ (deployment floor **macOS 14** — the render loop uses `NSView.displayLink`/CADisplayLink)".

- [ ] **Step 5: Bauen + Tests + Golden**

Run: `bash scripts/build-native-app.sh && bash scripts/run-native-tests.sh && bash scripts/smoke-test-native.sh`
Expected: „codesign verify OK", Tests ok, Smoke ok.

Golden (Core unverändert — trotzdem prüfen):

```bash
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-t3 --scene terrain --at 8 --seed 1337
bash scripts/build-native-harness.sh --out /tmp/kuro-golden-t3-city --scene city --at 8 --seed 1337
{ (cd /tmp/kuro-golden-t3 && shasum -a 256 *.png); (cd /tmp/kuro-golden-t3-city && shasum -a 256 *.png); } | diff /tmp/kuro-golden-base/hashes.txt -
```

Expected: kein Output.

- [ ] **Step 6: Funktionstest Wallpaper + Vollbild (kurz, lokal)**

```bash
APP=native/macos/build/KuroMetalApp.app/Contents/MacOS/KuroMetalApp
"$APP" --wallpaper --scene terrain & P=$!; sleep 12; ps -p $P && kill $P   # muss 12s leben, Desktop animiert
"$APP" --scene terrain & P=$!; sleep 6; ps -p $P && kill $P                # Vollbild-Override startet
```

Expected: beide Prozesse laufen bis zum kill (kein Crash-Log in `log stream`-Ausgabe nötig; `ps` genügt). Danach Messung: `bash scripts/measure-wallpaper.sh 60` → Log „nach Task 3" (Erwartung: avg-CPU sinkt gegenüber Task 2, da 120-Hz-Wegwerf-Wakeups entfallen).

- [ ] **Step 7: Commit**

```bash
git add native/macos/KuroMetalApp/MetalHostView.swift native/macos/KuroMetalApp/Info.plist scripts/build-native-app.sh AGENTS.md
git commit -m "perf(native): CADisplayLink frame pacing, macOS 14 floor

System-paced preferredFrameRateRange replaces the deprecated CVDisplayLink
(120Hz wakeups discarded manually at low caps). Main-thread loop: the
display-thread teardown barrier (runLock/sizeLock) is gone.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Core RenderPolicy — pure Entscheidungstabelle + Tests (§2a)

**Files:**
- Create: `native/macos/KuroNativeSaver/Core/RenderPolicy.swift`
- Test: `native/macos/KuroNativeSaver/tests/main.swift` (Block ergänzen)

**Interfaces:**
- Produces (von Task 5 konsumiert):
  - `enum RenderState: Equatable { case hidden; case frozen; case animating(fps: Double) }`
  - `struct RenderPolicyInputs` (alle Felder `var` mit Defaults: `occluded/screenLocked/screensAsleep/onBattery/lowPowerMode/thermalSerious/thermalCritical/animateOnBattery = false`, `acFps = 30`, `batteryFps = 10`)
  - `func renderState(_ i: RenderPolicyInputs) -> RenderState`

- [ ] **Step 1: Failing Tests schreiben**

In `tests/main.swift` vor dem abschließenden Failure-Summary-Block einfügen:

```swift
// --- wallpaper render policy (pure decision table) --------------------------
do {
    var i = RenderPolicyInputs()
    check(renderState(i) == .animating(fps: 30), "policy default AC → 30fps")
    i.onBattery = true
    check(renderState(i) == .frozen, "policy battery default → frozen")
    i.animateOnBattery = true
    check(renderState(i) == .animating(fps: 10), "policy battery opt-in → 10fps")
    i = RenderPolicyInputs(); i.lowPowerMode = true
    check(renderState(i) == .frozen, "policy low-power behaves like battery")
    i.animateOnBattery = true
    check(renderState(i) == .animating(fps: 10), "policy low-power opt-in → 10fps")
    i = RenderPolicyInputs(); i.thermalSerious = true
    check(renderState(i) == .animating(fps: 10), "policy thermal serious → 10fps on AC")
    i.thermalCritical = true
    check(renderState(i) == .frozen, "policy thermal critical → frozen")
    i = RenderPolicyInputs(); i.occluded = true; i.animateOnBattery = true
    check(renderState(i) == .hidden, "policy occluded beats everything")
    i = RenderPolicyInputs(); i.screenLocked = true
    check(renderState(i) == .hidden, "policy locked → hidden")
    i = RenderPolicyInputs(); i.screensAsleep = true
    check(renderState(i) == .hidden, "policy display sleep → hidden")
}
```

- [ ] **Step 2: RED verifizieren**

Run: `bash scripts/run-native-tests.sh`
Expected: FAIL — Compile-Fehler `cannot find 'RenderPolicyInputs' in scope` (der RED-Beweis bei compile-time-typed Sprachen).

- [ ] **Step 3: Implementierung**

`native/macos/KuroNativeSaver/Core/RenderPolicy.swift` anlegen:

```swift
// RenderPolicy — pure decision table for the wallpaper's power/visibility
// policy. Lives in Core (no AppKit) so the logic tests cover it; the app layer
// (PowerPolicy.swift) gathers the signals, the AppDelegate applies the result
// per wallpaper view. Priority: invisibility → thermal panic → battery/low-power
// preference → thermal throttle → normal animation.

import Foundation

enum RenderState: Equatable {
    case hidden                    // stop the display link entirely (0 wakeups)
    case frozen                    // keep the last frame as a still
    case animating(fps: Double)
}

struct RenderPolicyInputs {
    var occluded = false           // this window is fully covered / other Space
    var screenLocked = false
    var screensAsleep = false
    var onBattery = false
    var lowPowerMode = false
    var thermalSerious = false     // ProcessInfo.thermalState == .serious
    var thermalCritical = false    // == .critical
    var animateOnBattery = false   // AppSettings.wallpaperOnBattery
    var acFps: Double = 30
    var batteryFps: Double = 10
}

func renderState(_ i: RenderPolicyInputs) -> RenderState {
    if i.occluded || i.screenLocked || i.screensAsleep { return .hidden }
    if i.thermalCritical { return .frozen }
    let saving = i.onBattery || i.lowPowerMode
    if saving && !i.animateOnBattery { return .frozen }
    if i.thermalSerious { return .animating(fps: i.batteryFps) }
    return .animating(fps: saving ? i.batteryFps : i.acFps)
}
```

- [ ] **Step 4: GREEN verifizieren**

Run: `bash scripts/run-native-tests.sh`
Expected: alle neuen `ok   - policy …`-Zeilen, Exit 0.

- [ ] **Step 5: Commit**

```bash
git add native/macos/KuroNativeSaver/Core/RenderPolicy.swift native/macos/KuroNativeSaver/tests/main.swift
git commit -m "feat(native): pure render-policy decision table + tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: PowerPolicy-Signalsammler + AppDelegate-Verdrahtung (§2b)

**Files:**
- Create: `native/macos/KuroMetalApp/PowerPolicy.swift`
- Delete: `native/macos/KuroMetalApp/PowerMonitor.swift`
- Modify: `native/macos/KuroMetalApp/main.swift` (Zeile 30 Typ; `startWallpaper` Zeilen 65–74; `buildWallpaperWindows` Zeilen 76–99; `applyPowerPolicy` Zeilen 109–119; neuer `occlusionChanged`)

**Interfaces:**
- Consumes: `RenderState`/`RenderPolicyInputs`/`renderState(_:)` aus Task 4; `setPaused(Bool)`/`setFrameCap(Double)` aus Task 3.
- Produces: `PowerPolicy` mit `var onChange: (() -> Void)?`, `func start()`, `func stop()`, readonly `onBattery/lowPowerMode/thermal/screenLocked/screensAsleep`, `static func isOnBattery() -> Bool`.

- [ ] **Step 1: PowerPolicy.swift anlegen**

```swift
// PowerPolicy — gathers every system signal the wallpaper's power policy needs
// (battery, Low Power Mode, thermal pressure, screen lock, display sleep) and
// fires onChange on the main queue; the AppDelegate combines them with
// per-window occlusion and applies the pure Core decision (renderState) to each
// wallpaper view. Battery stays polled: plug/unplug latency is irrelevant for a
// wallpaper, and polling avoids the IOPS C-callback dance.

import AppKit
import IOKit.ps

final class PowerPolicy {
    var onChange: (() -> Void)?
    private(set) var onBattery = false
    private(set) var lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    private(set) var thermal = ProcessInfo.processInfo.thermalState
    private(set) var screenLocked = false
    private(set) var screensAsleep = false

    private var timer: Timer?
    private var tokens: [(center: NotificationCenter, token: NSObjectProtocol)] = []

    func start() {
        onBattery = PowerPolicy.isOnBattery()
        let t = Timer(timeInterval: 5, repeats: true) { [weak self] _ in self?.pollBattery() }
        t.tolerance = 2   // coalesce: exact phase is irrelevant, save wakeups
        RunLoop.main.add(t, forMode: .common); timer = t

        observe(.default, .NSProcessInfoPowerStateDidChange) { [weak self] in
            self?.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
        observe(.default, ProcessInfo.thermalStateDidChangeNotification) { [weak self] in
            self?.thermal = ProcessInfo.processInfo.thermalState
        }
        let ws = NSWorkspace.shared.notificationCenter
        observe(ws, NSWorkspace.screensDidSleepNotification) { [weak self] in self?.screensAsleep = true }
        observe(ws, NSWorkspace.screensDidWakeNotification) { [weak self] in self?.screensAsleep = false }
        let dnc = DistributedNotificationCenter.default()
        observe(dnc, Notification.Name("com.apple.screenIsLocked")) { [weak self] in self?.screenLocked = true }
        observe(dnc, Notification.Name("com.apple.screenIsUnlocked")) { [weak self] in self?.screenLocked = false }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        tokens.forEach { $0.center.removeObserver($0.token) }
        tokens.removeAll()
    }
    deinit { stop() }

    /// Register on `center`, hop to main, apply the mutation, then fire onChange.
    private func observe(_ center: NotificationCenter, _ name: Notification.Name,
                         _ apply: @escaping () -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            apply(); self?.onChange?()
        }
        tokens.append((center, token))
    }

    private func pollBattery() {
        let b = PowerPolicy.isOnBattery()
        guard b != onBattery else { return }
        onBattery = b
        onChange?()
    }

    /// True when running on battery. A desktop Mac (no battery source) → false.
    static func isOnBattery() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else {
            return false
        }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  let state = desc[kIOPSPowerSourceStateKey] as? String else { continue }
            if state == kIOPSBatteryPowerValue { return true }
        }
        return false
    }
}
```

Dann: `git rm native/macos/KuroMetalApp/PowerMonitor.swift`

- [ ] **Step 2: main.swift umverdrahten**

(a) Zeile 30: `private var power: PowerMonitor?` → `private var power: PowerPolicy?`

(b) In `startWallpaper()` (Zeilen 67–69) ersetzen:

```swift
        let pm = PowerMonitor()
        pm.onChange = { [weak self] _ in self?.applyPowerPolicy() }
        pm.start(); power = pm
```

durch:

```swift
        let pm = PowerPolicy()
        pm.onChange = { [weak self] in self?.applyPowerPolicy() }
        pm.start(); power = pm
```

(c) In `buildWallpaperWindows()` als erste Zeile (vor `wallpaperViews.forEach`):

```swift
        wallpaperWindows.forEach { NotificationCenter.default.removeObserver(self,
            name: NSWindow.didChangeOcclusionStateNotification, object: $0) }
```

und im Fenster-Loop nach `win.orderFrontRegardless()`:

```swift
            NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged),
                name: NSWindow.didChangeOcclusionStateNotification, object: win)
```

(d) `applyPowerPolicy()` (Zeilen 109–119) komplett ersetzen — die Entscheidung
kommt jetzt aus der getesteten Core-Tabelle; `hidden` und `frozen` sind auf
View-Ebene identisch (Link pausiert, letzter Frame bleibt stehen):

```swift
    private func applyPowerPolicy() {
        guard let power else { return }
        for (win, v) in zip(wallpaperWindows, wallpaperViews) {
            var i = RenderPolicyInputs()
            i.occluded = !win.occlusionState.contains(.visible)
            i.screenLocked = power.screenLocked
            i.screensAsleep = power.screensAsleep
            i.onBattery = power.onBattery
            i.lowPowerMode = power.lowPowerMode
            i.thermalSerious = power.thermal == .serious
            i.thermalCritical = power.thermal == .critical
            i.animateOnBattery = AppSettings.wallpaperOnBattery
            switch renderState(i) {
            case .hidden, .frozen:      v.setPaused(true)
            case .animating(let fps):   v.setPaused(false); v.setFrameCap(fps)
            }
        }
    }

    @objc private func occlusionChanged(_ note: Notification) { applyPowerPolicy() }
```

- [ ] **Step 3: Bauen + Tests**

Run: `bash scripts/build-native-app.sh && bash scripts/run-native-tests.sh && bash scripts/smoke-test-native.sh`
Expected: alles grün. (PowerPolicy liegt in der App-Schicht — die Logik dahinter ist die in Task 4 getestete Tabelle.)

- [ ] **Step 4: Verhaltens-Smoke lokal**

```bash
APP=native/macos/build/KuroMetalApp.app/Contents/MacOS/KuroMetalApp
"$APP" --wallpaper --scene terrain & PID=$!
sleep 10; ps -o %cpu= -p $PID          # animiert: >0 %
# Jetzt manuell eine App in den Vollbild-Modus schalten (Desktop verdeckt), dann:
sleep 10; ps -o %cpu= -p $PID          # occluded: → ~0.0
kill $PID
```

Expected: CPU fällt bei vollständiger Verdeckung auf ~0. (Vollständiger Testplan — Sperren, Deckel, Netzteil, Low Power — läuft als on-device-Abnahme durch Johannes, siehe Task 7.)

- [ ] **Step 5: Messung + Commit**

Run: `bash scripts/measure-wallpaper.sh 60` → Log „nach Task 5".

```bash
git add native/macos/KuroMetalApp/PowerPolicy.swift native/macos/KuroMetalApp/main.swift
git rm --cached native/macos/KuroMetalApp/PowerMonitor.swift 2>/dev/null || true
git add -A native/macos/KuroMetalApp/
git commit -m "feat(native): wallpaper power policy — occlusion, lock, sleep, low-power, thermal

PowerMonitor → PowerPolicy: six signals feed the pure Core decision table;
per-window occlusion pauses the display link (0 wakeups when invisible).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Render-Scale fürs Wallpaper (§3)

**Files:**
- Modify: `native/macos/KuroMetalApp/AppSettings.swift` (nach `wallpaperOnBattery`, Zeile 41)
- Modify: `native/macos/KuroMetalApp/MetalHostView.swift` (Feld + Setter + `updateDrawableSize`)
- Modify: `native/macos/KuroMetalApp/main.swift` (`buildWallpaperWindows` + neue Methode `refreshWallpaperScale`)
- Modify: `native/macos/KuroMetalApp/ConfigWindowController.swift` (Popup in „Anzeige & Automatik")

**Interfaces:**
- Consumes: `MetalHostView` aus Task 3.
- Produces: `AppSettings.wallpaperRenderScale: Double` (Default 0.66); `MetalHostView.setRenderScale(_ s: CGFloat)`; `AppDelegate.refreshWallpaperScale()`.

- [ ] **Step 1: Setting ergänzen**

In `AppSettings.swift` nach der `wallpaperOnBattery`-Zeile:

```swift
    static var wallpaperRenderScale: Double { get { dbl("WallpaperScale", 0.66) } set { store.set(newValue, forKey: "WallpaperScale") } }
```

- [ ] **Step 2: MetalHostView erweitern**

Feld unter `private var paused = false`:

```swift
    private var renderScale: CGFloat = 1
```

Setter unter `setPaused`:

```swift
    /// Wallpaper: render at a fraction of the backing size; the CAMetalLayer
    /// upscales to the window. The CRT look hides it, cost drops quadratically.
    /// Fullscreen/preview never call this (stay at 1).
    func setRenderScale(_ s: CGFloat) {
        renderScale = min(1, max(0.25, s))
        updateDrawableSize()
    }
```

In `updateDrawableSize()` die Größenzeile ändern zu:

```swift
        ml.drawableSize = CGSize(width: max(1, bounds.width * scale * renderScale),
                                 height: max(1, bounds.height * scale * renderScale))
```

(`ml.contentsScale = scale` bleibt unverändert — die Layer-Geometrie bleibt voll, nur das Drawable schrumpft; CAMetalLayer streckt es aufs Layer.)

- [ ] **Step 3: AppDelegate anwenden + Live-Refresh**

In `main.swift`, `buildWallpaperWindows()`, nach der `MetalHostView(...)`-Erzeugung und vor `win.contentView = view`:

```swift
            view.setRenderScale(CGFloat(AppSettings.wallpaperRenderScale))
```

Neue Methode neben `setWallpaperFromConfig()`:

```swift
    /// Live-apply a changed wallpaper render scale from the config UI (no rebuild).
    func refreshWallpaperScale() {
        wallpaperViews.forEach { $0.setRenderScale(CGFloat(AppSettings.wallpaperRenderScale)) }
    }
```

- [ ] **Step 4: Config-UI-Popup**

In `ConfigWindowController.swift`:

(a) Property-Zeile 7 ergänzen: `wallScalePopup` in die `NSPopUpButton!`-Liste aufnehmen.

(b) Daten neben `termLayouts` (Zeile 20):

```swift
    private let wallScales: [(String, Double)] = [("Voll (100 %)", 1.0), ("75 %", 0.75), ("66 % – Standard", 0.66), ("50 %", 0.5)]
```

(c) In `buildUI` bei den anderen Popups (nach `idlePopup`, Zeile 124):

```swift
        wallScalePopup = mkPopup(#selector(wallScaleChanged))
        wallScalePopup.addItems(withTitles: wallScales.map { $0.0 })
        wallScalePopup.selectItem(at: wallScales.firstIndex { $0.1 == AppSettings.wallpaperRenderScale } ?? 2)
        wallScalePopup.toolTip = "Render-Auflösung des animierten Hintergrunds. Niedriger = sparsamer; die CRT-Optik kaschiert die Skalierung. Vollbild-Screensaver rendert immer voll."
```

(d) `secBehavior`-Grid (Zeile 161) erweitern:

```swift
            grid([[lab("Wechsel:"), cyclePopup], [lab("Auto-Start:"), idlePopup],
                  [lab("Hintergrund:"), wallScalePopup]]), autostartCheck,
```

(e) Handler neben `terminalChanged` — eigene Action, denn ein Scale-Wechsel ist
kein Look-Eingriff (kein `look = "custom"`) und braucht keinen Preview-Rebuild:

```swift
    @objc private func wallScaleChanged() {
        if wallScalePopup.indexOfSelectedItem >= 0 {
            AppSettings.wallpaperRenderScale = wallScales[wallScalePopup.indexOfSelectedItem].1
        }
        (NSApp.delegate as? AppDelegate)?.refreshWallpaperScale()
    }
```

- [ ] **Step 5: Bauen + Funktionscheck + Messung**

Run: `bash scripts/build-native-app.sh && bash scripts/run-native-tests.sh && bash scripts/smoke-test-native.sh`
Expected: grün. Dann:

```bash
APP=native/macos/build/KuroMetalApp.app/Contents/MacOS/KuroMetalApp
"$APP" --wallpaper --scene terrain & P=$!; sleep 12; ps -p $P && kill $P
bash scripts/measure-wallpaper.sh 60
```

Expected: Wallpaper läuft sichtbar; avg-CPU nochmals niedriger → Log „nach Task 6". **Optik-Abnahme (0,66 vs. 1,0 auf dem XDR-Panel) macht Johannes on-device — nicht selbst entscheiden.**

- [ ] **Step 6: Commit**

```bash
git add native/macos/KuroMetalApp/AppSettings.swift native/macos/KuroMetalApp/MetalHostView.swift native/macos/KuroMetalApp/main.swift native/macos/KuroMetalApp/ConfigWindowController.swift
git commit -m "feat(native): wallpaper render scale (default 0.66, config popup)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Abschlussmessung, Ergebnis-Tabelle, Übergabe an Johannes

**Files:**
- Modify: `docs/specs/2026-07-14-wallpaper-efficiency-design.md` (Ergebnis-Abschnitt anhängen)

**Interfaces:** —

- [ ] **Step 1: Messreihe konsolidieren**

Aus `.claude/logs/2026-07-15-wallpaper-messungen.md` die vier CPU-Messungen (Baseline, nach T2, T3, T6 — T5 optional, occlusionsfrei gemessen ändert sich dort wenig) als Tabelle an die Spec anhängen:

```markdown
## Ergebnisse (gemessen 2026-07-15, M5 Pro, AC, terrain/toxic-haze, 60 s)

| Stand | CPU avg | CPU max | Bemerkung |
|---|---|---|---|
| Baseline (v0.7.1) | X % | X % | CVDisplayLink 120 Hz, waitUntilCompleted |
| + async GPU-Timing | X % | X % | |
| + CADisplayLink | X % | X % | |
| + Render-Scale 0,66 | X % | X % | |

GPU-Power/Wakeups (sudo powermetrics): steht aus — Kommando siehe
scripts/measure-wallpaper.sh, Ausführung Johannes.
```

(X durch echte Werte ersetzen — keine Platzhalter committen.)

- [ ] **Step 2: Commit + on-device-Checkliste an Johannes**

```bash
git add docs/specs/2026-07-14-wallpaper-efficiency-design.md
git commit -m "docs(specs): wallpaper efficiency measurement results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Dann Johannes die offene on-device-Abnahme nennen (nicht selbst abhaken):
1. Optik Render-Scale 0,66 vs. 1,0 (Config-Popup „Hintergrund:").
2. Vollbild-App drüber / Space-Wechsel → Batterie-Menü: App verschwindet aus „Apps mit hohem Energieverbrauch".
3. Sperren/Entsperren, Deckel zu/auf → Wallpaper friert/kommt wieder.
4. Netzteil ziehen → Standbild (bzw. 10 fps bei „Auf Batterie animieren").
5. Low Power Mode an → wie Batterie.
6. Vollbild-Screensaver (Menü „Vollbild starten" + Idle-Agent) läuft flüssig, ←/→ funktioniert, jede Eingabe beendet.
7. `sudo powermetrics`-Lauf (Kommando am Ende von `scripts/measure-wallpaper.sh`).
