// EventBus — Swift mirror of src/engine/events/bus.ts. Typed, synchronous,
// multi-producer/multi-consumer channel for discrete flight/narrative events.
// Handlers run on emit (settled within the frame). Any randomness a handler needs
// is drawn from the seeded LCG by the EMITTER (e.g. the Renderer), never here.

enum FlightEventKind: Int, CaseIterable { case intrusion = 0, manoeuvre = 1, incomingFire = 2, unitArrive = 3, unitCrash = 4, sceneChange = 5 }

struct FlightEvent {
    var kind: FlightEventKind
    /// event-specific scalar (e.g. intrusion → hesitation duration in seconds).
    var intensity: Double = 0
    /// -1 | 0 | +1 lateral/directional hint where meaningful.
    var dir: Double = 0
}

final class EventBus {
    // One handler bucket per kind (indexed by rawValue) — small + alloc-free on emit.
    // Sized from the case count (rawValues are contiguous 0..<count) so adding a kind can
    // never desync the array length from the enum.
    private var buckets: [[(FlightEvent) -> Void]] =
        Array(repeating: [], count: FlightEventKind.allCases.count)

    func subscribe(_ kind: FlightEventKind, _ fn: @escaping (FlightEvent) -> Void) {
        buckets[kind.rawValue].append(fn)
    }

    func emit(_ e: FlightEvent) {
        for fn in buckets[e.kind.rawValue] { fn(e) }
    }
}
