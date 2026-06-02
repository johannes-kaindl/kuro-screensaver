// SceneRegistry — maps a scene id to a Scene factory, mirroring the web
// SCENE_REGISTRY. The host/harness pick a scene by id; runtime scene-switching
// (with the CRT crash transition) goes through here too.

import Foundation

enum SceneRegistry {
    static let ids = ["terrain", "city", "rift", "tunnel", "void"]

    static func make(_ id: String, ctx: SceneContext) -> Scene {
        switch id {
        case "rift": return RiftScene(ctx: ctx)
        // void/tunnel/city added as they are implemented
        default: return TerrainScene(ctx: ctx)
        }
    }
}
