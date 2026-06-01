# Native Metal Screensaver (Vertical Slice) — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> Implements `docs/specs/2026-06-02-native-metal-saver-design.md`.

**Goal:** A native, live-rendered macOS `.saver` rendering the terrain scene in
Metal with the full CRT look (bloom + scanlines + vignette + chroma + a working
glitch layer), color-preset selectable.

**Architecture:** A platform-agnostic Swift+Metal renderer core (no AppKit/
ScreenSaver dependency) drives the scene + CRT post and renders into a supplied
`MTLTexture`. Two hosts consume it: (1) a **headless harness** that renders
frames offscreen to PNG (autonomous visual verification), and (2) the
**`ScreenSaverView`** `.saver` bundle (real activation). Metal shaders are
embedded MSL strings compiled **at runtime** (`device.makeLibrary(source:)`),
which sidesteps the missing `metal` build-time compiler on this dev box.

**Tech Stack:** Swift 6.3, Metal (runtime-compiled MSL), simd, CoreGraphics/
ImageIO (PNG), ScreenSaver.framework, xcodegen. Build via `swiftc` for the
harness/tests; the `.saver` via swiftc-bundle (no Xcode) and/or xcodegen+Xcode
(CI/release).

**Toolchain reality (dev box, 2026-06-02):** No Xcode (CommandLineTools only) →
no `xcodebuild`, no `metal` compiler. `swiftc` 6.3.2, `xcodegen` 2.45.4,
`ScreenSaver.framework`, and headless Metal (Apple M5 Pro) all verified working,
including runtime shader compilation + offscreen PNG readback (spike passed).

**What is NOT autonomously verifiable** (must hand to user): the **compositing
gate** — whether the native Metal layer composites in the real
`legacyScreenSaver` process (vs. only the System Settings preview). This is the
one thing requiring on-device eyes. Everything else (render correctness, look
fidelity, scene math, glitch behavior) is verified here via PNG snapshots.

---

## File structure

```
native/macos/KuroNativeSaver/
  Core/                         # platform-agnostic renderer (shared by both hosts)
    Mathx.swift                 # simd matrix helpers (perspective, lookAt, translate, rotate)
    LCG.swift                   # bit-for-bit port of mkRng/freshSeed
    Palette.swift               # 13 color presets + per-preset CRT mapping
    Settings.swift              # Config struct (scene, preset, speed, crtIntensity, …)
    Scene.swift                 # Scene protocol + SceneContext + GeometryBuffers
    Camera.swift                # perspective camera, FOV breakpoints, view/proj matrices
    TerrainScene.swift          # the slice scene (grid lines + stars + dust)
    Renderer.swift              # frame flow: scene pass → bloom → CRT composite
    BloomChain.swift            # threshold → downsample → gaussian blur → additive
    GlitchScheduler.swift       # weighted artifact timeline → CRT uniforms
    Shaders.swift               # all MSL source strings (scene, bloom, CRT)
  Host/                         # .saver-only (AppKit/ScreenSaver)
    KuroNativeSaverView.swift   # ScreenSaverView + CAMetalLayer + CVDisplayLink
    ConfigureSheet.swift        # options sheet (scene + preset + intensity)
    KuroDefaults.swift          # ScreenSaverDefaults persistence
    Info.plist
  harness/
    main.swift                  # headless: render N frames → PNG (+ PNG writer)
  tests/
    main.swift                  # assert-based logic tests (LCG, height, camera, scheduler)
native/macos/project.yml        # add KuroNativeSaver target
scripts/
  build-native-harness.sh       # swiftc Core + harness → run → PNG
  run-native-tests.sh           # swiftc Core + tests → run (exit!=0 on fail)
  build-native-saver.sh         # swiftc-bundle .saver (no Xcode) OR xcodebuild note
```

**Module boundaries:** `Core/` never imports AppKit or ScreenSaver — it only
knows Metal + simd + Foundation. The host injects the target `MTLTexture` and
calls `Renderer.render(into:, time:)` per frame. This lets the same renderer run
headless (offscreen texture) and in the `.saver` (drawable texture).

---

## Test strategy

- **Pure logic (TDD, assert-based):** `tests/main.swift` is a `swiftc`
  executable that runs asserts and exits non-zero on failure. Covers: LCG
  determinism (matches web sequence), terrain height formula (matches web
  `heightAt` at sample points), camera FOV breakpoints, seam-continuity
  invariant, GlitchScheduler interval/weighting.
- **Render output (visual snapshot):** `harness/main.swift` renders frames to
  `/tmp/kuro-native/*.png`; verified by reading the PNGs (image view). Each
  render-affecting task ends with "render PNG + eyeball it".
