// CombatDirector — Swift mirror of src/engine/modes/combat-director.ts. Seeded spawn
// cadence: antagonist (threat>0.35) + ≤2 CORP support units on seeded beats. Actors
// self-manage motion + fire and emit events on the bus. (Distinct from Flight/FilmDirector.)

import Foundation
import Metal
import simd

struct ActorHost {
    let device: MTLDevice
    let add: (Actor) -> Void
    let accentRGB: () -> SIMD3<Float>
    let enemyRGB: () -> SIMD3<Float>
}

final class CombatDirector {
    private let seed: Int32
    private let bus: EventBus
    private let host: ActorHost
    private var rng: LCG
    private var antagonist: Actor?
    private var support: [Actor] = []
    private var nextSupportT = 10.0

    init(seed: Int32, bus: EventBus, host: ActorHost) {
        self.seed = seed; self.bus = bus; self.host = host
        rng = LCG(seed: seed ^ Int32(bitPattern: 0x00c0_ffee))
    }

    func update(t: Double, threat: Float) {
        if threat > 0.35 && (antagonist == nil || !(antagonist!.alive)) {
            let a = AntagonistDrone(device: host.device, enemyRGB: host.enemyRGB(), seed: seed) { [weak self] in
                self?.bus.emit(FlightEvent(kind: .incomingFire, intensity: Double(threat)))
            }
            antagonist = a
            host.add(a)
        }
        support = support.filter { $0.alive }
        if threat > 0.4 && support.count < 2 && t > nextSupportT {
            nextSupportT = t + 9 + Double(rng.nextF()) * 13
            if rng.nextF() < 0.6 {
                let crash = rng.nextF() < 0.5
                let s = SupportUnit(device: host.device, accentRGB: host.accentRGB(),
                                    seed: seed &+ Int32(truncatingIfNeeded: Int(t)), crash: crash) { [weak self] in
                    self?.bus.emit(FlightEvent(kind: .unitCrash))
                }
                support.append(s)
                host.add(s)
                bus.emit(FlightEvent(kind: .unitArrive))
            }
        }
    }
}
