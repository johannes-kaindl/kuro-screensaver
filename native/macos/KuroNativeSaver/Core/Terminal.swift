// Terminal — the narrative "soul": a procedurally-acted operator-under-attack
// story (ROUTINE→INTRUSION→ALARM→PANIC→SILENCE) with a per-shift persona and a
// realistic typewriter, driven by a time-based scheduler (not async/await).
// Ported faithfully from terminal/{narrative,persona,typing,script-bank}.ts;
// content is a representative subset of the web pools.

import Foundation

final class Terminal {
    enum Cat { case status, warning, lore, quotes, cmd, resp, hq, deny, instr }
    struct Line { let text: String; let category: Cat }

    private(set) var lines: [Line] = []
    private var typed = ""
    private var rng = LCG(seed: freshSeed())
    private var persona = Persona.make()
    var onShiftEnd: (() -> Void)?

    private enum Phase { case routine, intrusion, alarm, panic, silence }
    private var phase: Phase = .routine
    private var phaseEndsAt: Double = -1
    private var cps: Double = 20

    private enum Action { case type(String), commit(Cat), line(String, Cat), wait(Double) }
    private var queue: [Action] = []
    private var actionStart: Double = -1
    private var restUntil: Double = 0

    // MARK: - public (read by Hud)

    func update(t: Double) {
        if phaseEndsAt < 0 { enterPhase(.routine, t: t) }

        if t >= phaseEndsAt, queue.isEmpty, actionStart < 0 { advancePhase(t) }

        if actionStart < 0 {
            guard t >= restUntil else { return }
            if queue.isEmpty { runBeat() }
            if !queue.isEmpty { actionStart = t }
        }
        if actionStart >= 0, let a = queue.first, processAction(a, t) {
            queue.removeFirst(); actionStart = -1
            if queue.isEmpty { restUntil = t + phaseRest() }
        }
    }

    func visibleLines(max n: Int) -> [Line] { Array(lines.suffix(n)) }

    func promptLine(t: Double) -> String {
        let cursor = Int(t * 1.4) % 2 == 0 ? "█" : " "
        return persona.prompt + " " + typed + cursor
    }

    // MARK: - scheduler

    private func processAction(_ a: Action, _ t: Double) -> Bool {
        switch a {
        case .type(let s):
            let n = min(s.count, Int((t - actionStart) * cps))
            typed = String(s.prefix(n))
            return n >= s.count && (t - actionStart) > Double(s.count) / cps + 0.15
        case .commit(let cat):
            if !typed.isEmpty { addLine(typed, cat) }
            typed = ""; return true
        case .line(let text, let cat):
            addLine(text, cat); return true
        case .wait(let d):
            return t - actionStart >= d
        }
    }

    private func addLine(_ text: String, _ cat: Cat) {
        lines.append(Line(text: prefix(cat) + text, category: cat))
        if lines.count > 40 { lines.removeFirst(lines.count - 40) }
    }

    private func prefix(_ c: Cat) -> String {
        switch c {
        case .status: return "[OK] "; case .warning: return "[!!] "; case .lore: return "[**] "
        case .quotes: return "› "; case .cmd: return "$ "; case .resp: return "  ↳ "
        case .hq: return "[HQ→] "; case .deny: return "[NO] "; case .instr: return "« "
        }
    }

    // MARK: - phases

    private func dur(_ p: Phase) -> Double {
        switch p {
        case .routine: return rngIn(70, 110); case .intrusion: return rngIn(110, 160)
        case .alarm: return rngIn(120, 180); case .panic: return rngIn(60, 100); case .silence: return rngIn(25, 45)
        }
    }
    private func phaseRest() -> Double {
        switch phase {
        case .routine: return rngIn(3.5, 6); case .intrusion: return rngIn(2.2, 4.5)
        case .alarm: return rngIn(1.4, 3.2); case .panic: return rngIn(0.6, 1.6); case .silence: return rngIn(2.5, 4.5)
        }
    }
    private func enterPhase(_ p: Phase, t: Double) {
        phase = p; phaseEndsAt = t + dur(p); queue.removeAll(); actionStart = -1; restUntil = t
        cps = 1000.0 / (38.0 * Double(persona.baseSpeed))
    }
    private func advancePhase(_ t: Double) {
        switch phase {
        case .routine: enterPhase(.intrusion, t: t)
        case .intrusion: enterPhase(.alarm, t: t)
        case .alarm: enterPhase(.panic, t: t)
        case .panic: enterPhase(.silence, t: t)
        case .silence:
            lines.removeAll(); typed = ""; persona = Persona.make(); onShiftEnd?()
            enterPhase(.routine, t: t)
        }
    }

