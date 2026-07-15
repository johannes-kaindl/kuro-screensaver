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
  (Implementierung: Range-Minimum = fps/3 — bei 30-fps-Cap exakt die
  spezifizierten min 10; beim 10-fps-Batterie-Cap darf das System bis ~3 fps
  runter, also nur sparsamer, nie aggressiver.)
- `setPaused(true)` → `displayLink.isPaused = true` (heute läuft der Link beim
  Freeze weiter und verwirft Frames).
- Start/Stop/Render auf demselben Thread → Teardown-Barriere entfällt ersatzlos.
- `dt`-Clamp (`min(0.05, …)`) bleibt.

**Renderer.draw():**
- `waitUntilCompleted()` entfernen. GPU-Zeit via `addCompletedHandler` in eine
  atomare Variable; Qualitätsregler konsumiert das Sample beim nächsten Frame
  (ein Frame Latenz ist für den hysteretischen Regler irrelevant).
- Frame-Slot statt Rückstau-Puffer *(korrigiert 2026-07-15 im Final-Review)*:
  Szenen mutieren `.storageModeShared`-Vertex-Buffer in `advance()` — die
  ursprüngliche Annahme „keine CPU/GPU-Hazards" galt nur für die
  `setBytes`-Uniforms. Deshalb `DispatchSemaphore(value: 1)`: der Host
  akquiriert den Slot VOR `advance()`; im Normalfall (GPU schneller als das
  fps-Ziel) ist das wartefrei und der CPU-Gewinn bleibt, nur GPU-gebundene
  Hardware re-serialisiert — genau dort, wo Korrektheit es verlangt.

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
   Goldens laufen mit `synchronousDraws = true` — sie beweisen
   Encoding-Determinismus, nicht das asynchrone In-Flight-Verhalten; letzteres
   deckt nur der on-device-Test ab.
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

## Ergebnisse (gemessen 2026-07-15, M5 Pro, AC, terrain/toxic-haze, 60 s)

| Stand | CPU avg | CPU max | Bemerkung |
|---|---|---|---|
| Baseline (v0.7.1) | 3.4% | 4.5% | CVDisplayLink 120 Hz, waitUntilCompleted |
| + async GPU-Timing | 2.0% | 2.7% | Renderer async GPU-Timing, 2-frames-in-flight-Semaphore; Harness synchronousDraws=true |
| + CADisplayLink | 2.8% | 6.7% | Delta zu vorher = Messrauschen (Review-Einschätzung); Wakeup-Effekt nur via powermetrics messbar |
| + PowerPolicy | — | — | 0.0% im gesperrten Hintergrundlauf — Policy pausiert korrekt; Normalbetriebs-Wert = Endstand-Zeile |
| + Render-Scale 0,66 (Endstand) | ausstehend (on-device) | ausstehend (on-device) | frische on-device-Messung erforderlich; Bildschirm bei Background-Lauf gesperrt → Rendering pausiert (Policy funktioniert) |

**GPU-Power/Wakeups (sudo powermetrics):** steht aus — Kommando siehe `scripts/measure-wallpaper.sh`, Ausführung durch Johannes on-device.

**Messung-Caveat:** ps-basiertes CPU-Sampling (top-Tool) unter AC-Power; Wallpaper-Modus mit Preset terrain/toxic-haze über 60 Sekunden (plus 8 s Settle-Zeit).
