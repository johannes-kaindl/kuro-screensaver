# Native Metal Screensaver (Vertical Slice) — Design

**Date:** 2026-06-02
**Status:** **Slice complete + compositing gate PASSED on-device 2026-06-02
(macOS 26.5).** Renderer (terrain + bloom + full CRT + glitch) built, PNG-verified,
shipped as an Xcode-free `.saver`, and **confirmed compositing full-screen in the
real `legacyScreenSaver` process** with live preset switching — the WebGL failure
mode is resolved. Native Metal is the proven path. Remaining subsystems (other
scenes, terminal, HUD, audio, full glitch/crash, atmosphere loops) are now being
built out in follow-up slices. See the plan `2026-06-02-native-metal-saver-plan.md`.
**Topic:** First native, live-rendered macOS `.saver` — a Metal rewrite of the
screensaver engine, replacing the WebView/video approach. This spec covers the
**vertical slice** (skeleton + one scene + full CRT look), not the full port.

---

## Context

The macOS story so far (see `2026-05-28-screensaver-native-port-design.md` and
`2026-05-29-video-saver-design.md`):

- WebGL **does not composite** inside the sandboxed `legacyScreenSaver`
  process. The WebView `.saver` stays gray on real activation — confirmed
  on-device. Not fixable from our code.
- Current macOS shipping paths are therefore both indirect:
  - a fullscreen **`.app`** hosting the WebView (WebGL composites in a normal
    app process, but it is not a *real* system screensaver), and
  - the **video `.saver`** (`KuroVideoSaver`) that loops a pre-rendered
    `loop.mov` per color preset (real `.saver`, but static — ~235 MB/preset,
    a fixed ~2.5 min loop, no live variation, no interactivity).

A **native Metal renderer** is the only route to a *real* macOS system
screensaver with the live 3D look. There is currently **zero** native
rendering code — all visual logic lives in the TypeScript/three.js engine.

## Goal

Ship a single, installable, configurable native `.saver` that, **on real
screensaver activation**, renders the **terrain** scene live in Metal with the
signature CRT look (bloom + scanlines + vignette + chroma + a working glitch
layer), color preset selectable. This proves two things at once:

1. **Compositing risk** — that a native Metal layer composites in the
   `legacyScreenSaver` process (where WebGL failed).
2. **Aesthetic feasibility** — that the wireframe/line/point + bloom + CRT
   signature look is reproducible in Metal end-to-end.

Everything else (4 more scenes, terminal narrative, HUD, audio, full glitch +
crash sequence) is deliberately deferred to later slices.

## Decisions (ratified with user, 2026-06-02)

| Topic | Decision |
|---|---|
| Scope | **Vertical slice**: native `.saver` skeleton + one scene + full CRT look |
| Rendering tech | **Metal end-to-end** (`CAMetalLayer` + custom shaders), not SceneKit |
| Slice scene | **terrain** (simplest geometry, most iconic look, covers line + per-frame vertex-update paths) |
| Bundle shape | **One configurable `.saver`** with a unique `@objc` principal class (avoids the v0.2.5 class-collision bug structurally) |
| Video `.saver` | **Kept in parallel** as a low-risk fallback; the native one is additive until verified on-device |
| Render loop | **`CVDisplayLink`** driving a `CAMetalLayer`, gated by `start/stopAnimation` |
| CRT post | **Bloom as a separate downsample/threshold/blur chain** + everything else (scanlines, vignette, chroma, ACES, glitch) in **one** final fragment shader |
| terrain geometry | Wireframe via real **line primitives** (`MTLPrimitiveType.line` + explicit edge index buffer) |

## Approach (chosen)

**A fresh native Metal renderer hosted in a standard `ScreenSaverView`,
reusing the existing native scaffolding (bundle/build/config/persistence) and
dropping the entire WebView stack.** The Metal scene + CRT post are written
from scratch in Swift + MSL, porting the math and tuned constants from the
TypeScript engine.

Rejected alternatives:

- **SceneKit / SceneKit + Metal post** — SceneKit's line/point/wireframe
  rendering is its documented weakness, and that *is* the load-bearing look;
  it would fight us on exactly the core aesthetic while giving little in
  return (the geometry is primitive — no PBR/lighting/asset pipeline where
  SceneKit shines).
- **Keep WebView, force compositing** — needs private WebKit flags; already
  ruled out on-device.
- **Per-preset `.saver` bundles** — reintroduces the Obj-C class-collision
  trap (v0.2.5); a single configurable bundle avoids it entirely.

---

## Architecture

### 1. Bundle / target

