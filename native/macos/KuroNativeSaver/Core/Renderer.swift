// Renderer — drives the frame: scene pass (lines/points → HDR) then a composite
// pass (tonemap → target). Bloom + the CRT composite shader are layered in later
// tasks. Platform-agnostic: the host injects the target MTLTexture each frame.

import Metal
import simd
import Foundation

final class Renderer {
    let device: MTLDevice
    let queue: MTLCommandQueue
    let settings: Settings
    let preset: ColorPreset
    private var scene: Scene
    private var sceneIndex = 0
    private var sceneAge: Double = 0
    private var crash = CrashFx()
    var autoCycleSec: Double = 0   // 0 = off (host enables; harness leaves off)

    private let scenePipe: MTLRenderPipelineState
    private let compositePipe: MTLRenderPipelineState
    private let depthState: MTLDepthStencilState
    private let bloom: BloomChain
    private let trails: TrailsChain
    private let glitch: GlitchScheduler
    private let atlas: FontAtlas
    private let text: TextRenderer
    private let textFlat: TextRenderer   // target-format pipeline for the flat post-composite HUD pass
    let hud = Hud()
    private var fps: Double = 60

    private var sceneHDR: MTLTexture?
    private var depthTex: MTLTexture?
    private(set) var width = 0
    private(set) var height = 0

    private(set) var t: Double = 0
    private var scanDriftY: Float = 0

    // Adaptive quality: on a GPU that can't hold the frame budget, progressively
    // drop the heaviest effects (matrix → trails → bloom). Stays at 0 on capable
    // hardware (e.g. the dev M5 Pro renders 5K all-on in ~7ms → never trips).
    private var gpuMsSmoothed: Double = 0
    private(set) var qualityTier = 0   // 0 full · 1 no matrix · 2 +no trails · 3 +no bloom

    static let hdrFormat: MTLPixelFormat = .rgba16Float

    init(device: MTLDevice, settings: Settings, scene: Scene,
         targetFormat: MTLPixelFormat) {
        self.device = device
        self.settings = settings
        self.preset = settings.preset
        self.scene = scene
        self.sceneIndex = SceneRegistry.ids.firstIndex(of: settings.scene) ?? 0
        self.queue = device.makeCommandQueue()!
        let bus = EventBus()
        self.bus = bus
        self.director = FlightDirector(seed: settings.seed ?? freshSeed(), bus: bus)
        self.film = FilmDirector(seed: settings.seed ?? freshSeed())

        let lib: MTLLibrary
        do { lib = try device.makeLibrary(source: Shaders.source, options: nil) }
        catch { fatalError("shader compile failed: \(error)") }

        let sp = MTLRenderPipelineDescriptor()
        sp.vertexFunction = lib.makeFunction(name: "scene_v")
        sp.fragmentFunction = lib.makeFunction(name: "scene_f")
        sp.colorAttachments[0].pixelFormat = Renderer.hdrFormat
        sp.depthAttachmentPixelFormat = .depth32Float
        scenePipe = try! device.makeRenderPipelineState(descriptor: sp)

        let cp = MTLRenderPipelineDescriptor()
        cp.vertexFunction = lib.makeFunction(name: "fsq_v")
        cp.fragmentFunction = lib.makeFunction(name: "composite_f")
        cp.colorAttachments[0].pixelFormat = targetFormat
        compositePipe = try! device.makeRenderPipelineState(descriptor: cp)

        let ds = MTLDepthStencilDescriptor()
        ds.depthCompareFunction = .less
        ds.isDepthWriteEnabled = true
        depthState = device.makeDepthStencilState(descriptor: ds)!

        bloom = BloomChain(device: device, library: lib, sigma: 3)   // quarter-res → sigma 3 ≈ half-res 6
        trails = TrailsChain(device: device, library: lib)
        glitch = GlitchScheduler(intensity: settings.crtIntensity,
                                 seed: (settings.seed ?? freshSeed()) &+ 777)
        atlas = FontAtlas(device: device)
        text = TextRenderer(device: device, library: lib, atlas: atlas, format: Renderer.hdrFormat)
        textFlat = TextRenderer(device: device, library: lib, atlas: atlas, format: targetFormat)
        // Combat director (built last: its host closures capture self).
        self.combat = CombatDirector(seed: settings.seed ?? freshSeed(), bus: bus, host: ActorHost(
            device: device,
            add: { [weak self] a in self?.actors.append(a) },
            accentRGB: { [weak self] in self?.preset.accentRGB ?? SIMD3<Float>(0, 1, 0) },
            enemyRGB: { [weak self] in
                guard let s = self else { return SIMD3<Float>(1, 0, 0.25) }
                return s.enemyAccent(s.preset.accentRGB)
            }))
        chatter = ChatterDirector(seed: settings.seed ?? freshSeed())   // Brick E radio chatter
        crash.powerOn()   // diegetic CRT power-on (image expands out of a line + flickers)
    }

