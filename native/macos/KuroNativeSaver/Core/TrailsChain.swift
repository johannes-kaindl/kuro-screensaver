// TrailsChain — phosphor persistence. A ping-pong accumulation texture: each
// frame outputs max(scene, prevAccum * decay), so bright moving wireframes leave
// a glowing, decaying trail. The result feeds bloom + composite.

import Metal

final class TrailsChain {
    private let device: MTLDevice
    private let pipeline: MTLRenderPipelineState
    private var texA: MTLTexture?, texB: MTLTexture?
    private var w = 0, h = 0
    private var cur = 0
    var decay: Float = 0.6

    init(device: MTLDevice, library: MTLLibrary) {
        self.device = device
        let pd = MTLRenderPipelineDescriptor()
        pd.vertexFunction = library.makeFunction(name: "fsq_v")
        pd.fragmentFunction = library.makeFunction(name: "trails_f")
        pd.colorAttachments[0].pixelFormat = Renderer.hdrFormat
        pipeline = try! device.makeRenderPipelineState(descriptor: pd)
    }

    private func ensure(_ nw: Int, _ nh: Int, _ queue: MTLCommandQueue) {
        guard nw != w || nh != h || texA == nil else { return }
        w = nw; h = nh
        let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: Renderer.hdrFormat, width: nw, height: nh, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]; d.storageMode = .private
        texA = device.makeTexture(descriptor: d); texB = device.makeTexture(descriptor: d)
        // clear both so the first frame's "previous" is black, not garbage
        let cb = queue.makeCommandBuffer()!
        for t in [texA!, texB!] {
            let rp = MTLRenderPassDescriptor()
            rp.colorAttachments[0].texture = t
            rp.colorAttachments[0].loadAction = .clear; rp.colorAttachments[0].storeAction = .store
            rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
            cb.makeRenderCommandEncoder(descriptor: rp)!.endEncoding()
        }
        cb.commit()
    }

    /// Render max(sceneHDR, prevAccum*decay) into the next ping-pong slot; returns it.
    func generate(_ cb: MTLCommandBuffer, sceneHDR: MTLTexture, queue: MTLCommandQueue) -> MTLTexture {
        ensure(sceneHDR.width, sceneHDR.height, queue)
        guard let texA, let texB else { return sceneHDR }
        let prev = (cur == 0) ? texB : texA
        let dst  = (cur == 0) ? texA : texB
        let rp = MTLRenderPassDescriptor()
        rp.colorAttachments[0].texture = dst
        rp.colorAttachments[0].loadAction = .dontCare; rp.colorAttachments[0].storeAction = .store
        let enc = cb.makeRenderCommandEncoder(descriptor: rp)!
        enc.setRenderPipelineState(pipeline)
        enc.setFragmentTexture(sceneHDR, index: 0)
        enc.setFragmentTexture(prev, index: 1)
        var d = decay; enc.setFragmentBytes(&d, length: MemoryLayout<Float>.stride, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
        cur ^= 1
        return dst
    }
}
