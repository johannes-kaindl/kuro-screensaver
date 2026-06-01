// Mathx — simd matrix helpers for the Metal renderer.
//
// Conventions: right-handed eye space (camera looks down -Z), Metal clip-space
// depth in [0, 1]. Column-major float4x4 (simd default), matching Metal's
// `float4x4` so matrices can be uploaded straight into a constant buffer.

import simd

enum Mathx {
    /// Right-handed perspective with depth mapped to [0, 1] (Metal convention).
    static func perspective(fovyRadians fovy: Float, aspect: Float,
                            near: Float, far: Float) -> float4x4 {
        let ys = 1 / tan(fovy * 0.5)
        let xs = ys / aspect
        let zs = far / (near - far)
        return float4x4(columns: (
            SIMD4<Float>(xs, 0, 0, 0),
            SIMD4<Float>(0, ys, 0, 0),
            SIMD4<Float>(0, 0, zs, -1),
            SIMD4<Float>(0, 0, zs * near, 0)
        ))
    }

    static func translation(_ t: SIMD3<Float>) -> float4x4 {
        var m = matrix_identity_float4x4
        m.columns.3 = SIMD4<Float>(t.x, t.y, t.z, 1)
        return m
    }

    static func rotationX(_ a: Float) -> float4x4 {
        let c = cos(a), s = sin(a)
        return float4x4(columns: (
            SIMD4<Float>(1, 0, 0, 0),
            SIMD4<Float>(0, c, s, 0),
            SIMD4<Float>(0, -s, c, 0),
            SIMD4<Float>(0, 0, 0, 1)
        ))
    }

    static func rotationY(_ a: Float) -> float4x4 {
        let c = cos(a), s = sin(a)
        return float4x4(columns: (
            SIMD4<Float>(c, 0, -s, 0),
            SIMD4<Float>(0, 1, 0, 0),
            SIMD4<Float>(s, 0, c, 0),
            SIMD4<Float>(0, 0, 0, 1)
        ))
    }

    static func rotationZ(_ a: Float) -> float4x4 {
        let c = cos(a), s = sin(a)
        return float4x4(columns: (
            SIMD4<Float>(c, s, 0, 0),
            SIMD4<Float>(-s, c, 0, 0),
            SIMD4<Float>(0, 0, 1, 0),
            SIMD4<Float>(0, 0, 0, 1)
        ))
    }
}
