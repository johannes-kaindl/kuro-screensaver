// TerrainScene — math first (height field + seam constants). The full Scene
// geometry/update is added in a later task; these are the load-bearing numbers.

import Foundation

// Chunk layout, ported verbatim from src/engine/engine/scenes/terrain.ts.
enum Terrain {
    static let D: Float = 180        // chunk length (z)
    static let WIDTH: Float = 280    // chunk width (x)
    static let SEG_W = 140           // lateral segments
    static let SEG_L = 130           // longitudinal segments
    static let startA: Float = -40           // chunk A initial z
    static let startB: Float = -40 - 180      // chunk B initial z (= startA - D)
}

/// Heightfield as a pure function of LOGICAL world position (terrain.ts heightAt).
/// Invariant relied upon: neighbour chunks' logical offsets differ by exactly D,
/// so heights agree at the seam.
func terrainHeight(_ x: Float, _ z: Float) -> Float {
    sin(x * 0.33) * cos(z * 0.2) * 2.8
    + sin(x * 0.77 + z * 0.26) * 0.95
    + cos(x * 0.16 - z * 0.13) * 1.8
}