- New xcodegen target **`KuroNativeSaver`** in `native/macos/project.yml`,
  `WRAPPER_EXTENSION saver`, bundle id `com.kuro.screensaver.native`, links
  **ScreenSaver + Metal + MetalKit + QuartzCore + Cocoa** (no WebKit, no
  AVFoundation). `Info.plist` `NSPrincipalClass = KuroNativeSaverView`,
  `CFBundlePackageType BNDL`. Ad-hoc signed (`CODE_SIGN_IDENTITY "-"`), matching
  the other targets.
- **Reuse the patterns** from the existing scaffold:
  - `ScreenSaverView` subclass shape from `KuroScreensaver/KuroScreensaverView.swift`
    (`@objc(<Name>)` principal class, `init(frame:isPreview:)`,
    `hasConfigureSheet`/`configureSheet`, `start/stopAnimation`, `draw`).
  - `ConfigureSheet.swift` programmatic (xib-free) options sheet.
  - `Defaults.swift` `ScreenSaverDefaults(forModuleWithName:)` persistence.
  - `project.yml` → `xcodebuild` → `codesign --force --deep --sign -` →
    `--verify --deep --strict` → zip toolchain.
- **Drop:** `WebSchemeHandler.swift`, the `web/` folder resource,
  `bundle-web.sh`, the AVPlayer/video pipeline. None are used by a live
  native renderer.
- The existing **`KuroVideoSaver` stays shipping in parallel** as a fallback
  until the native one is verified on real activation.

### 2. Module structure (Swift + Metal)

Each unit has one clear purpose and a narrow interface, so later slices (more
scenes, overlays) dock in cleanly:

- **`KuroNativeSaverView`** (`ScreenSaverView`) — hosts a `CAMetalLayer`,
  owns the `CVDisplayLink`, forwards `start/stopAnimation` to it, owns the
  `Renderer` and a `Config` read from `KuroDefaults`. `isPreview` shrinks the
  workload if needed.
- **`Renderer`** — owns `MTLDevice`, `MTLCommandQueue`, the scene render pass,
  the CRT post pipeline, and the per-frame drawable handoff. Computes **one
  clamped seconds-delta** (`min(0.05, now - last)`) and passes it to the scene
  — fixing the web engine's frame-rate-dependent inconsistency (several web
  scenes drift at 120 Hz ProMotion).
- **`Scene` protocol** — `build(ctx: SceneContext)` then
  `update(t: Double, dt: Double)`, mirroring the web `SceneModule` contract
  (`build(ctx) -> updater`). `SceneContext` carries device, the material/buffer
  factory, the seeded RNG, the camera, and resolved settings.
- **`TerrainScene`** — the slice's only scene (see §4).
- **`Camera`** — perspective camera; FOV aspect breakpoints ported from the web
  (`aspect >= 1.6 → 62°`, `aspect <= 0.75 → 95°`, else `72°` **vertical** FOV),
  `zNear 0.1`, `zFar 600`. Builds the view/projection matrices ourselves with
  `simd` from the vertical FOV — so there is no framework FOV-convention
  ambiguity to reconcile (the breakpoints are three's vertical FOV and we feed
  them straight into our own projection matrix).
- **`LCG`** — the web LCG RNG ported bit-for-bit (`s = (s &* 1664525 &+
  1013904223)`, return `UInt32(bitPattern:) / 2^32`), so layouts are stable and
  reproducible from a seed. `seedLock == nil` → fresh seed per activation.
- **`Palette`** — the 13 color presets as a Swift table (label, kanji,
  darkAccent hex, glow, scanline, vignette). The slice consumes `darkAccent`
  for the accent tint and the per-preset glow/scan/vignette to drive the CRT
  parameters (mapping below). The Obsidian/CSS-var/aspect resolution paths are
  dropped (no vault on native).
- **`CRTPostPipeline`** + **`GlitchScheduler`** — see §5.
- **`ConfigureSheet`** + **`KuroDefaults`** — see §6.

### 3. Render loop & frame flow

```
CVDisplayLink tick (vsync)
  → guard isAnimating (set by start/stopAnimation)
  → dt = clamp(now - last, 0, 0.05); t += dt
  → scene.update(t, dt)            // animate camera + write vertex buffers
  → cmdBuffer:
       pass 1: render scene → sceneTexture (offscreen, black clear, fog, ACES+exposure)
       pass 2: bloom chain  → bloomTexture (threshold → downsample → gaussian blur)
       pass 3: composite + CRT fragment shader (sceneTexture + bloomTexture
               + glitch uniforms) → drawable
  → present(drawable); commit
```

`start/stopAnimation` start/stop the `CVDisplayLink` so the saver pauses
cleanly (the pattern `KuroVideoSaver` already demonstrates with play/pause).

