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

/// Mirrors `PostUniforms` in Shaders.swift.
struct PostUniforms {
    var p0: SIMD4<Float>   // exposure, bloomStrength, chromaOffset, scanOpacity
    var p1: SIMD4<Float>   // scanDriftY(px), vignetteInner, vignetteStrength, time
    var p2: SIMD4<Float>   // hTearAmount, hTearBandY, brightness, scanPulse (glitch)
    var p3: SIMD4<Float>   // vRoll, blackFrame, skewX, staticAmt (glitch)
    var p4: SIMD4<Float>   // collapse, flash, curvature, bezelSharpness
    var p5: SIMD4<Float>   // maskStrength, maskCellPx, grain, flicker
    var p6: SIMD4<Float>   // ntsc, halation, _, _

    init(p0: SIMD4<Float>,
         p1: SIMD4<Float> = .zero,
         p2: SIMD4<Float> = SIMD4(0, 0, 1, 0),
         p3: SIMD4<Float> = .zero,
         p4: SIMD4<Float> = .zero,
         p5: SIMD4<Float> = .zero,
         p6: SIMD4<Float> = .zero) {
        self.p0 = p0; self.p1 = p1; self.p2 = p2; self.p3 = p3; self.p4 = p4; self.p5 = p5; self.p6 = p6
    }
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
    var infectable = false          // reactive world: crossfades accent→enemy with threat
    var colorOverride: SIMD3<Float>? = nil   // combat actors: a fixed colour (e.g. enemy)

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
    /// Director speed multiplier (1 in Brick A; ramps for warp in Brick B). Defaults
    /// to 1 so the harness / initial-scene construction sites need no change.
    var directorSpeed: () -> Float = { 1 }
    /// Effective forward-speed multiplier — scenes read THIS, not settings.speed.multiplier.
    func speed() -> Float { settings.speed.multiplier * directorSpeed() }
}

protocol Scene: AnyObject {
    var camera: Camera { get set }   // settable: the renderer applies aspect-aware FOV
    var items: [DrawItem] { get }
    var fogDensity: Float { get }
    func update(t: Double, dt: Double)
}