    /// Debug: render a black scene (skip geometry) to verify text/overlays alone.
    var debugBlackScene = false
    /// Debug: hold one glitch artifact active (single-frame verification).
    func debugForceGlitch(_ name: String) { glitch.forceHold(name) }
    /// Debug: freeze a crash-collapse amount for single-frame verification.
    func debugForceCrash(_ amount: Float) { crash.debugSet(collapse: amount) }

    private func swapSceneTo(_ id: String) {
        if let idx = SceneRegistry.ids.firstIndex(of: id) { sceneIndex = idx }
        var ctx = SceneContext(device: device, rng: LCG(seed: freshSeed()),
                               settings: settings, accent: preset.accentRGB)
        ctx.directorSpeed = { [weak self] in self?.director.speed() ?? 1 }
        scene = SceneRegistry.make(SceneRegistry.ids[sceneIndex], ctx: ctx)
    }

    /// native film-mode gate (no autoCycle.on setting; autoCycleSec>0 means "film on").
    private var filmMode: Bool { autoCycleSec > 0 }

    /// Phase began: warp to the film's scene for this phase (film mode only).
    private func onFilmPhase(_ phase: ShiftPhase) {
        guard filmMode else { return }
        if currentFilmScene == nil {                       // first phase: adopt the opened scene
            currentFilmScene = SceneRegistry.ids[sceneIndex]
            phaseCounter += 1
            return
        }
        let next = film.sceneAt(phaseCounter, phase: phase, prev: currentFilmScene)
        if next != SceneRegistry.ids[sceneIndex] {
            beginTransition(TransitionProfiles.profileFor(from: SceneRegistry.ids[sceneIndex], to: next)) { [weak self] in
                guard let s = self else { return }
                s.pulse(.warp); s.swapSceneTo(next)
                if let line = Script.arrivalLine(next, s.phaseCounter) { s.hud.terminal.pushLine(line, .hq) }
            }
        }
        currentFilmScene = next
        phaseCounter += 1
    }

    /// Foreshadow line for the upcoming phase's scene (matches the arrival query).
    private func foreshadowFor(_ nextPhase: ShiftPhase) -> String? {
        guard filmMode else { return nil }
        let sc = film.sceneAt(phaseCounter, phase: nextPhase, prev: currentFilmScene)
        return Script.foreshadowLine(sc, phaseCounter)
    }

    /// React to a combat event: camera flinch + bloom flash + a terminal line.
    private func onCombat(_ kind: FlightEventKind) {
        if kind == .incomingFire {
            director.enqueue(Manoeuvre(kind: .kick, dur: 0.6, dir: 0, intensity: 0.5))
            pulse(.flash)
        } else if kind == .unitCrash {
            pulse(.flash)
        }
        // Brick E: multi-speaker radio chatter replaces the single-speaker combat line.
        let key = kind == .incomingFire ? "incomingFire" : (kind == .unitArrive ? "unitArrive" : "unitCrash")
        chatter.fire(key, t: t)
    }

    private func phaseKey(_ p: ShiftPhase) -> String {
        switch p {
        case .routine: return "ROUTINE"; case .intrusion: return "INTRUSION"
        case .alarm: return "ALARM"; case .panic: return "PANIC"; case .silence: return "SILENCE"
        }
    }

