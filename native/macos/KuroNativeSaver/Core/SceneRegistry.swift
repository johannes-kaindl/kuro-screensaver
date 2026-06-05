// SceneRegistry — maps a scene id to a Scene factory, mirroring the web
// SCENE_REGISTRY. The host/harness pick a scene by id; runtime scene-switching
// (with the CRT crash transition) goes through here too.

import Foundation

enum SceneRegistry {
    static let ids = ["terrain", "city", "rift", "tunnel", "void", "wreckage", "matrix"]

    static func make(_ id: String, ctx: SceneContext) -> Scene {
        switch id {
        case "rift": return RiftScene(ctx: ctx)
        case "void": return VoidScene(ctx: ctx)
        case "wreckage": return VoidScene(ctx: ctx, debris: true)
        case "tunnel": return TunnelScene(ctx: ctx)
        case "city": return CityScene(ctx: ctx)
        case "matrix": return MatrixScene(ctx: ctx)
        default: return TerrainScene(ctx: ctx)
        }
    }
}
