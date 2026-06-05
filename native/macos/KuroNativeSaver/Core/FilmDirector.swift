// FilmDirector — Swift mirror of src/engine/modes/film-director.ts. Seeded scene
// selection for the narrative arc: the phase picks the intensity tier (candidate
// list), a monotonic index picks which one, avoiding an immediate repeat. Pure +
// deterministic. (Distinct from FlightDirector, which owns camera/transitions.)

final class FilmDirector {
    private let seed: Int32
    init(seed: Int32) { self.seed = seed }

    private static let candidates: [ShiftPhase: [String]] = [
        .routine:   ["terrain", "city"],
        .intrusion: ["city", "rift"],
        .alarm:     ["rift", "tunnel"],
        .panic:     ["tunnel", "void", "wreckage"],
        .silence:   ["void", "wreckage"],
    ]

    /// Deterministic scene for the given monotonic index + phase, avoiding prev.
    func sceneAt(_ index: Int, phase: ShiftPhase, prev: String?) -> String {
        let cands = FilmDirector.candidates[phase] ?? ["terrain"]
        var r = LCG(seed: seed ^ Int32(truncatingIfNeeded: index &* 0x9e3779b1))
        var i = Int(r.next() * Double(cands.count)) % cands.count
        if cands[i] == prev && cands.count > 1 { i = (i + 1) % cands.count }
        return cands[i]
    }
}