### 4. terrain scene

- **Geometry:** a wireframe heightfield. A grid of vertices (e.g. ~96×96)
  rendered as **line primitives** via an explicit edge index buffer
  (horizontal + vertical grid edges), tinted to the resolved accent color,
  unlit — matching the web `M()` wireframe material.
- **Height formula (ported verbatim):**
  `h = sin(x*0.33)*cos(z*0.2)*2.8 + sin(x*0.77 + z*0.26)*0.95 + cos(x*0.16 - z*0.13)*1.8`
- **Infinite scroll:** two chunks scrolled toward the camera; on wrap, a chunk
  jumps forward by its length and its heights are **resampled at the new
  logical offset** so the seam stays continuous (no rng in the displacement, so
  seams match — same trick as the web `terrain`/`rift`). Per-frame the chunk
  vertex buffer is updated (the slice's proof of the per-frame buffer-write
  path).
- **Camera motion:** fixed forward orientation with a small sinusoidal sway on
  roll/yaw and a gentle `position.y` bob, ported from the web terrain updater.
- **Speed:** `SPEED_VALUES {slow 0.32, norm 1, fast 2.8}` × terrain factor
  (~0.2), applied against the clamped seconds-delta (frame-rate independent).
- **Fog:** exponential-squared fog, black, density ~0.01, applied in the scene
  fragment shader (`fogFactor = exp(-(density*dist)^2)`).
- **Optional:** a small point-sprite starfield to validate the point-render
  path early (cheap; can defer if it complicates the slice).

### 5. CRT post pipeline

The web look is three layers (GPU post + CSS overlays + a DOM glitch
timeline). Native collapses them into a cleaner two-stage Metal pipeline.

**Bloom (separate chain, load-bearing):** threshold (≈0.05) → downsample →
gaussian blur (`MPSImageGaussianBlur` or a small mip chain) → additive
composite. Ported from `UnrealBloomPass(strength 1.4, radius 0.6, threshold
0.05)`. `strength` is a uniform (later slices modulate it for storm/day-night/
idle/perf). ACES filmic tonemap + exposure 1.15 applied to the scene **before**
post (match it or colors shift).

**Unified final fragment shader** over `sceneTexture` + `bloomTexture`,
driven by uniforms:

- **Chromatic aberration** (direct port): `dir = uv - 0.5`; sample R at
  `uv - dir*offset`, G at `uv`, B at `uv + dir*offset`; `offset` uniform
  baseline `0.0015`.
- **Scanlines:** darkening at a 4 px period (one ~1 px dark line, ~27.5% black,
  ~0.55 effective opacity), plus a `driftY` scroll uniform (0..4 px loop,
  ~0.6 px/frame ≈ 36 px/s) and the interlace toggle.
- **Vignette:** smoothstep radial falloff, inner radius ≈0.41
  (`(52 - strength*30)/100`), to 0.72 black at edges, global × strength (0.35).
- **Output modifiers** for the glitch layer: horizontal UV offset on a y-band
  (h-tear), global v-offset (v-roll), output multiply (brightness flicker),
  output × 0 (black-frame), affine UV warp (skew).