- No XCTest/SwiftPM (XCTest may be absent without Xcode); plain `swiftc`
  executables keep the loop robust.

---

## Task 0: Directory + harness skeleton + build scripts

**Files:** create `native/macos/KuroNativeSaver/{Core,Host,harness,tests}/`,
`scripts/build-native-harness.sh`, `scripts/run-native-tests.sh`.

- [ ] Create dir tree.
- [ ] `Core/Mathx.swift` with simd helpers: `perspective(fovyRadians:aspect:near:far:)`,
      `lookAt(eye:center:up:)`, `translation`, `rotationX/Y/Z`, returning
      `float4x4` (Metal NDC z ∈ [0,1], right-handed → left-handed handled).
- [ ] `harness/main.swift`: create device, an offscreen `rgba8Unorm` render
      target (default 1280×720, overridable via argv), a stub that clears to
      black + writes PNG (PNG writer via CoreGraphics/ImageIO, premultipliedLast).
      Accepts `--frames N --out DIR --w W --h H --preset KEY --scene terrain`.
- [ ] `scripts/build-native-harness.sh`: `swiftc Core/*.swift harness/main.swift
      -O -o /tmp/kuro-native/harness -framework Metal -framework Foundation
      -framework CoreGraphics -framework ImageIO -framework UniformTypeIdentifiers`
      then run with passed args.
- [ ] `scripts/run-native-tests.sh`: `swiftc Core/*.swift tests/main.swift -o
      /tmp/kuro-native/tests …` then run; propagate exit code.
- [ ] **Verify:** harness builds + writes a black PNG; read it (should be black).
- [ ] Commit: `chore(native): Metal renderer harness skeleton + build scripts`.

## Task 1: LCG (TDD)

**Files:** `Core/LCG.swift`, `tests/main.swift`.

- [ ] Test first: LCG seeded with a fixed seed produces the **same** first 5
      values as the web `mkRng` (compute expected values from
      `s=(Math.imul(s,1664525)+1013904223)|0; (s>>>0)/4294967296` — replicate in
      Swift with `Int32` wraparound: `s = s &* 1664525 &+ 1013904223`, value
      `Double(UInt32(bitPattern: s)) / 4294967296.0`). Assert equality to ~1e-12.
- [ ] Run tests → FAIL (no LCG).
- [ ] Implement `struct LCG { init(seed: Int32); mutating func next() -> Double }`
      and `func freshSeed() -> Int32` (`Int32(truncatingIfNeeded: now-ms) ^ …`;
      for headless determinism the harness passes a fixed seed).
- [ ] Run tests → PASS. Commit: `feat(native): seeded LCG ported bit-for-bit`.

## Task 2: terrain height formula + seam invariant (TDD)

**Files:** `Core/TerrainScene.swift` (height fn first), `tests/main.swift`.

- [ ] Test first: `terrainHeight(x,z)` equals
      `sin(x*0.33)*cos(z*0.2)*2.8 + sin(x*0.77+z*0.26)*0.95 +
      cos(x*0.16-z*0.13)*1.8` at sample points (compute 3 expected values).
- [ ] Test the seam invariant: with `D=180`, `logicalA=-40`, `logicalB=-220`,
      assert `abs(logicalB-logicalA)==D` and that after a wrap (both `-= 2D`) the
      invariant holds. Assert continuity: `terrainHeight(x, zEdge+logicalA) ==
      terrainHeight(x, zEdgeNeighbor+logicalB)` at the meeting edge.
- [ ] Run → FAIL. Implement `terrainHeight`. Run → PASS.
- [ ] Commit: `feat(native): terrain height field + seam-continuity math`.

## Task 3: Camera (TDD)

**Files:** `Core/Camera.swift`, `tests/main.swift`.

- [ ] Test first: `defaultFovDeg(w,h)` returns 62 for aspect≥1.6, 95 for
      aspect≤0.75, 72 otherwise (vertical FOV). Assert at (2560,1440)=62,
      (600,800)=95, (1280,1024≈1.25)=72.
- [ ] Run → FAIL. Implement `Camera` (position, eulerXYZ, fov, near=0.1,
      far=600). `viewMatrix` from position+rotation; `projectionMatrix(aspect)`
      via `Mathx.perspective`. `defaultFovDeg`.
- [ ] Run → PASS. Commit: `feat(native): perspective camera + FOV breakpoints`.

## Task 4: Palette + Settings

**Files:** `Core/Palette.swift`, `Core/Settings.swift`.

