// TextRenderer — batches font-atlas glyph quads into a vertex buffer and draws
// them (alpha-blended) into the HDR scene, so the CRT post treats the text.
// Screen-pixel coordinates, top-left origin (like the web HUD).

import Metal
import simd

final class TextRenderer {
    private let device: MTLDevice
    let atlas: FontAtlas
    private let pipeline: MTLRenderPipelineState
    private var verts: [Float] = []
    private var buffer: MTLBuffer?
    private var vpW: Float = 1, vpH: Float = 1

    init(device: MTLDevice, library: MTLLibrary, atlas: FontAtlas, format: MTLPixelFormat) {
        self.device = device
        self.atlas = atlas
        let pd = MTLRenderPipelineDescriptor()
        pd.vertexFunction = library.makeFunction(name: "text_v")
        pd.fragmentFunction = library.makeFunction(name: "text_f")
        let a = pd.colorAttachments[0]!
        a.pixelFormat = format
        a.isBlendingEnabled = true
        a.rgbBlendOperation = .add; a.alphaBlendOperation = .add
        a.sourceRGBBlendFactor = .sourceAlpha; a.destinationRGBBlendFactor = .oneMinusSourceAlpha
        a.sourceAlphaBlendFactor = .one; a.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        pipeline = try! device.makeRenderPipelineState(descriptor: pd)
    }

    func begin(width: Int, height: Int) {
        verts.removeAll(keepingCapacity: true)
        vpW = Float(max(1, width)); vpH = Float(max(1, height))
    }

    var isEmpty: Bool { verts.isEmpty }

    /// Glyph cell width in px for a given cell height.
    func charWidth(pxHeight: Float) -> Float { pxHeight * atlas.cellAspect }

    /// Draw text at screen pixel (xPx, yPx) = top-left of the first cell.
    func add(_ text: String, xPx: Float, yPx: Float, pxHeight: Float,
             color: SIMD3<Float>, opacity: Float = 1) {
        let cw = pxHeight * atlas.cellAspect
        var cx = xPx
        for ch in text {
            defer { cx += cw }
            if ch == " " { continue }
            guard let r = atlas.uvRect(ch) else { continue }
            let x0 = cx / vpW * 2 - 1, x1 = (cx + cw) / vpW * 2 - 1
            let yt = 1 - yPx / vpH * 2
            let yb = 1 - (yPx + pxHeight) / vpH * 2
            let r3 = color.x, g3 = color.y, b3 = color.z, a = opacity
            func v(_ x: Float, _ y: Float, _ u: Float, _ vv: Float) {
                verts.append(contentsOf: [x, y, u, vv, r3, g3, b3, a])
            }
            // screen-top → glyph-top (vTop); screen-bottom → vBottom
            v(x0, yt, r.uLo, r.vTop); v(x1, yt, r.uHi, r.vTop); v(x0, yb, r.uLo, r.vBottom)
            v(x0, yb, r.uLo, r.vBottom); v(x1, yt, r.uHi, r.vTop); v(x1, yb, r.uHi, r.vBottom)
        }
    }

    /// Draw a solid filled rectangle in the same batch (samples the centre of the
    /// █ glyph, coverage ≈ 1.0) — used for the Lisa terminal-window chrome.
    func fillRect(xPx: Float, yPx: Float, wPx: Float, hPx: Float, color: SIMD3<Float>, opacity: Float) {
        guard opacity > 0.002, wPx > 0, hPx > 0 else { return }
        let u = atlas.solidU, vv = atlas.solidV
        let x0 = xPx / vpW * 2 - 1, x1 = (xPx + wPx) / vpW * 2 - 1
        let yt = 1 - yPx / vpH * 2, yb = 1 - (yPx + hPx) / vpH * 2
        let r3 = color.x, g3 = color.y, b3 = color.z, a = opacity
        func v(_ x: Float, _ y: Float) { verts.append(contentsOf: [x, y, u, vv, r3, g3, b3, a]) }
        v(x0, yt); v(x1, yt); v(x0, yb)
        v(x0, yb); v(x1, yt); v(x1, yb)
    }

    /// Draw a thickness-wide line between two screen-pixel points (a rotated quad,
    /// solid fill). Used for non-axis-aligned HUD geometry like the radar sweep/rings.
    func line(_ ax: Float, _ ay: Float, _ bx: Float, _ by: Float, width: Float, color: SIMD3<Float>, opacity: Float) {
        guard opacity > 0.002 else { return }
        let dx = bx - ax, dy = by - ay
        let len = max(0.0001, (dx * dx + dy * dy).squareRoot())
        let hw = width * 0.5
        let nx = -dy / len * hw, ny = dx / len * hw      // perpendicular half-width offset
        let u = atlas.solidU, vv = atlas.solidV
        let r3 = color.x, g3 = color.y, b3 = color.z, a = opacity
        func v(_ px: Float, _ py: Float) {
            verts.append(contentsOf: [px / vpW * 2 - 1, 1 - py / vpH * 2, u, vv, r3, g3, b3, a])
        }
        v(ax + nx, ay + ny); v(bx + nx, by + ny); v(ax - nx, ay - ny)
        v(ax - nx, ay - ny); v(bx + nx, by + ny); v(bx - nx, by - ny)
    }

    /// Measured pixel width of a string at a given cell height.
    func width(_ text: String, pxHeight: Float) -> Float { Float(text.count) * pxHeight * atlas.cellAspect }

    func flush(_ enc: MTLRenderCommandEncoder) {
        guard !verts.isEmpty else { return }
        let bytes = verts.count * MemoryLayout<Float>.stride
        if buffer == nil || buffer!.length < bytes {
            buffer = device.makeBuffer(length: max(bytes, 8192), options: .storageModeShared)
        }
        memcpy(buffer!.contents(), verts, bytes)
        enc.setRenderPipelineState(pipeline)
        enc.setVertexBuffer(buffer, offset: 0, index: 0)
        enc.setFragmentTexture(atlas.texture, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: verts.count / 8)
    }
}
