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
        crash.powerOn()   // diegetic CRT power-on (image expands out of a line + flickers)
    }

    /// Debug: render a black scene (skip geometry) to verify text/overlays alone.
    var debugBlackScene = false
    /// Debug: hold one glitch artifact active (single-frame verification).
    func debugForceGlitch(_ name: String) { glitch.forceHold(name) }
    /// Debug: freeze a crash-collapse amount for single-frame verification.
    func debugForceCrash(_ amount: Float) { crash.debugSet(collapse: amount) }

    private func swapScene() {
        sceneIndex = (sceneIndex + 1) % SceneRegistry.ids.count
        let ctx = SceneContext(device: device, rng: LCG(seed: freshSeed()),
                               settings: settings, accent: preset.accentRGB)
        scene = SceneRegistry.make(SceneRegistry.ids[sceneIndex], ctx: ctx)
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
    func advance(dt: Double) {
        t += dt
        // Set the aspect-aware base FOV before update so scenes (tunnel) can
        // adjust it (boost). Uses the last drawn size; 72° on the very first tick.
        scene.camera.fovDegrees = Camera.defaultFovDeg(width: width, height: height)
        scene.update(t: t, dt: dt)
        glitch.update(t: t)
        if dt > 0 { fps = fps * 0.9 + (1.0 / dt) * 0.1 }
        hud.setFps(fps)
        hud.terminal.update(t: t)
        scanDriftY = (scanDriftY + 36 * Float(dt)).truncatingRemainder(dividingBy: 4)

        // scene auto-cycle via the crash→reboot transition
        sceneAge += dt
        if autoCycleSec > 0 && sceneAge > autoCycleSec && !crash.active {
            crash.trigger(); sceneAge = 0
        }
        if crash.update(dt: dt) { swapScene() }
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
        var expo: Float = 1.15 / 0.6
        if settings.dayNight {
            let dn = 0.5 + 0.5 * sin(tf / 240 * 2 * .pi)   // 0 night .. 1 day (4-min cycle)
            expo *= 0.7 + 0.6 * dn; bloomMul *= 0.8 + 0.5 * dn; fogMul *= 1 + 0.5 * (1 - dn)
        }
        switch settings.weather {
        case .storm:
            let surge = max(0, sin(tf * 3)) * max(0, sin(tf * 0.7))
            bloomMul *= 1 + surge * 1.4; fogMul *= 1.25
        case .dust: fogMul *= 1.6; bloomMul *= 0.85
        case .clear: break
        }

        for item in (debugBlackScene ? [] : scene.items) {
            var u = SceneUniforms(
                mvp: viewProj * item.model,
                modelView: view * item.model,
                color: SIMD4(accent, item.opacity),
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
        let wantMatrix = settings.matrix && qualityTier < 1
        if settings.showHud || wantMatrix {
            text.begin(width: width, height: height)
            hud.render(text, width: width, height: height, accent: preset.accentRGB,
                       kanji: preset.kanji, t: t, scene: SceneRegistry.ids[sceneIndex],
                       terminalScale: settings.terminalScale,
                       matrix: wantMatrix, showPanels: settings.showHud)
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
            p6: SIMD4(settings.ntsc, settings.halation, 0, 0))
        enc2.setFragmentBytes(&pu, length: MemoryLayout<PostUniforms>.stride, index: 0)
        enc2.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc2.endEncoding()

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
