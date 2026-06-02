// RiftScene — flight down a canyon between two periodic-noise wireframe walls,
// with periodic cosine-eased barrel rolls. Ported from scenes/rift.ts.

import Metal
import simd
import Foundation

final class RiftScene: Scene {
    var camera = Camera()
    private(set) var items: [DrawItem] = []
    let fogDensity: Float = 0.014

    private let speedPerSec: Float
    private let cAneg, cApos, cBneg, cBpos: DrawItem
    private var cAz: Float = -140
    private var cBz: Float = -420

    // barrel-roll state
    private var nextRollT: Double
    private var rollActive = false
    private var rollStartT: Double = 0
    private var currentRoll: Float = 0
    private var rollRng: LCG

    private static let CHUNK_LEN: Float = 280
    private static let WALL_X: Float = 13

    init(ctx: SceneContext) {
        let device = ctx.device
        speedPerSec = ctx.settings.speed.multiplier * 0.22 * 60   // web: *0.22 per frame@60

        camera.position = SIMD3(0, 8, 0)
        camera.rotation = SIMD3(-0.06, 0, 0)

        let segZ = 36, segY = 22
        let K = 2 * Float.pi / RiftScene.CHUNK_LEN

        func wallPositions(_ side: Float) -> [Float] {
            var p = [Float](); p.reserveCapacity((segZ + 1) * (segY + 1) * 3)
            for iy in 0...segY {
                let y0 = 110 - Float(iy) * 10
                for ix in 0...segZ {
                    let z0 = -140 + Float(ix) * (280.0 / Float(segZ))
                    let noise = sin(z0 * 2 * K + side * 12) * 4
                              + cos(z0 * 5 * K + y0 * 0.05) * 2.2
                              + sin(z0 * 12 * K + y0 * 0.03 + side * 7) * 1.4
                    p.append(side * noise); p.append(y0); p.append(z0)
                }
            }
            return p
        }
        let idx = Geo.gridLineIndices(cols: segZ, rows: segY)
        let idxBuf = Geo.buffer(device, idx)
        let vCount = (segZ + 1) * (segY + 1)
        let negBuf = Geo.buffer(device, wallPositions(-1))
        let posBuf = Geo.buffer(device, wallPositions(1))

        func wall(_ buf: MTLBuffer, _ side: Float, _ z: Float) -> DrawItem {
            DrawItem(positions: buf, indices: idxBuf, count: idx.count, vertexCount: vCount,
                     primitive: .line, model: Mathx.translation(SIMD3(side * RiftScene.WALL_X, 8, z)),
                     opacity: 0.55)
        }
        cAneg = wall(negBuf, -1, cAz); cApos = wall(posBuf, 1, cAz)
        cBneg = wall(negBuf, -1, cBz); cBpos = wall(posBuf, 1, cBz)

        // stars
        var rng = ctx.rng
        var sv = [Float](); sv.reserveCapacity(800 * 3)
        for _ in 0..<800 {
            sv.append((rng.nextF() - 0.5) * 220)
            sv.append(30 + rng.nextF() * 130)
            sv.append(-(rng.nextF() * 600 + 60))
        }
        let stars = DrawItem(positions: Geo.buffer(device, sv), indices: nil,
                             count: 800, vertexCount: 800, primitive: .point,
                             opacity: 1.0, isPoint: true, pointSizeWorld: 0.11)

        nextRollT = Double(25 + rng.nextF() * 30)
        rollRng = LCG(seed: (ctx.settings.seed ?? 1) &+ 4242)

        items = [cAneg, cApos, cBneg, cBpos, stars]
    }

    func update(t: Double, dt: Double) {
        let tf = Float(t)
        let spd = speedPerSec * Float(dt)
        cAz += spd; cBz += spd
        if cAz > 148 { cAz -= 560 }
        if cBz > 148 { cBz -= 560 }
        cAneg.model = Mathx.translation(SIMD3(-RiftScene.WALL_X, 8, cAz))
        cApos.model = Mathx.translation(SIMD3(RiftScene.WALL_X, 8, cAz))
        cBneg.model = Mathx.translation(SIMD3(-RiftScene.WALL_X, 8, cBz))
        cBpos.model = Mathx.translation(SIMD3(RiftScene.WALL_X, 8, cBz))

        // barrel roll
        if !rollActive && t > nextRollT { rollActive = true; rollStartT = t }
        if rollActive {
            let phase = Float((t - rollStartT) / 1.8)
            if phase >= 1 {
                rollActive = false; currentRoll = 0
                nextRollT = t + Double(30 + rollRng.nextF() * 60)
            } else {
                let eased = 0.5 - 0.5 * cos(phase * .pi)
                currentRoll = eased * .pi * 2
            }
        }

        camera.position = SIMD3(sin(tf * 0.08) * 2.4, 8 + sin(tf * 0.27) * 0.5, 0)
        camera.rotation = SIMD3(-0.06, cos(tf * 0.08) * 0.03, sin(tf * 0.08) * 0.04 + currentRoll)
    }
}
