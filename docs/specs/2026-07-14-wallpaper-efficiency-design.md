# Wallpaper-Effizienz: Frame-Pacing, Power-Policy, Render-Scale

**Datum:** 2026-07-14 · **Status:** ratifiziert (Brainstorming mit Johannes)
**Scope:** nur `native/macos/` (KuroMetalApp + Core-Renderer). Web/Windows unberührt.

## Ziel

Der `--wallpaper`-Modus (animated desktop) ist der Daily-Driver-Fall: er läuft
stundenlang neben echter Arbeit. Zielbild **„unsichtbar im Alltag"** — die App darf
im Activity Monitor / Batterie-Menü nie negativ auffallen. Der Screensaver-Modus
erbt die Render-Loop-Verbesserungen mit, bleibt aber visuell bei voller Qualität.

Referenz-Hardware: MacBook Pro M5 Pro, eingebautes 3024×1964-XDR-Display
(ProMotion 120 Hz), Batteriebetrieb üblich.

## Ist-Zustand (Befund 2026-07-14)

1. **`Renderer.draw()` endet mit `cb.waitUntilCompleted()`** (Renderer.swift:574),
   nur um `gpuEndTime - gpuStartTime` für den Qualitätsregler zu lesen. CPU-Thread
   blockiert pro Frame bis GPU-Fertigstellung → keine CPU/GPU-Überlappung,
   verlängerte Wakeups.
2. **`CVDisplayLink`** (deprecated seit macOS 15) feuert mit voller Refresh-Rate
   (120 Hz auf ProMotion); das fps-Cap verwirft Callbacks manuell → bei 10-fps-Cap
   sind 110 von 120 Wakeups/s Wegwerf-Arbeit. Dazu die fragile
   unretained-Pointer + `runLock`-Teardown-Barriere über Threads hinweg.
3. **Keine Sichtbarkeits-/Zustandssignale:** verdeckter Desktop (Vollbild-App,
   anderer Space), Bildschirmsperre, Display-Sleep, Low Power Mode, Thermal
   Pressure — Wallpaper rendert überall stur weiter. Nur AC/Batterie wird
   unterschieden (PowerMonitor, IOPS-Polling 5 s).
4. **Volle Retina-Auflösung im Wallpaper:** ~6 MPixel durch HDR-Zwischentextur +
   Trails-Feedback + Bloom-Kette + CRT-Composite.

Solide und unangetastet: hysteretischer Qualitätsregler (Tiers 0–3 nach
GPU-Zeit, 13/7-ms-Band), Textur-Wiederverwendung, keine Per-Frame-Allokationen,
`setBytes`-Uniforms (keine CPU/GPU-Hazards).

## Design

### §1 Frame-Pacing: CADisplayLink + async GPU-Timing

**MetalHostView:**
- CVDisplayLink (samt Callback, `runLock`/`isRunning`, manuellem Frame-Skip)
  ersetzen durch `view.displayLink(target:selector:)` (CADisplayLink, macOS 14+),
  eingehängt in den Main-RunLoop (`.common`).
- fps-Cap deklarativ via `preferredFrameRateRange`
  (Wallpaper: min 10 / preferred = Policy-fps; Vollbild: 60). System bündelt
  Wakeups, ProMotion-Panel kann heruntertakten.
- `setPaused(true)` → `displayLink.isPaused = true` (heute läuft der Link beim
  Freeze weiter und verwirft Frames).
- Start/Stop/Render auf demselben Thread → Teardown-Barriere entfällt ersatzlos.
- `dt`-Clamp (`min(0.05, …)`) bleibt.

**Renderer.draw():**
- `waitUntilCompleted()` entfernen. GPU-Zeit via `addCompletedHandler` in eine
  atomare Variable; Qualitätsregler konsumiert das Sample beim nächsten Frame
  (ein Frame Latenz ist für den hysteretischen Regler irrelevant).
- Rückstau-Schutz: `DispatchSemaphore(value: 2)` — max. 2 Frames in flight.
  Kein Triple-Buffering-Umbau (Uniforms sind `setBytes`-Kopien).

**Voraussetzung:** `LSMinimumSystemVersion` 11.0 → **14.0** (Info.plist) +
explizites `-target` im Build-Skript. Kein `#available`-Doppelpfad; alter
CVDisplayLink-Code wird gelöscht. *(Entscheidung Johannes 2026-07-14.)*

