// MatrixScene — the immersive Matrix mode: NO 3D geometry, just a world-space
// field of falling glyph strands (MatrixField3D) that the camera flies forward
// through. Depth is real perspective and the rain moves WITH the camera, so there
// is no 2D-overlay-vs-3D-motion clash. (The 'Matrix-Regen' checkbox stays as the
// flat screen-space overlay for the other scenes.) The renderer calls
// drawWorldText() in the overlay pass with this scene's view-projection.

import simd
import Foundation

final class MatrixScene: Scene {
    var camera = Camera()
    let items: [DrawItem] = []
    let fogDensity: Float = 0

    private let field: MatrixField3D
    private let speed: Float

    init(ctx: SceneContext) {
        field = MatrixField3D(seed: (ctx.settings.seed ?? freshSeed()) &+ 7373)
        speed = ctx.settings.speed.multiplier * 9
        camera.position = SIMD3(0, 0, 0)
        camera.rotation = SIMD3(0, 0, 0)
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t)
        camera.position.z -= speed * Float(dt)                 // fly forward through the field
        camera.position.x = sin(tf * 0.07) * 4                 // gentle drift (no roll → rain stays vertical)
        camera.position.y = sin(tf * 0.05) * 2
        camera.rotation = SIMD3(0, sin(tf * 0.06) * 0.05, 0)
        field.update(camPos: camera.position)
    }

    func drawWorldText(_ tr: TextRenderer, viewProj: matrix_float4x4, width: Int, height: Int, t: Double, accent: SIMD3<Float>) {
        field.draw(tr, viewProj: viewProj, width: width, height: height, t: t, accent: accent, opacity: 0.85)
    }
}
