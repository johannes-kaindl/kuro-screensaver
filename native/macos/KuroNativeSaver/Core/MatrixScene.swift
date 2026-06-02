// MatrixScene — a "blank" scene: no 3D geometry, just the digital rain on black.
// The rain is a 2D screen-space effect (drawn in the renderer's text pass), so on
// its own — with no competing 3D camera motion — there is nothing for it to clash
// with. This is the clean home for the Matrix look. The renderer detects this
// scene and draws the rain at full presence regardless of the overlay toggle.

import simd

final class MatrixScene: Scene {
    var camera = Camera()
    let items: [DrawItem] = []
    let fogDensity: Float = 0

    init(ctx: SceneContext) {}
    func update(t: Double, dt: Double) {}
}