    private func ensureTextures(_ w: Int, _ h: Int) {
        guard w != width || h != height || sceneHDR == nil else { return }
        width = w; height = h
        let cd = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: Renderer.hdrFormat, width: w, height: h, mipmapped: false)
        cd.usage = [.renderTarget, .shaderRead]
        cd.storageMode = .private
        sceneHDR = device.makeTexture(descriptor: cd)
        let dd = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .depth32Float, width: w, height: h, mipmapped: false)
        dd.usage = [.renderTarget]
        dd.storageMode = .private
        depthTex = device.makeTexture(descriptor: dd)
    }

    /// Advance simulation by `dt` seconds without drawing.
    // ── Reactive world: the 3D world reacts to the narrative shift phase ─────
    // (mirrors src/engine/fx/reactive-world.ts). A continuous threat (0..1) from the
    // terminal phase + progress drives fog/bloom/CRT escalation; released by the crash.
    private var threat: Float = 0
    private var relaxing = false
    private var lastPhase: ShiftPhase = .routine
    var forcedThreat: Float? = nil          // harness --threat pins the value
    private var stormScalar: Float { Renderer.smoothstep(0.70, 1.0, threat) }
    private var hesWired = false
    let bus: EventBus
    private let director: FlightDirector
    private let film: FilmDirector
    private var phaseCounter = 0
    private var currentFilmScene: String? = nil
    private var filmWired = false
    var actors: [Actor] = []
    private var combat: CombatDirector!
    private var combatWired = false
    private var chatter = ChatterDirector(seed: 0)   // re-seeded in init
    enum PulseKind { case flash, surge, warp }
    // One-shot additive envelopes layered on the threat-derived mults (NOT threat).
    private var envelopes: [(t0: Double, dur: Double, bloom: Float, fog: Float)] = []
    private var envBloomAdd: Float = 0
    private var envFogAdd: Float = 0

    /// Start a lateral camera-hesitation envelope (the operator "noticing something").
    func pulseHesitation(_ dur: Double = 2.2) {
        guard settings.reactiveWorld else { return }
        director.enqueue(Manoeuvre(kind: .kick, dur: max(0.3, dur), dir: 0, intensity: 0.55))
    }

    /// Fire a one-shot world envelope (additive bump on bloom/fog mults). reactiveWorld-gated.
    /// 'warp' is the scene-transition punch (strong bloom + brief fog clear).
    func pulse(_ kind: PulseKind) {
        guard settings.reactiveWorld else { return }
        switch kind {
        case .flash: envelopes.append((t0: t, dur: 0.6, bloom: 0.6, fog: 0))
        case .surge: envelopes.append((t0: t, dur: 1.2, bloom: 0.3, fog: -0.1))
        case .warp:  envelopes.append((t0: t, dur: 1.4, bloom: 0.9, fog: -0.2))
        }
    }

    /// Start a warp transition; the director swaps the scene at the peak via onSwap.
    func beginTransition(_ profile: TransitionProfile, onSwap: @escaping () -> Void) {
        director.beginTransition(profile, baseFov: scene.camera.fovDegrees, onSwap: onSwap)
    }

    private func advanceEnvelopes() {
        var bAdd: Float = 0, fAdd: Float = 0
        envelopes.removeAll { ev in
            let p = (t - ev.t0) / ev.dur
            if p >= 1 { return true }
            let s = sin(Double.pi * p); let env = Float(s * s)
            bAdd += ev.bloom * env; fAdd += ev.fog * env
            return false
        }
        envBloomAdd = bAdd; envFogAdd = fAdd
    }

    private static func smoothstep(_ e0: Float, _ e1: Float, _ x: Float) -> Float {
        let t = min(1, max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
    }
    /// Accent's HSL hue +160° → a vivid contrasting "enemy" colour (mirrors web enemyHexOf).
    private func enemyAccent(_ rgb: SIMD3<Float>) -> SIMD3<Float> {
        let r = rgb.x, g = rgb.y, b = rgb.z
        let mx = max(r, max(g, b)), mn = min(r, min(g, b)), d = mx - mn
        var h: Float = 0
        if d > 1e-5 {
            if mx == r { h = (g - b) / d + (g < b ? 6 : 0) }
            else if mx == g { h = (b - r) / d + 2 }
            else { h = (r - g) / d + 4 }
            h /= 6
        }
        let l = min(0.6, max(0.45, (mx + mn) / 2)), s: Float = 0.85
        h = (h + 160.0 / 360.0).truncatingRemainder(dividingBy: 1)
        let c = (1 - abs(2 * l - 1)) * s
        let hh = h * 6
        let x = c * (1 - abs(hh.truncatingRemainder(dividingBy: 2) - 1))
        var o = SIMD3<Float>(0, 0, 0)
        if hh < 1 { o = SIMD3(c, x, 0) } else if hh < 2 { o = SIMD3(x, c, 0) }
        else if hh < 3 { o = SIMD3(0, c, x) } else if hh < 4 { o = SIMD3(0, x, c) }
        else if hh < 5 { o = SIMD3(x, 0, c) } else { o = SIMD3(c, 0, x) }
        return o + SIMD3(repeating: l - c / 2)
    }

    private func updateThreat(dt: Double) {
        guard settings.reactiveWorld else { threat = 0; return }
        if let f = forcedThreat { threat = min(1, max(0, f)); return }
        let phase = hud.terminal.currentPhase
        if phase == .routine && lastPhase != .routine { relaxing = true }
        if phase != .routine { relaxing = false }
        lastPhase = phase
        let band: (Float, Float)
        switch phase {
        case .routine:   band = (0.00, 0.12)
        case .intrusion: band = (0.12, 0.38)
        case .alarm:     band = (0.38, 0.70)
        case .panic:     band = (0.70, 1.00)
        case .silence:   band = (1.00, 1.00)
        }
        let p = Float(hud.terminal.phaseProgress(t))
        let target = band.0 + (band.1 - band.0) * Renderer.smoothstep(0, 1, p)
        let tau: Float = relaxing ? 0.4 : 2.5
        let k = 1 - exp(-Float(min(0.1, dt)) / tau)
        threat += (target - threat) * k
        if relaxing && threat < 0.02 { relaxing = false }
    }

    func advance(dt: Double) {
        t += dt
        // Set the aspect-aware base FOV before update so scenes (tunnel) can
        // adjust it (boost). Uses the last drawn size; 72° on the very first tick.
        scene.camera.fovDegrees = Camera.defaultFovDeg(width: width, height: height)
        if !hesWired {
            hud.terminal.onIntrusion = { [weak self] in
                guard let self, self.settings.reactiveWorld else { return }
                self.bus.emit(FlightEvent(kind: .intrusion, intensity: 2.2))
            }
            hesWired = true
        }
        if !filmWired {
            hud.terminal.onPhaseEnter = { [weak self] p in
                guard let s = self else { return }
                s.chatter.fire("phase:\(s.phaseKey(p))", t: s.t)   // Brick E phase chatter
                s.onFilmPhase(p)
            }
            hud.terminal.sceneForeshadow = { [weak self] np in self?.foreshadowFor(np) }
            filmWired = true
        }
        if !combatWired {
            bus.subscribe(.incomingFire) { [weak self] _ in self?.onCombat(.incomingFire) }
            bus.subscribe(.unitArrive) { [weak self] _ in self?.onCombat(.unitArrive) }
            bus.subscribe(.unitCrash) { [weak self] _ in self?.onCombat(.unitCrash) }
            combatWired = true
        }
        let st = settings.reactiveWorld ? stormScalar : 0
        (scene as? TerrainScene)?.storm = st
        (scene as? VoidScene)?.storm = st
        (scene as? VoidScene)?.threatLevel = threat   // Brick D-next: debris-dodge trigger
        scene.update(t: t, dt: dt)
        // Director: advance its clock, then overlay manoeuvres on the pose the scene
        // wrote. The 'kick' manoeuvre reproduces the old hesitation brake exactly
        // (scenes re-set camera.position each frame, so this dampens without compounding).
        director.update(t: t, dt: dt)
        var cam = scene.camera
        if director.inTransition { _ = director.applyTransition(&cam) }
        else if !scene.cameraLocked { director.apply(&cam) }   // skip kick in path-locked corridors
        scene.camera = cam
        glitch.update(t: t)
        if dt > 0 { fps = fps * 0.9 + (1.0 / dt) * 0.1 }
        hud.setFps(fps)
        hud.terminal.update(t: t)
        chatter.update(t: t, terminal: hud.terminal)   // Brick E: flush due chatter lines
        updateThreat(dt: dt)
        advanceEnvelopes()
        combat.update(t: t, threat: threat)
        actors.removeAll { !$0.update(t: t, dt: dt, cam: scene.camera, threat: threat) }
        glitch.intensity = settings.reactiveWorld
            ? min(1, settings.crtIntensity + threat * 0.7) : settings.crtIntensity
        scanDriftY = (scanDriftY + 36 * Float(dt)).truncatingRemainder(dividingBy: 4)

        // Scene changes are phase-driven (Brick C: onFilmPhase warps at each phase
        // boundary in film mode). crash.update stays for the boot power-on only.
        _ = crash.update(dt: dt)
    }

    /// Draw the current state into `target`.
    func draw(into target: MTLTexture) {
        ensureTextures(target.width, target.height)
        guard let sceneHDR, let depthTex else { return }
        let cb = queue.makeCommandBuffer()!

        // --- scene pass → HDR ---
        let sp = MTLRenderPassDescriptor()
        sp.colorAttachments[0].texture = sceneHDR
        sp.colorAttachments[0].loadAction = .clear
        sp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        sp.colorAttachments[0].storeAction = .store
        sp.depthAttachment.texture = depthTex
        sp.depthAttachment.loadAction = .clear
        sp.depthAttachment.clearDepth = 1.0
        sp.depthAttachment.storeAction = .dontCare
        let enc = cb.makeRenderCommandEncoder(descriptor: sp)!
        enc.setRenderPipelineState(scenePipe)
        enc.setDepthStencilState(depthState)

        let aspect = Float(width) / Float(height)
        let cam = scene.camera   // FOV already set in advance() (so scenes can adjust it)
        let view = cam.view()
        let viewProj = cam.projection(aspect: aspect) * view
        // three.js PointsMaterial sizeAttenuation: gl_PointSize = size * height/2 / -z
        // (no FOV term) — match it so ported star/dust sizes look right.
        let pointScale = Float(height) * 0.5
        let accent = preset.accentRGB

        // atmosphere: day/night cycle + weather modulate bloom / fog / exposure
        let tf = Float(t)
        var bloomMul = settings.bloomScale
        var fogMul = settings.fog.mul
        // Exposure lowered 2026-06-03 (~1.92 → 1.4): the old value pushed bright/
        // saturated presets deep into the ACES highlight shoulder → wash to white.
        // 1.4 keeps colours in the more-saturated midtones, closer to the web look.
        var expo: Float = 1.4
        if settings.dayNight {
            let dn = 0.5 + 0.5 * sin(tf / 240 * 2 * .pi)   // 0 night .. 1 day (4-min cycle)
            expo *= 0.7 + 0.6 * dn; bloomMul *= 0.8 + 0.5 * dn; fogMul *= 1 + 0.5 * (1 - dn)
        }
        switch settings.weather {
        case .storm:
            let surge = max(0, sin(tf * 3)) * max(0, sin(tf * 0.7))
            bloomMul *= 1.3 + surge * 1.4; fogMul *= 1.7   // visible storm even at low threat
        case .dust: fogMul *= 2.4; bloomMul *= 0.8
        case .clear: break
        }
        // Reactive world: the shift's threat closes the fog in + surges the bloom
        // (CRT halation/ntsc + glitch handled in advance + p6 below).
        fogMul *= 1 + threat * 1.6 + envFogAdd
        bloomMul *= 1 + stormScalar * 0.4 + envBloomAdd
        // Enemy-colour infection: infectable items crossfade accent→enemy with threat.
        let enemyFraction = settings.reactiveWorld ? Renderer.smoothstep(0.25, 0.9, threat) : 0
        let enemyCol = enemyAccent(accent)

        for item in (debugBlackScene ? [] : scene.items + actors.flatMap { $0.items }) {
            let col = item.colorOverride ?? (item.infectable ? accent + (enemyCol - accent) * enemyFraction : accent)
            var u = SceneUniforms(
                mvp: viewProj * item.model,
                modelView: view * item.model,
                color: SIMD4(col, item.opacity),
                params: SIMD4(scene.fogDensity * fogMul, item.pointSizeWorld, pointScale,
                              item.isPoint ? 1 : 0))
            enc.setVertexBuffer(item.positions, offset: 0, index: 0)
            enc.setVertexBytes(&u, length: MemoryLayout<SceneUniforms>.stride, index: 1)
            if let idx = item.indices {
                enc.drawIndexedPrimitives(type: item.primitive, indexCount: item.count,
                                          indexType: .uint32, indexBuffer: idx,
                                          indexBufferOffset: 0)
            } else {
                enc.drawPrimitives(type: item.primitive, vertexStart: 0,
                                   vertexCount: item.count)
            }
        }
        enc.endEncoding()

        // --- HUD + terminal text into the HDR scene (so CRT post treats it) ---
        let txtPass = MTLRenderPassDescriptor()
        txtPass.colorAttachments[0].texture = sceneHDR
        txtPass.colorAttachments[0].loadAction = .load
        txtPass.colorAttachments[0].storeAction = .store
        let tenc = cb.makeRenderCommandEncoder(descriptor: txtPass)!
        let wantMatrix = (SceneRegistry.ids[sceneIndex] == "matrix") && qualityTier < 1   // static 2D rain — matrix scene only
        let wantOverlay = settings.showHud || settings.terminalLayout != .off
        let overlayInMonitor = wantOverlay && !settings.flatHud   // curved into the scene (vs flat post-composite)
        if wantMatrix || overlayInMonitor {
            text.begin(width: width, height: height)
            if wantMatrix { hud.renderMatrix(text, width: width, height: height, accent: preset.accentRGB, t: t, opacity: 0.7) }
            if overlayInMonitor {
                hud.renderOverlay(text, width: width, height: height, accent: preset.accentRGB,
                                  kanji: preset.kanji, t: t, scene: SceneRegistry.ids[sceneIndex],
                                  terminalScale: settings.terminalScale,
                                  terminalLayout: settings.terminalLayout, terminalBand: settings.terminalBandHeight,
                                  showPanels: settings.showHud)
            }
            text.flush(tenc)
        }
        tenc.endEncoding()

        // --- phosphor trails (feedback of the lit scene) ---
        trails.decay = settings.trails
        let litTex = (settings.trails > 0.001 && qualityTier < 2) ? trails.generate(cb, sceneHDR: sceneHDR, queue: queue) : sceneHDR

        // --- bloom (threshold + blur) ---
        let bloomTex = (bloomMul > 0.001 && qualityTier < 3) ? bloom.generate(cb, sceneHDR: litTex) : litTex

        // --- composite pass → target ---
        let tp = MTLRenderPassDescriptor()
        tp.colorAttachments[0].texture = target
        tp.colorAttachments[0].loadAction = .clear
        tp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        tp.colorAttachments[0].storeAction = .store
        let enc2 = cb.makeRenderCommandEncoder(descriptor: tp)!
        enc2.setRenderPipelineState(compositePipe)
        enc2.setFragmentTexture(litTex, index: 0)
        enc2.setFragmentTexture(bloomTex, index: 1)
        let vignetteInner = 0.52 - 0.30 * preset.vignetteStrength
        var pu = PostUniforms(
            p0: SIMD4(expo, preset.bloomStrength * bloomMul,
                      0.0015 + glitch.chromaOffsetBump, preset.scanOpacity),
            p1: SIMD4(scanDriftY, vignetteInner, preset.vignetteStrength, Float(t)),
            p2: glitch.uniforms(),
            p3: glitch.uniforms3(),
            p4: SIMD4(crash.uniforms().x, crash.uniforms().y, settings.curvature, 1.0),
            p5: SIMD4(settings.apertureMask, 6, 0.02, 0.012),
            p6: SIMD4(settings.ntsc + threat * 0.45, settings.halation + threat * 0.35, 0, 0))
        enc2.setFragmentBytes(&pu, length: MemoryLayout<PostUniforms>.stride, index: 0)
        enc2.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc2.endEncoding()

        // --- flat HUD/terminal overlay: drawn onto the final composite, AFTER the
        // CRT curvature, so it stays crisp + uncurved (like the web's DOM overlay). ---
        if settings.flatHud, settings.showHud || settings.terminalLayout != .off {
            let flatPass = MTLRenderPassDescriptor()
            flatPass.colorAttachments[0].texture = target
            flatPass.colorAttachments[0].loadAction = .load
            flatPass.colorAttachments[0].storeAction = .store
            let fenc = cb.makeRenderCommandEncoder(descriptor: flatPass)!
            textFlat.begin(width: width, height: height)
            hud.renderOverlay(textFlat, width: width, height: height, accent: preset.accentRGB,
                              kanji: preset.kanji, t: t, scene: SceneRegistry.ids[sceneIndex],
                              terminalScale: settings.terminalScale,
                              terminalLayout: settings.terminalLayout, terminalBand: settings.terminalBandHeight,
                              showPanels: settings.showHud)
            textFlat.flush(fenc)
            fenc.endEncoding()
        }

        cb.commit()
        cb.waitUntilCompleted()
        updateQuality(gpuMs: (cb.gpuEndTime - cb.gpuStartTime) * 1000)
    }

    /// Hysteretic quality controller: step down a tier when the GPU sustains
    /// >13ms (can't hold 60fps with headroom), step back up below 7ms. Wide band
    /// avoids flapping; a 0/invalid sample (timestamps unsupported) is ignored.
    private func updateQuality(gpuMs: Double) {
        guard gpuMs > 0 else { return }
        gpuMsSmoothed = gpuMsSmoothed > 0 ? gpuMsSmoothed * 0.9 + gpuMs * 0.1 : gpuMs
        if gpuMsSmoothed > 13, qualityTier < 3 { qualityTier += 1; gpuMsSmoothed = 0 }
        else if gpuMsSmoothed < 7, qualityTier > 0 { qualityTier -= 1; gpuMsSmoothed = 0 }
    }
}