### §2 PowerPolicy: Sichtbarkeit + Systemzustand

`PowerMonitor` wird zu **`PowerPolicy`** erweitert: sammelt alle Signale und gibt
pro Wallpaper-View genau einen Zielzustand aus —
**`hidden`** (Link pausiert, 0 Wakeups) · **`frozen`** (Standbild) ·
**`animating(fps)`**.

| Signal | Quelle | Wirkung |
|---|---|---|
| Fenster verdeckt | `NSWindow.didChangeOcclusionStateNotification` | `hidden` (pro Fenster) |
| Bildschirm gesperrt | `DistributedNotificationCenter` `com.apple.screenIsLocked`/`Unlocked` | `hidden` |
| Display schläft | `NSWorkspace.screensDidSleepNotification`/`didWake` | `hidden` |
| Low Power Mode | `ProcessInfo.isLowPowerModeEnabled` + PowerStateDidChange | wie Batterie (Default `frozen`) |
| Thermal ≥ `.serious` | `ProcessInfo.thermalStateDidChangeNotification` | fps → 10; `.critical` → `frozen` |
| Batterie | IOPS-Polling (bestehend) | Default `frozen`, Opt-in 10 fps |

Occlusion gilt pro Fenster (Multi-Display), übrige Signale global. Bestehende
Menü-Toggles und das 30-fps-AC-Cap bleiben unverändert — es wird nur nach unten
ergänzt, nie aggressiver animiert als heute.

### §3 Render-Scale (nur Wallpaper)

- `renderScale`-Faktor in `MetalHostView`:
  `drawableSize = bounds × backingScale × scale`; die CAMetalLayer skaliert beim
  Compositing selbst hoch — null Renderer-Änderung.
- **Wallpaper-Default 0,66** (≈ 44 % Pixel-Arbeit); CRT-Ästhetik kaschiert die
  Skalierung. *(Entscheidung Johannes 2026-07-14.)*
- Screensaver/Vollbild + Config-Preview: fest 1,0.
- Einstellbar als Stufen 1,0 / 0,75 / 0,66 / 0,5 — finale Optik-Abnahme
  on-device durch Johannes.
- Qualitätsregler bleibt unangetastet (Scale senkt Grundlast, Regler fängt
  Spitzen).

## Verifikation

1. **Baseline vor dem ersten Commit** (Wallpaper-Modus, 60 s): CPU-% (`top`),
   GPU/Package-Power + Wakeups/s (`sudo powermetrics`, führt Johannes aus).
2. **Nach jedem der drei Blöcke dieselbe Messung** — jede Maßnahme muss sich
   einzeln im Delta zeigen, sonst fliegt sie raus.
3. **Golden-PNG-Harness** (`harness/`): §1+§2 müssen pixelidentische Frames
   liefern; §3 wird separat on-device beurteilt.
4. `bash scripts/run-native-tests.sh` + CI-Compile-Check wie gehabt.
5. **Manueller Testplan (on-device, Johannes):** Vollbild-App drüber,
   Space-Wechsel, Deckel zu/auf, Sperren/Entsperren, Netzteil ziehen/stecken,
   Low Power Mode an/aus; Vollbild-Screensaver darf nie fälschlich pausieren
   (Shielding-Window ist nie occluded — explizit prüfen).

## Risiken

- **Main-Thread-Rendering:** falls Encoding je >2–3 ms kostet, zuckt die
  Config-Preview — im Baseline-Schritt messbar; Fallback: dedizierter
  Render-Thread mit eigenem RunLoop (kleiner Zusatzschritt).
- **Screensaver erbt die Loop-Änderungen** (gleiche View-Klasse): gewollt;
  Occlusion-Pause darf ihn nie treffen (Testplan).
- **macOS-14-Minimum:** abgesegnet; ältere Systeme fallen aus dem Support.

## Nicht-Ziele

Kein MTKView-Umbau, keine Metal-Heaps, keine Shader-Optimierung, kein
CAMetalDisplayLink-Experiment, keine Änderung an Web-/Windows-Targets, keine
Änderung der Screensaver-Optik.

## Umsetzungsreihenfolge

1. Baseline-Messung → 2. §1 Frame-Pacing → 3. §2 PowerPolicy → 4. §3
Render-Scale — jeweils mit Messung + Golden-Check dazwischen, einzeln
committbar und einzeln rückrollbar.
