// Geo — shared geometry helpers for the scenes (Metal buffers, grid-line index
// generation, polyhedra for the void asteroids).

import Metal
import simd

enum Geo {
    static func buffer<T>(_ device: MTLDevice, _ arr: [T]) -> MTLBuffer {
        arr.withUnsafeBytes {
            device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared)!
        }
    }

    /// Horizontal + vertical line indices for a (cols+1)×(rows+1) vertex grid,
    /// vertices ordered row-major (row outer, col inner): index = row*(cols+1)+col.
    static func gridLineIndices(cols: Int, rows: Int) -> [UInt32] {
        let stride = cols + 1
        var idx = [UInt32](); idx.reserveCapacity(rows * cols * 4)
        for r in 0...rows {
            for c in 0..<cols { let a = UInt32(r * stride + c); idx.append(a); idx.append(a + 1) }
        }
        for c in 0...cols {
            for r in 0..<rows { let a = UInt32(r * stride + c); idx.append(a); idx.append(a + UInt32(stride)) }
        }
        return idx
    }

    /// Wireframe box (8 corners, 12 edges) — used for wreckage panels/struts.
    static func box(_ w: Float, _ h: Float, _ d: Float) -> (pos: [SIMD3<Float>], idx: [UInt32]) {
        let x = w / 2, y = h / 2, z = d / 2
        let pos: [SIMD3<Float>] = [
            SIMD3(-x, -y, -z), SIMD3(x, -y, -z), SIMD3(x, y, -z), SIMD3(-x, y, -z),
            SIMD3(-x, -y,  z), SIMD3(x, -y,  z), SIMD3(x, y,  z), SIMD3(-x, y,  z),
        ]
        let idx: [UInt32] = [0,1, 1,2, 2,3, 3,0,  4,5, 5,6, 6,7, 7,4,  0,4, 1,5, 2,6, 3,7]
        return (pos, idx)
    }

    /// Unit icosahedron, subdivided `detail` times, returned as (positions, lineIndices)
    /// where lineIndices are the unique triangle edges (wireframe). radius 1.
    static func icosahedron(detail: Int) -> (pos: [SIMD3<Float>], idx: [UInt32]) {
        let t = Float((1 + sqrt(5.0)) / 2)
        let raw: [(Float, Float, Float)] = [
            (-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
            (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
            (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1),
        ]
        var verts: [SIMD3<Float>] = raw.map { simd_normalize(SIMD3<Float>($0.0, $0.1, $0.2)) }
        var faces: [(Int, Int, Int)] = [
            (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
            (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
            (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
            (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
        ]
        var midCache: [Int64: Int] = [:]
        func midpoint(_ a: Int, _ b: Int) -> Int {
            let key = Int64(min(a, b)) << 32 | Int64(max(a, b))
            if let m = midCache[key] { return m }
            let m = simd_normalize((verts[a] + verts[b]) * 0.5)
            verts.append(m); let idx = verts.count - 1; midCache[key] = idx; return idx
        }
        for _ in 0..<max(0, detail) {
            var next: [(Int, Int, Int)] = []
            for (a, b, c) in faces {
                let ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a)
                next.append((a, ab, ca)); next.append((b, bc, ab))
                next.append((c, ca, bc)); next.append((ab, bc, ca))
            }
            faces = next
        }
        return (verts, triangleEdges(faces))
    }

    /// Unit dodecahedron as (positions, lineIndices) — its 30 edges.
    static func dodecahedron() -> (pos: [SIMD3<Float>], idx: [UInt32]) {
        let p = Float((1 + sqrt(5.0)) / 2), r = Float(1 / ((1 + sqrt(5.0)) / 2))
        var v: [SIMD3<Float>] = []
        let s: [Float] = [-1, 1]
        for sx in s { for sy in s { for sz in s { v.append(SIMD3<Float>(sx, sy, sz)) } } }
        for s1 in s { for s2 in s {
            v.append(SIMD3<Float>(0, s1 * r, s2 * p))
            v.append(SIMD3<Float>(s1 * r, s2 * p, 0))
            v.append(SIMD3<Float>(s1 * p, 0, s2 * r))
        } }
        let verts = v.map { simd_normalize($0) }
        // Connect vertices whose distance ≈ the minimum edge length.
        var minD = Float.greatestFiniteMagnitude
        for i in 0..<verts.count { for j in (i + 1)..<verts.count {
            minD = min(minD, simd_distance(verts[i], verts[j])) } }
        var idx: [UInt32] = []
        for i in 0..<verts.count { for j in (i + 1)..<verts.count {
            if simd_distance(verts[i], verts[j]) < minD * 1.05 { idx.append(UInt32(i)); idx.append(UInt32(j)) }
        } }
        return (verts, idx)
    }

    /// Torus wireframe (hole axis = Z), as flat positions + grid line indices.
    /// Big circle radius R in the XY plane, tube radius `tube`.
    static func torus(R: Float, tube: Float, radial: Int, tubular: Int) -> (pos: [Float], idx: [UInt32]) {
        var p = [Float](); p.reserveCapacity((radial + 1) * (tubular + 1) * 3)
        for j in 0...tubular {
            let v = Float(j) / Float(tubular) * 2 * .pi
            for i in 0...radial {
                let w = Float(i) / Float(radial) * 2 * .pi
                let ringR = R + tube * cos(w)
                p.append(ringR * cos(v)); p.append(ringR * sin(v)); p.append(tube * sin(w))
            }
        }
        return (p, gridLineIndices(cols: radial, rows: tubular))
    }

    /// Unique edges of a triangle face list, as a line index buffer.
    static func triangleEdges(_ faces: [(Int, Int, Int)]) -> [UInt32] {
        var seen = Set<Int64>(); var idx: [UInt32] = []
        func add(_ a: Int, _ b: Int) {
            let key = Int64(min(a, b)) << 32 | Int64(max(a, b))
            if seen.insert(key).inserted { idx.append(UInt32(a)); idx.append(UInt32(b)) }
        }
        for (a, b, c) in faces { add(a, b); add(b, c); add(c, a) }
        return idx
    }
}
