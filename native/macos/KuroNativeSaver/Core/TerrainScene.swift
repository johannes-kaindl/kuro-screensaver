// TerrainScene — the vertical-slice scene. A wireframe heightfield (two chunks
// scrolling toward the camera with seam-continuous resampling on wrap), a
// starfield and drifting dust. Ported from src/engine/engine/scenes/terrain.ts.

import Metal
import simd
import Foundation

// Chunk layout, ported verbatim from terrain.ts.
enum Terrain {
    static let D: Float = 180        // chunk length (z)
    static let WIDTH: Float = 280    // chunk width (x)
    static let SEG_W = 140           // lateral segments
    static let SEG_L = 130           // longitudinal segments
    static let startA: Float = -40           // chunk A initial z
    static let startB: Float = -40 - 180     // chunk B initial z (= startA - D)
}

/// Heightfield as a pure function of LOGICAL world position (terrain.ts heightAt).
/// Invariant relied upon: neighbour chunks' logical offsets differ by exactly D,
/// so heights agree at the seam.
func terrainHeight(_ x: Float, _ z: Float) -> Float {
    sin(x * 0.33) * cos(z * 0.2) * 2.8
    + sin(x * 0.77 + z * 0.26) * 0.95
    + cos(x * 0.16 - z * 0.13) * 1.8
}

final class TerrainScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.012

    private let speedPerSec: Float          // world units / second at this speed
    private let vCount: Int
    private var gridX: [Float] = []
    private var gridZ: [Float] = []

    private let chunkA: DrawItem
    private let chunkB: DrawItem
    private let dust: DrawItem
    var storm: Float = 0            // reactive-world PANIC storm (set by Renderer)
    private var logicalA = Terrain.startA
    private var logicalB = Terrain.startB
    private var posAz = Terrain.startA
    private var posBz = Terrain.startB
    private var fly: CameraFly

    init(ctx: SceneContext) {
        let device = ctx.device
        // web: spd = SPEED_VALUES[speed] * 0.2 per frame @60fps → *12 per second.
        speedPerSec = ctx.settings.speed.multiplier * 12
        fly = CameraFly(seed: (ctx.settings.seed ?? freshSeed()) &+ 4242,
                        latAmp: 12, vertAmp: 2.6, vertBase: 6.5, pitchBase: -0.2, bankScale: ctx.settings.bankStrength)

        camera.position = SIMD3(0, 6, 0)
        camera.rotation = SIMD3(-0.22, 0, 0)

        // --- grid local coords (shared topology for both chunks) ---
        let sw = Terrain.SEG_W, sl = Terrain.SEG_L
        let W = Terrain.WIDTH, D = Terrain.D
        var gx = [Float](); var gz = [Float]()
        gx.reserveCapacity((sw + 1) * (sl + 1)); gz.reserveCapacity((sw + 1) * (sl + 1))
        for iz in 0...sl {
            let zl = -D / 2 + D * Float(iz) / Float(sl)
            for ix in 0...sw {
                let x = -W / 2 + W * Float(ix) / Float(sw)
                gx.append(x); gz.append(zl)
            }
        }
        gridX = gx; gridZ = gz
        vCount = gx.count

        func chunkPositions(_ logical: Float) -> [Float] {
            var p = [Float](); p.reserveCapacity(gx.count * 3)
            for i in 0..<gx.count {
                p.append(gx[i]); p.append(terrainHeight(gx[i], gz[i] + logical)); p.append(gz[i])
            }
            return p
        }

        // --- line index buffer (horizontal + vertical grid edges) ---
        let stride = sw + 1
        var idx = [UInt32](); idx.reserveCapacity(sl * sw * 4)
        for iz in 0...sl {
            for ix in 0..<sw {
                let a = UInt32(iz * stride + ix); idx.append(a); idx.append(a + 1)
            }
        }
        for ix in 0...sw {
            for iz in 0..<sl {
                let a = UInt32(iz * stride + ix); idx.append(a); idx.append(a + UInt32(stride))
            }
        }
        let idxBuf = TerrainScene.buffer(device, idx)

        let posA = chunkPositions(logicalA)
        let posB = chunkPositions(logicalB)
        chunkA = DrawItem(positions: TerrainScene.buffer(device, posA), indices: idxBuf,
                          count: idx.count, vertexCount: vCount, primitive: .line,
                          model: Mathx.translation(SIMD3(0, 0, posAz)), opacity: 0.8)
        chunkB = DrawItem(positions: TerrainScene.buffer(device, posB), indices: idxBuf,
                          count: idx.count, vertexCount: vCount, primitive: .line,
                          model: Mathx.translation(SIMD3(0, 0, posBz)), opacity: 0.75)

        // --- stars + dust (point clouds, web rng order preserved) ---
        var rng = ctx.rng
        var starV = [Float](); starV.reserveCapacity(1000 * 3)
        for _ in 0..<1000 {
            starV.append((rng.nextF() - 0.5) * 400)
            starV.append(rng.nextF() * 70 + 5)
            starV.append(-(rng.nextF() * 400 + 10))
        }
        let stars = DrawItem(positions: TerrainScene.buffer(device, starV), indices: nil,
                             count: 1000, vertexCount: 1000, primitive: .point,
                             opacity: 1.0, isPoint: true, pointSizeWorld: 0.13)

        var dustV = [Float](); dustV.reserveCapacity(500 * 3)
        for _ in 0..<500 {
            dustV.append((rng.nextF() - 0.5) * 60)
            dustV.append(rng.nextF() * 18 + 1)
            dustV.append(-(rng.nextF() * 200 + 5))
        }
        dust = DrawItem(positions: TerrainScene.buffer(device, dustV), indices: nil,
                        count: 500, vertexCount: 500, primitive: .point,
                        opacity: 1.0, isPoint: true, pointSizeWorld: 0.06)

        items = [chunkA, chunkB, stars, dust]
    }

    private static func buffer<T>(_ device: MTLDevice, _ arr: [T]) -> MTLBuffer {
        arr.withUnsafeBytes {
            device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared)!
        }
    }

    private func resample(_ item: DrawItem, _ logical: Float) {
        let ptr = item.positions.contents().bindMemory(to: Float.self, capacity: vCount * 3)
        for i in 0..<vCount { ptr[i * 3 + 1] = terrainHeight(gridX[i], gridZ[i] + logical) }
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t)
        let spd = speedPerSec * Float(dt)
        posAz += spd; posBz += spd
        if posAz > Terrain.D / 2 + 12 {
            posAz -= Terrain.D * 2; logicalA -= Terrain.D * 2; resample(chunkA, logicalA)
        }
        if posBz > Terrain.D / 2 + 12 {
            posBz -= Terrain.D * 2; logicalB -= Terrain.D * 2; resample(chunkB, logicalB)
        }
        chunkA.model = Mathx.translation(SIMD3(0, 0, posAz))
        chunkB.model = Mathx.translation(SIMD3(0, 0, posBz))

        let f = fly.update(t: t, forwardSpeed: speedPerSec)
        camera.position = SIMD3(f.x, f.y, 0)
        camera.rotation = SIMD3(f.pitch, f.yaw, f.roll)

        dust.model = Mathx.translation(SIMD3(sin(tf * 0.07) * 4 + storm * 12 * sin(tf * 3.1), 0, 0))
        dust.pointSizeWorld = 0.13 + storm * 0.13
    }
}
