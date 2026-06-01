// LCG — seeded linear congruential RNG, ported bit-for-bit from the web engine
// (src/engine/engine/rng.ts) so procedural layouts are reproducible from a seed.
//
//   JS:  s = (Math.imul(s, 1664525) + 1013904223) | 0;  return (s >>> 0) / 2^32
// Swift wrapping ops `&*`/`&+` on Int32 reproduce the two's-complement |0 wrap;
// UInt32(bitPattern:) reproduces the >>> 0.

import Foundation

struct LCG {
    private var s: Int32

    init(seed: Int32) { s = (seed == 0) ? 1 : seed }

    mutating func next() -> Double {
        s = s &* 1664525 &+ 1013904223
        return Double(UInt32(bitPattern: s)) / 4294967296.0
    }

    /// Convenience: next Float in [0, 1).
    mutating func nextF() -> Float { Float(next()) }
}

func freshSeed() -> Int32 {
    let ms = Int64(Date().timeIntervalSince1970 * 1000)
    let lo = Int32(truncatingIfNeeded: ms)
    return lo ^ Int32.random(in: Int32.min...Int32.max)
}
