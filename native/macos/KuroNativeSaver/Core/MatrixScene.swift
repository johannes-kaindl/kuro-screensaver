// MatrixScene — a "blank" scene: no 3D geometry, just the (screen-space) digital
// rain on black. The rain is a 2D effect drawn in the renderer's text pass; on its
// own — with no competing 3D camera motion — there is nothing for it to clash with.
// The renderer detects this scene and draws the rain at full presence.

import simd

final class MatrixScene: Scene {
    var camera = Camera()
    let items: [DrawItem] = []
    let fogDensity: Float = 0

    init(ctx: SceneContext) {}
    func update(t: Double, dt: Double) {}
}
