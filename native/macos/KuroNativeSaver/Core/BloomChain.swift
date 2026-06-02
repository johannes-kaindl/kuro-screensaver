// BloomChain — the load-bearing neon glow. Threshold the HDR scene to a
// half-res texture, gaussian-blur it (MetalPerformanceShaders), and hand the
// result to the composite pass for additive blending. Ported intent from
// UnrealBloomPass (strength/radius/threshold).

import Metal
import MetalPerformanceShaders

final class BloomChain {
    let device: MTLDevice
    private let thresholdPipe: MTLRenderPipelineState
    private let blur: MPSImageGaussianBlur     // cached once (sigma is fixed)
    private var src: MTLTexture?   // threshold output (half-res)
    private var dst: MTLTexture?   // blurred (half-res)
    private var bw = 0, bh = 0

    var threshold: Float = 0.05
    let sigma: Float                // blur radius (half-res pixels)

    init(device: MTLDevice, library: MTLLibrary, sigma: Float) {
        self.device = device
        self.sigma = sigma
        let pd = MTLRenderPipelineDescriptor()
        pd.vertexFunction = library.makeFunction(name: "fsq_v")
        pd.fragmentFunction = library.makeFunction(name: "threshold_f")
        pd.colorAttachments[0].pixelFormat = Renderer.hdrFormat
        thresholdPipe = try! device.makeRenderPipelineState(descriptor: pd)
        let b = MPSImageGaussianBlur(device: device, sigma: sigma)
        b.edgeMode = .clamp
        blur = b
    }

    private func ensure(_ w: Int, _ h: Int) {
        guard w != bw || h != bh || src == nil else { return }
        bw = w; bh = h
        let sd = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: Renderer.hdrFormat, width: w, height: h, mipmapped: false)
        sd.usage = [.renderTarget, .shaderRead]
        sd.storageMode = .private
        src = device.makeTexture(descriptor: sd)
        let dd = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: Renderer.hdrFormat, width: w, height: h, mipmapped: false)
        dd.usage = [.shaderRead, .shaderWrite]
        dd.storageMode = .private
        dst = device.makeTexture(descriptor: dd)
    }

    /// Encode threshold + blur into `cb`; returns the blurred bloom texture.
    func generate(_ cb: MTLCommandBuffer, sceneHDR: MTLTexture) -> MTLTexture {
        // Quarter-res bloom: the glow is soft, so the lower-res blur is visually
        // ~identical but markedly cheaper (helps the heavier scenes at 4K/5K).
        ensure(max(1, sceneHDR.width / 4), max(1, sceneHDR.height / 4))
        guard let src, let dst else { return sceneHDR }

        let rp = MTLRenderPassDescriptor()
        rp.colorAttachments[0].texture = src
        rp.colorAttachments[0].loadAction = .clear
        rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
        rp.colorAttachments[0].storeAction = .store
        let enc = cb.makeRenderCommandEncoder(descriptor: rp)!
        enc.setRenderPipelineState(thresholdPipe)
        enc.setFragmentTexture(sceneHDR, index: 0)
        var pu = PostUniforms(p0: SIMD4(threshold, 0, 0, 0))
        enc.setFragmentBytes(&pu, length: MemoryLayout<PostUniforms>.stride, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()

        blur.encode(commandBuffer: cb, sourceTexture: src, destinationTexture: dst)
        return dst
    }
}
