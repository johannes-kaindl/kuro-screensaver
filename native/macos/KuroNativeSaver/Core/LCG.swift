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

/// Fisher-Yates over a copy, then take the first `count` — the seeded twin of the
/// web's boot-line pick (`hud/boot.ts`). Two things it deliberately is NOT:
/// `Array.shuffled()` draws from the system RNG, which would make a fixed-seed
/// harness render stop being byte-stable; and a comparator shuffle
/// (`sort { _,_ in Bool.random() }`) is not uniform — the pool's leading entries
/// come up measurably more often, which is exactly the web bug this replaces.
/// `rng.next()` is strictly < 1, so `j` never exceeds `i`.
func shuffledPrefix<T>(_ pool: [T], _ count: Int, _ rng: inout LCG) -> [T] {
    var a = pool
    if a.count > 1 {
        for i in stride(from: a.count - 1, to: 0, by: -1) {
            let j = Int(rng.next() * Double(i + 1))
            a.swapAt(i, j)
        }
    }
    return Array(a.prefix(count))
}