**`GlitchScheduler`** (Swift) — ports the web weighted scheduler: one artifact
per tick, interval `(3500 - 3000*i) ms + ~60% jitter`, `i = crtSim.intensity`
(default 0.35). It writes the chosen distortion into the shader uniforms each
frame. **Slice set (proves the mechanism):** h-tear, brightness flicker, chroma
spike, scanline pulse. The full 12-artifact set + the diegetic crash→reboot
loop-seam are a later slice (the crash is tied to scene-swap, which the slice
doesn't have yet).

**Per-preset CRT mapping** (so each preset looks right, from the web
`fxInheritFromTheme` math): `bloom.strength = max(0.4, glow*4)`,
`scan.opacity = max(0.02, scanlineOpacity*5)`,
`vignette.strength = max(0.15, vignette + 0.15)`.

### 6. Config & persistence

- **`ConfigureSheet`** (reuse the programmatic pattern): scene selector
  (terrain + "random" placeholder for now), color-preset picker (13), and a
  CRT-intensity slider. Writes to `ScreenSaverDefaults`.
- **`KuroDefaults`** — `ScreenSaverDefaults(forModuleWithName:
  "com.kuro.screensaver.native")`, keys `Scene`, `ColorPreset`, `CrtIntensity`.
  Drop the web-URL `.query()` builder.
- The web `HostPlugin` abstraction maps to a Swift `Config` struct + a
  `persist()` method; the `app.getActiveFile` dependency (cosmetic note-flash)
  is dropped.

### 7. Build & CI

- `package-macos-native.sh` (new): `xcodegen generate` → `xcodebuild` Release
  scheme `KuroNativeSaver` → `codesign --force --deep --sign -` → `--verify` →
  zip. No web bundling, no post-build `loop.mov` copy.
- `.github/workflows/release.yml`: add the native target to the `macos-latest`
  job alongside the `.app` and video `.saver` builds; attach the zip to the
  Codeberg release. (Native Metal builds on the runner — no GPU needed for
  *building*, unlike the video render.)

---

## The critical gate (first implementation step)

Before building terrain or the CRT chain, ship the **smallest possible Metal
`.saver`** — a `CAMetalLayer` clearing to a color and drawing one rotating
wireframe shape via `CVDisplayLink` — and **verify it composites on real
screensaver activation**, not just the System Settings preview. This is the #1
unknown that killed WebGL. If Metal does not composite here, the whole native
direction stops before further effort. (Expectation: native Metal composites
where WebGL did not — but this is the assumption under test.)

## CRT scope for this slice

- **Must:** bloom, ACES + exposure, scanlines + drift, vignette, chromatic
  aberration — the static CRT base.
- **Must:** the unified glitch fragment shader + the first artifact set
  (h-tear, brightness flicker, chroma spike, scanline pulse) — proves the
  uniform-drive mechanism.
- **Later (not this slice):** full 12-artifact scheduler, crash→reboot
  loop-seam, afterimage trails / burn-in (both default-off in the web engine).

## Out of scope (this slice)

- The other 4 scenes (city, rift, tunnel, void).
- Terminal narrative + personas + typing + script-bank (the "soul" — a large,
  high-value later slice).
- HUD / radar / boot BIOS / crosshair / kanji / scene-label / control bar.
- Audio synth (CRT hum/whine + Carpenter soundscape).
- Full glitch timeline + crash/reboot sequence; afterimage trails/burn-in.
- Live hotkeys, auto-cycle, day/night, weather, perf-adapt, idle-launch
  (the OS launches the saver), parallax.
- Code signing / notarization (stays ad-hoc, like the other targets).

## Risks / validate first

1. **Metal compositing in `legacyScreenSaver`** — the gate above. Test on real
   activation. (WebGL failed here; Metal is expected to work, but unproven.)
2. **Line-primitive rendering fidelity** — thin lines may look weak vs the
   bloom-amplified web look. Mitigation: tune line width / bloom; barycentric
   AA-wireframe is a fallback upgrade if needed.
3. **Bloom tuning** — bloom is the dominant cost and the look's glow. Get
   threshold/strength/radius right or the whole palette shifts.
4. **Seam continuity** — the two-chunk resample-on-wrap math is subtle;
   replicate the logical-offset trick exactly or seams reappear.
5. **ProMotion 120 Hz** — drive all motion from the clamped seconds-delta so
   speed matches across refresh rates (the web engine drifts here).

## Post-implementation review (2026-06-02)

An adversarial multi-dimension review (Metal lifecycle, host threading, web
fidelity, perf) ran after the slice was built; 12 confirmed findings were fixed
(see the `fix(native): address adversarial review findings` commit). Three were
**deliberately deferred** and remain open:

- **Frame pipelining** — the live path uses `cb.waitUntilCompleted()` (correct,
  and required by the headless harness for readback). Replacing it with a
  semaphore-bounded `cb.present(drawable)` pipeline would raise throughput toward
  120 Hz, but it also requires double-buffering the per-frame-mutated terrain
  position buffers (CPU/GPU aliasing on wrap). Both are forward-looking perf work
  that needs on-device timing to tune safely — out of scope for proving the
  slice. The synchronous path renders the (lightweight wireframe+bloom) scene
  smoothly at 60 Hz.
- **Per-scene `hashId` RNG offset** — the web seeds scenes as
  `mkRng(seed + hashId(id))`. The native LCG value stream is bit-for-bit
  identical and seeded directly; since the native uses a fresh seed per
  activation (no web-seed-sharing contract), the layout offset is never
  observable. Not a slice goal.
- **Render-pass-descriptor caching** — three are allocated per frame; idiomatic
  Metal and negligible against the frame budget.

## Success criteria (DoD)

An installable `.saver` that, on real screensaver activation:

- renders the terrain scene live in Metal with bloom + the full static CRT
  look + a few glitches,
- lets the user pick a color preset (and CRT intensity) in the options sheet,
- pauses/stops cleanly via `start/stopAnimation`,
- runs smoothly on ProMotion,
- coexists with the still-shipping video `.saver`.