    // MARK: - beats (enqueue actions for one beat of the current phase)

    private func runBeat() {
        switch phase {
        case .routine: beatRoutine()
        case .intrusion: beatIntrusion()
        case .alarm: beatAlarm()
        case .panic: beatPanic()
        case .silence: beatSilence()
        }
    }

    private func beatRoutine() {
        if rng.nextF() < 0.25 { queue.append(.line(pick(Script.status), .status)); return }
        let s = pick(Script.commands)
        queue.append(.type(s.cmd)); queue.append(.commit(.cmd))
        for r in s.resp { queue.append(.wait(0.25)); queue.append(.line(r.0, r.1)) }
    }
    private func beatIntrusion() {
        if rng.nextF() < 0.6 {
            queue.append(.line(pick(Script.intrusions), .quotes))
            queue.append(.wait(rngIn(0.9, 2.1)))
            queue.append(.type(pick(Script.reactions))); queue.append(.commit(.cmd))
            queue.append(.wait(0.4)); queue.append(.line(pick(Script.warnings), .warning))
        } else { beatRoutine() }
    }
    private func beatAlarm() {
        let c = rng.nextF()
        if c < 0.4 {
            queue.append(.line(pick(Script.hqInbound), .hq)); queue.append(.wait(rngIn(0.7, 1.5)))
            queue.append(.type(pick(Script.reactions))); queue.append(.commit(.cmd))
            queue.append(.wait(0.45)); queue.append(.line("AUTHORIZATION DENIED", .deny))
        } else if c < 0.75 {
            queue.append(.type(pick(Script.reactions))); queue.append(.commit(.cmd))
            queue.append(.wait(0.45)); queue.append(.line(pick(Script.warnings), .warning))
        } else { queue.append(.line(pick(Script.intrusions), .quotes)) }
    }
    private func beatPanic() {
        let c = rng.nextF()
        if c < 0.5 {
            queue.append(.type(pick(Script.panicCmds))); queue.append(.commit(.cmd))
            queue.append(.wait(0.4)); queue.append(.line(pick(Script.systemFinal), .warning))
        } else {
            let n = 2 + Int(rng.nextF() * 2)
            for _ in 0..<n { queue.append(.line(pick(Script.intrusions), .quotes)); queue.append(.wait(rngIn(0.28, 0.5))) }
        }
    }
    private func beatSilence() {
        if rng.nextF() < 0.5 { queue.append(.type(pick(Script.farewells))) /* never committed */; queue.append(.wait(3)) }
        else { queue.append(.line(pick(Script.farewells), .resp)) }
    }

    // MARK: - helpers

    private func rngIn(_ lo: Double, _ hi: Double) -> Double { lo + Double(rng.nextF()) * (hi - lo) }
    private func pick<T>(_ a: [T]) -> T { a[Int(rng.nextF() * Float(a.count)) % a.count] }
}

// Per-shift operator persona (persona.ts).
struct Persona {
    let prompt: String
    let baseSpeed: Float
    private static let roles = ["OFC", "CMP", "AUD", "TEL", "REL"]
    private static let nodes = ["7.2-N04", "7.4-N11", "7.6-N03", "7.4-N02", "7.2-N07", "7.6-N08"]
    private static let traitSpeed: [Float] = [1.25, 0.85, 1.1, 0.95]   // methodical/tense/overworked/rookie

    static func make() -> Persona {
        var r = LCG(seed: freshSeed())
        let role = roles[Int(r.nextF() * 5) % 5]
        let num = 2000 + Int(r.nextF() * 5000)
        let node = nodes[Int(r.nextF() * 6) % 6]
        let speed = traitSpeed[Int(r.nextF() * 4) % 4]
        return Persona(prompt: "\(role)-\(num)@SCT-\(node):~", baseSpeed: speed)
    }
}
