// Chatter.swift — Brick E: multi-speaker radio chatter (Swift mirror of chatter-bank.ts
// + chatter-director.ts). Event/phase-keyed exchanges between callsigns:
//   RADIO  — CORP net (dispatch)          → .hq colour
//   UNIT-A — friendly wingman             → .hq colour
//   WRAITH — the compromised hostile      → .ghost colour
//
// The director stages an exchange's speaker turns on a pending queue keyed by due-time and
// flushes them from the render loop (no cross-thread DispatchQueue — the renderer is single
// threaded; pushing terminal lines off-thread would race `lines`).

import Foundation

struct ChatterLine { let speaker: String; let cat: Terminal.Cat; let text: String }

enum Chatter {
    static let pools: [String: [[ChatterLine]]] = [
        "incomingFire": [
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "EVASIVE — ROUNDS INBOUND"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "reacquired. hold still.")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "CONTACT — WEAPONS HOT"),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "BREAKING — STAY ON MY WING")],
            [ChatterLine(speaker: "WRAITH", cat: .ghost, text: "i see every move before you make it."),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "JINK! GET OFF THE LINE!")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "TRACERS — HIGH AND RIGHT"),
             ChatterLine(speaker: "RADIO", cat: .hq, text: "HOLD COURSE. RELIEF IS CLOSE.")],
        ],
        "unitArrive": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "CORP-7 ON STATION — FORMING UP"),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "EYES ON. WE HAVE YOUR SIX.")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "INBOUND TO ASSIST — TEN SECONDS"),
             ChatterLine(speaker: "RADIO", cat: .hq, text: "RELIEF FLIGHT CLEARED HOT")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "REINFORCEMENT VECTOR CONFIRMED"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "more of you. it changes nothing.")],
        ],
        "unitCrash": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "UNIT DOWN — TRANSPONDER DARK"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "one less.")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "MAYDAY — I'M HIT, GOING IN—"),
             ChatterLine(speaker: "RADIO", cat: .hq, text: "BEACON LOGGED. KEEP MOVING.")],
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "LOST CORP-7. NO CHUTE."),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "damn it. press on.")],
        ],
        "phase:INTRUSION": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "ANOMALY ON THE NET — STAND BY"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "knock knock.")],
        ],
        "phase:ALARM": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "NET-WIDE ALERT — HOSTILE SIGNATURE"),
             ChatterLine(speaker: "UNIT-A", cat: .hq, text: "WEAPONS FREE. WATCH THE FLANKS.")],
            [ChatterLine(speaker: "WRAITH", cat: .ghost, text: "i'm already inside."),
             ChatterLine(speaker: "RADIO", cat: .hq, text: "LOCK DOWN SECONDARY CHANNELS")],
        ],
        "phase:PANIC": [
            [ChatterLine(speaker: "WRAITH", cat: .ghost, text: "your net is mine now."),
             ChatterLine(speaker: "RADIO", cat: .hq, text: "CHANNELS COMPROMISED — GO DARK")],
            [ChatterLine(speaker: "UNIT-A", cat: .hq, text: "I CAN'T RAISE COMMAND—"),
             ChatterLine(speaker: "WRAITH", cat: .ghost, text: "no one is coming.")],
        ],
        "phase:SILENCE": [
            [ChatterLine(speaker: "RADIO", cat: .hq, text: "...is anyone still receiving?")],
        ],
    ]
}

/// Stages exchanges as a due-timed pending queue, flushed from the render loop.
final class ChatterDirector {
    private var rng: LCG
    private var last: [String: Int] = [:]
    private struct Pending { let dueT: Double; let line: ChatterLine }
    private var pending: [Pending] = []

    init(seed: Int32) { rng = LCG(seed: seed ^ Int32(bitPattern: 0x00c4_a77e)) }

    /// Queue one exchange for `key` (no-op if empty); avoids repeating the previous one.
    func fire(_ key: String, t: Double) {
        guard let pool = Chatter.pools[key], !pool.isEmpty else { return }
        var idx = min(pool.count - 1, Int(rng.nextF() * Float(pool.count)))
        if pool.count > 1 && idx == (last[key] ?? -1) { idx = (idx + 1) % pool.count }
        last[key] = idx
        for (i, line) in pool[idx].enumerated() {
            pending.append(Pending(dueT: t + Double(i) * 0.52, line: line))
        }
    }

    /// Flush due lines into the terminal (call each frame).
    func update(t: Double, terminal: Terminal) {
        guard !pending.isEmpty else { return }
        var still: [Pending] = []
        for p in pending {
            if t >= p.dueT { terminal.pushLine(p.line.text, p.line.cat, speaker: p.line.speaker) }
            else { still.append(p) }
        }
        pending = still
    }
}
