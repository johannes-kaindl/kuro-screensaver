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
    let scene: Scene

    private let scenePipe: MTLRenderPipelineState
    private let compositePipe: MTLRenderPipelineState
    private let depthState: MTLDepthStencilState
    private let bloom: BloomChain
    private let glitch: GlitchScheduler

    private var sceneHDR: MTLTexture?
    private var depthTex: MTLTexture?
    private(set) var width = 0
    private(set) var height = 0

    private(set) var t: Double = 0
    private var scanDriftY: Float = 0

    static let hdrFormat: MTLPixelFormat = .rgba16Float

    init(device: MTLDevice, settings: Settings, scene: Scene,
         targetFormat: MTLPixelFormat) {
        self.device = device
        self.settings = settings
        self.preset = settings.preset
        self.scene = scene
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

        bloom = BloomChain(device: device, library: lib, sigma: 6)
        glitch = GlitchScheduler(intensity: settings.crtIntensity,
                                 seed: (settings.seed ?? freshSeed()) &+ 777)
    }

    /// Debug: hold one glitch artifact active (single-frame verification).
    func debugForceGlitch(_ name: String) { glitch.forceHold(name) }

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
        scene.update(t: t, dt: dt)
        glitch.update(t: t)
        scanDriftY = (scanDriftY + 36 * Float(dt)).truncatingRemainder(dividingBy: 4)
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
        let cam = scene.camera
        let view = cam.view()
        let viewProj = cam.projection(aspect: aspect) * view
        let fovy = cam.fovDegrees * .pi / 180
        let pointScale = Float(height) / (2 * tan(fovy / 2))
        let accent = preset.accentRGB

        for item in scene.items {
            var u = SceneUniforms(
                mvp: viewProj * item.model,
                modelView: view * item.model,
                color: SIMD4(accent, item.opacity),
                params: SIMD4(scene.fogDensity, item.pointSizeWorld, pointScale,
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

        // --- bloom (threshold + blur) ---
        let bloomTex = bloom.generate(cb, sceneHDR: sceneHDR)

        // --- composite pass → target ---
        let tp = MTLRenderPassDescriptor()
        tp.colorAttachments[0].texture = target
        tp.colorAttachments[0].loadAction = .clear
        tp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        tp.colorAttachments[0].storeAction = .store
        let enc2 = cb.makeRenderCommandEncoder(descriptor: tp)!
        enc2.setRenderPipelineState(compositePipe)
        enc2.setFragmentTexture(sceneHDR, index: 0)
        enc2.setFragmentTexture(bloomTex, index: 1)
        let vignetteInner = 0.52 - 0.30 * preset.vignetteStrength
        var pu = PostUniforms(
            p0: SIMD4(1.15, preset.bloomStrength,
                      0.0015 + glitch.chromaOffsetBump, preset.scanOpacity),
            p1: SIMD4(scanDriftY, vignetteInner, preset.vignetteStrength, Float(t)),
            p2: glitch.uniforms())
        enc2.setFragmentBytes(&pu, length: MemoryLayout<PostUniforms>.stride, index: 0)
        enc2.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc2.endEncoding()

        cb.commit()
        cb.waitUntilCompleted()
    }
}
