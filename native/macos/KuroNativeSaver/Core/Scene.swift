// Scene — the contract the renderer draws, mirroring the web SceneModule
// (build → updater). A Scene produces DrawItems (geometry) + a Camera and
// animates them per frame.

import Metal
import simd

/// Per-draw uniforms. Mirrors `SceneUniforms` in Shaders.swift (all 16-byte
/// aligned fields, no implicit padding ambiguity).
struct SceneUniforms {
    var mvp: matrix_float4x4
    var modelView: matrix_float4x4
    var color: SIMD4<Float>      // rgb + opacity
    var params: SIMD4<Float>     // fogDensity, pointSizeWorld, pointScale, isPoint
}

/// Mirrors `PostUniforms`.
struct PostUniforms {
    var p0: SIMD4<Float>         // x = exposure
}

/// One draw call: a position buffer (packed float3), optional line index buffer,
/// a model transform, and draw flags. Terrain chunks mutate `positions` in place
/// on wrap and `model` every frame.
final class DrawItem {
    let positions: MTLBuffer        // packed_float3 * vertexCount (storageModeShared)
    let indices: MTLBuffer?         // uint32 line indices, or nil
    let count: Int                  // index count if indexed, else vertex count
    let vertexCount: Int
    let primitive: MTLPrimitiveType
    var model: matrix_float4x4
    var opacity: Float
    var isPoint: Bool
    var pointSizeWorld: Float

    init(positions: MTLBuffer, indices: MTLBuffer?, count: Int, vertexCount: Int,
         primitive: MTLPrimitiveType, model: matrix_float4x4 = matrix_identity_float4x4,
         opacity: Float = 1, isPoint: Bool = false, pointSizeWorld: Float = 1) {
        self.positions = positions
        self.indices = indices
        self.count = count
        self.vertexCount = vertexCount
        self.primitive = primitive
        self.model = model
        self.opacity = opacity
        self.isPoint = isPoint
        self.pointSizeWorld = pointSizeWorld
    }
}

struct SceneContext {
    let device: MTLDevice
    var rng: LCG
    let settings: Settings
    let accent: SIMD3<Float>
}

protocol Scene: AnyObject {
    var camera: Camera { get }
    var items: [DrawItem] { get }
    var fogDensity: Float { get }
    func update(t: Double, dt: Double)
}