- [ ] `Palette`: 13 presets `(id,label,kanji,accentHex,glow,scanline,vignette)`
      exactly from `src/engine/data/presets.ts` (kuro #c4c0b4 .15/.01/0 …
      pearl #e8e4d8 .1/0/0 — full table in design spec §"darkAccent"). Helper
      `accentRGB() -> SIMD3<Float>` (hex→0..1), and CRT mapping:
      `bloomStrength=max(0.4,glow*4)`, `scanOpacity=max(0.02,scanline*5)`,
      `vignetteStrength=max(0.15,vignette+0.15)`.
- [ ] `Settings`: struct `{ scene:String="terrain"; preset:String="toxic-haze";
      speed:Speed=.norm; crtIntensity:Float=0.35; seed:Int32? }`, with
      `Speed` enum mapping `.slow=0.32,.norm=1,.fast=2.8`.
- [ ] No test (pure data); will be exercised by render. Commit:
      `feat(native): 13 color presets + settings model`.

## Task 5: Scene protocol + Metal context + scene render pass

**Files:** `Core/Scene.swift`, `Core/Shaders.swift` (scene shader), parts of
`Core/Renderer.swift`.

- [ ] `Scene` protocol: `mutating func build(_ ctx: SceneContext)`,
      `mutating func update(t: Double, dt: Double)`, and accessors the renderer
      uses to draw (line buffers, point buffers, camera). `SceneContext` carries
      `device`, `var rng: LCG`, `settings`, accent color.
- [ ] `Shaders.swift`: scene MSL — a vertex shader taking `position` + a
      `Uniforms` buffer (mvp, accent color, fog density, opacity, point flag),
      fragment shader applying **ACES filmic tonemap + exposure 1.15** and
      **FogExp2** (`exp(-(density*dist)^2)` toward black) to the accent color.
      One pipeline for `.line` primitives, one for `.point` (point size via
      `[[point_size]]`).
- [ ] `Renderer` scene pass: render into an offscreen `rgba16Float` HDR texture
      (so bloom threshold works on >1 values), black clear, depth optional
      (lines/points over fog — depth test off, additive-ish; match web which has
      no depth sorting issues because wireframe over black). Draw scene line
      buffer then point buffers.
- [ ] No standalone test; verified next task. Commit:
      `feat(native): scene render pass (lines/points, ACES, fog)`.

## Task 6: TerrainScene geometry + update → first visual

**Files:** `Core/TerrainScene.swift`, `harness/main.swift` (wire scene).

- [ ] Build geometry: two chunks, each a `WIDTH=280 × D=180` grid with
      `SEG_W=140 × SEG_L=130` segments in the XZ plane (y=height). Vertex grid
      laid out, **line index buffer** of horizontal+vertical edges
      (`MTLPrimitiveType.line`). Two chunks at z=-40 and z=-220; `logicalA=-40`,
      `logicalB=-220`. Sample heights via `terrainHeight(x, z+logical)`.
      Stars: 1000 points `((rng-0.5)*400, rng*70+5, -(rng*400+10))` size 0.13.
      Dust: 500 points `((rng-0.5)*60, rng*18+1, -(rng*200+5))` size 0.06.
      Accent-tinted, terrain opacity 0.8/0.75.
- [ ] `update(t,dt)`: scroll `z += speedPerSec*dt` where
      `speedPerSec = SPEED_VALUES[speed]*0.2*60` (web steps 0.2/frame@60 →
      12 u/s at norm); on `z > D/2+12` wrap `z -= 2D`, `logical -= 2D`, re-sample
      that chunk's heights into its buffer. Camera: `pos.y = 6 + sin(t*0.33)*0.9`,
      `rot.x=-0.22`, `rot.z = sin(t*0.17)*0.009`, `pos=(0,·,0)`. Dust
      `x = sin(t*0.07)*4`.
- [ ] **Verify visually:** harness renders frame at t≈8s (so terrain has
      scrolled) → PNG. Eyeball: wireframe grid landscape receding to horizon,
      starfield above, accent-colored, black bg. Iterate constants until it
      reads like the web terrain (compare against the web look).
- [ ] Commit: `feat(native): terrain scene — grid lines, stars, dust, scroll`.

## Task 7: Bloom chain → visual

**Files:** `Core/BloomChain.swift`, `Core/Shaders.swift` (bloom MSL), wire into
`Renderer`.

- [ ] Bloom: threshold pass (keep luma > 0.05, soft knee) on the HDR scene tex →
      downsample to ~half/quarter → gaussian blur (separable H+V, or
      `MPSImageGaussianBlur`) → result `bloomTex`. Strength from
      `Palette.bloomStrength` (default toxic-haze glow .3 → 1.2; design baseline
      1.4). Radius ~0.6 → blur sigma scaled to resolution.
- [ ] **Verify visually:** render PNG → grid lines + stars now glow (neon).
      Tune threshold/strength/sigma so glow matches the web's bloom-dominant
      look without washing out. Iterate.
- [ ] Commit: `feat(native): bloom chain (threshold→blur→additive)`.

## Task 8: CRT composite shader (scanlines, vignette, chroma) → visual

**Files:** `Core/Shaders.swift` (CRT MSL), `Renderer` composite pass.

- [ ] Final fullscreen fragment shader over `sceneTex + bloomTex` (additive),
      with uniforms: `chromaOffset`(0.0015), `scanOpacity`, `scanDriftY`,
      `vignetteInner`(≈0.41), `vignetteStrength`, plus glitch uniforms (Task 9).
      - Chroma: `dir=uv-0.5; r=sample(uv-dir*off).r; g=sample(uv).g;
        b=sample(uv+dir*off).b`.
      - Scanlines: 4px period dark line (~0.275), ×scanOpacity (≈0.55 eff.),
        scrolled by `scanDriftY` (0..4 px, +0.6 px/frame).
      - Vignette: smoothstep radial, inner 0.41 → 0.72 black, ×0.35.
- [ ] `scanDriftY` advanced per frame in `Renderer`.
- [ ] **Verify visually:** render 2–3 PNGs → scanlines + vignette + subtle
      chroma fringe at edges, drift visible across frames. Iterate to taste.
- [ ] Commit: `feat(native): CRT composite — scanlines, vignette, chroma`.

## Task 9: GlitchScheduler (first artifact set) → visual

**Files:** `Core/GlitchScheduler.swift`, CRT shader glitch branches, `Renderer`.

- [ ] `GlitchScheduler`: per-tick `nextAt = now + (3500 - 3000*i)ms + rand*0.6*interval`,
      `i=crtIntensity`. On fire, pick ONE weighted artifact from the slice set:
      **h-tear** (w28: horizontal uv offset on a y-band, 40–120ms),
      **brightness flicker** (w20: output multiply, 60–150ms),
      **chroma spike** (w12: chromaOffset bump to 0.003–0.009, 80–200ms),
      **scanline pulse** (w14: scanOpacity ×1.4–2.6, 140–360ms). Each sets a
      timed uniform the shader reads; auto-revert after its duration.
- [ ] Shader branches honor: `hTearAmount/hTearBandY`, `brightness`,
      (chroma already a uniform), `scanPulse`.
- [ ] **Verify visually:** render a 90-frame sequence (3s) with `i=1` (force
      frequent glitches) → scan PNGs for an h-tear and a flicker frame. Confirm
      one-artifact-at-a-time behavior.
- [ ] Commit: `feat(native): glitch scheduler (h-tear/flicker/chroma/pulse)`.

## Task 10: Renderer time/delta + preset wiring + harness CLI polish

**Files:** `Core/Renderer.swift`, `harness/main.swift`.

- [ ] Renderer owns clamped seconds-delta (`min(0.05, now-last)`), accumulates
      `t`, drives `scene.update`, glitch scheduler, scanDrift. `render(into
      target: MTLTexture, dtOverride: Double?)` (harness passes fixed dt for
      determinism; .saver passes real dt).
- [ ] Harness: `--preset`, `--scene`, `--seconds S --fps F` (render a sequence),
      `--out DIR`. Resolve preset → accent + CRT params.
- [ ] **Verify visually:** render the same frame across 3 presets
      (phosphor/crimson/toxic-haze) → confirm accent + CRT params change. Read all 3.
- [ ] Commit: `feat(native): renderer delta/time + preset-driven harness`.

## Task 11: .saver host (ScreenSaverView + CAMetalLayer + CVDisplayLink)

**Files:** `Host/KuroNativeSaverView.swift`, `Host/Info.plist`.

- [ ] `@objc(KuroNativeSaverView) final class KuroNativeSaverView:
      ScreenSaverView`: `init(frame:isPreview:)` builds a `CAMetalLayer`
      (device, `rgba16Float`? no — drawable is bgra8; render scene to HDR
      offscreen, composite into the bgra8 drawable), sets `wantsLayer`,
      `animationTimeInterval`. `startAnimation`/`stopAnimation` start/stop a
      `CVDisplayLink` that calls `renderer.render(into: drawable.texture)` then
      presents. `draw(_:)` black fill fallback. `hasConfigureSheet=true`,
      `configureSheet` → ConfigureSheet. Reads `KuroDefaults` for settings.
- [ ] `Info.plist`: `NSPrincipalClass=KuroNativeSaverView`, `CFBundlePackageType
      BNDL`, name/id.
- [ ] **Verify (build only, no Xcode):** compile `Core/*.swift Host/
      KuroNativeSaverView.swift` with `swiftc -emit-library -bundle` against
      ScreenSaver/Metal/QuartzCore/AppKit → confirm it links (catches API
      misuse). Cannot run the screensaver here.
- [ ] Commit: `feat(native): ScreenSaverView host (CAMetalLayer + CVDisplayLink)`.

## Task 12: ConfigureSheet + Defaults

**Files:** `Host/ConfigureSheet.swift`, `Host/KuroDefaults.swift`.

- [ ] `KuroDefaults`: `ScreenSaverDefaults(forModuleWithName:
      "com.kuro.screensaver.native")`, keys `Scene`,`ColorPreset`,`CrtIntensity`;
      register defaults; load into `Settings`.
- [ ] `ConfigureSheet`: programmatic NSWindow (like the existing one) — scene
      popup (terrain + random), preset popup (13 labels), intensity slider
      (0..1), OK/Cancel persisting to `KuroDefaults`.
- [ ] **Verify:** include in the swiftc-bundle link from Task 11.
- [ ] Commit: `feat(native): configure sheet + ScreenSaverDefaults`.

## Task 13: Build the .saver bundle (no-Xcode path) + xcodegen target

**Files:** `scripts/build-native-saver.sh`, `native/macos/project.yml`.

- [ ] `build-native-saver.sh`: assemble `KuroNativeSaver.saver/Contents/`
      manually — `swiftc -emit-library -bundle -o
      Contents/MacOS/KuroNativeSaver Core/*.swift Host/*.swift -framework …`,
      write `Contents/Info.plist`, `codesign --force --deep --sign -`,
      `--verify --deep --strict`, zip. (No Xcode needed — runtime-compiled
      shaders mean no `.metallib`.)
- [ ] Add `KuroNativeSaver` target to `project.yml` (for CI/Xcode path):
      type bundle, `WRAPPER_EXTENSION saver`, id `com.kuro.screensaver.native`,
      sources `KuroNativeSaver/{Core,Host}`, frameworks ScreenSaver+Metal+
      MetalKit+QuartzCore+Cocoa, `NSPrincipalClass`, ad-hoc sign. Run
      `xcodegen generate` to confirm the manifest parses.
- [ ] **Verify:** the swiftc-bundle produces a `KuroNativeSaver.saver` that
      passes `codesign --verify`; the bundle's `Info.plist` has the right
      principal class. (Whether macOS loads/composites it = the user's
      on-device gate.)
- [ ] Commit: `build(native): package .saver (swiftc-bundle) + xcodegen target`.

## Task 14: CI + docs + handoff

**Files:** `.github/workflows/release.yml`, `docs/specs/2026-06-02-native-metal-saver-design.md` (status update), `README` note (optional).

- [ ] Add the native target build to the `macos-latest` release job (xcodegen +
      xcodebuild scheme `KuroNativeSaver` + sign + zip + attach to Codeberg
      release). Keep video `.saver` + `.app` jobs.
- [ ] Update design spec status → "Implemented (slice); compositing gate pending
      on-device verification".
- [ ] **Hand off to user:** install `KuroNativeSaver.saver`, activate the real
      screensaver (idle or `System Settings`), confirm it renders live (not
      gray) → this closes the compositing gate. Provide the PNG snapshots as the
      render-correctness evidence.
- [ ] Commit: `build(native): release CI + docs for native .saver`.

---

## Self-review notes

- **Spec coverage:** bundle/target (T11–13), module structure (T0,5,10),
  render loop/delta (T10), terrain incl. height/seam/scroll/camera (T2,6), CRT
  bloom+scanlines+vignette+chroma (T7,8), glitch first-set (T9), per-preset CRT
  mapping (T4), config/persistence (T12), build+CI (T13,14), compositing gate
  (T0 spike done; T14 handoff). All design §sections mapped.
- **Out-of-scope respected:** no other scenes, no terminal/HUD/audio, no full
  glitch/crash, no trails/burn — none appear as tasks.
- **Naming consistency:** `terrainHeight`, `defaultFovDeg`, `Palette.bloomStrength/
  scanOpacity/vignetteStrength`, `Renderer.render(into:dtOverride:)`,
  `Settings.Speed` used consistently across tasks.
- **Compositing caveat is explicit** and not silently assumed.
```
