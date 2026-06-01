// Camera — perspective camera with the web engine's aspect-aware FOV
// breakpoints. Builds view/projection matrices for the scene render pass.

import simd

struct Camera {
    var position = SIMD3<Float>(0, 6, 0)
    var rotation = SIMD3<Float>(0, 0, 0)   // euler XYZ, radians (camera local→world)
    var fovDegrees: Float = 72
    var near: Float = 0.1
    var far: Float = 600

    /// Vertical FOV breakpoints ported from Engine.defaultFov (core.ts).
    static func defaultFovDeg(width: Int, height: Int) -> Float {
        let aspect = Float(width) / Float(height)
        if aspect >= 1.6 { return 62 }
        if aspect <= 0.75 { return 95 }
        return 72
    }

    func projection(aspect: Float) -> float4x4 {
        Mathx.perspective(fovyRadians: fovDegrees * .pi / 180,
                          aspect: aspect, near: near, far: far)
    }

    /// World→eye. Camera world transform is T(pos)·Rx·Ry·Rz; view is its inverse.
    func view() -> float4x4 {
        let r = Mathx.rotationX(rotation.x)
              * Mathx.rotationY(rotation.y)
              * Mathx.rotationZ(rotation.z)
        return r.transpose * Mathx.translation(-position)   // R⁻¹ · T⁻¹
    }
}
