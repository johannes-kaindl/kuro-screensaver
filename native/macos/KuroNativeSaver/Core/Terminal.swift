// Terminal — the narrative "soul": a procedurally-acted CORP operator's shift
// (ROUTINE→INTRUSION→ALARM→PANIC→SILENCE) with a per-shift persona, a realistic
// typewriter (type, type-and-erase), and the INSTR-KARSEN encrypted "ghostlink"
// backchannel whose replies grow guarded then silent as things worsen. Full port
// of engine/terminal/{narrative,persona,script-bank}.ts, driven by a time-based
// scheduler (no async/await). Every run differs: persona (role×trait×HQ×node),
// random beat selection, and which mentor exchanges fire.

import Foundation

final class Terminal {
    enum Cat { case status, warning, lore, quotes, cmd, resp, hq, deny, instr, ghost }
    struct Line { let text: String; let category: Cat }

    private(set) var lines: [Line] = []
    private var typed = ""
    private var rng: LCG
    private let seed: Int32
    private var persona: Persona

    /// Scales every phase's duration AND the foreshadow lead (web parity:
    /// narrative.ts:147/157). 1 = full ~6-9 min shift; <1 for video/test speed.
    var durationScale: Double = 1

    private var phase: ShiftPhase = .routine
    private var phaseStartedAt: Double = 0
    private var phaseEndsAt: Double = -1

    // Reactive-world signal (read by ReactiveWorld in Renderer each frame).
    var onIntrusion: (() -> Void)?     // fired when an intrusion event lands → camera hesitation
    var onPhaseEnter: ((ShiftPhase) -> Void)?        // Brick C: phase begins → film warps
    var sceneForeshadow: ((ShiftPhase) -> String?)?  // resolve foreshadow line for the next phase
    private var foreshadowed = false
    var currentPhase: ShiftPhase { phase }
    func phaseProgress(_ t: Double) -> Double {
        let span = phaseEndsAt - phaseStartedAt
        return span > 0 ? min(1, max(0, (t - phaseStartedAt) / span)) : 0
    }
    private var cps: Double = 22

    // mentor channel state (per shift)
    private var ghostlinkOpen = false
    private var usedExchanges: Set<Int> = []

    private enum Action {
        case type(String)                 // type text into the prompt
        case typeErase(String, Double)    // type, hold, then backspace to empty
        case commit(Cat)                  // commit typed as a line, clear prompt
        case line(String, Cat)            // add a line instantly
        case wait(Double)
    }
    private var queue: [Action] = []
    private var actionStart: Double = -1
    private var restUntil: Double = 0

    /// Open with a BIOS boot log already on screen (reads as "machine just woke").
    init() { let s = freshSeed(); seed = s; rng = LCG(seed: s); persona = Persona.make(); bootLog() }

    /// Deterministic init for tests / reproducible shifts (persona derives from the seed).
    init(seed s: Int32) { seed = s; rng = LCG(seed: s); persona = Persona.make(&rng); bootLog() }

    private func bootLog() {
        // Shuffled, not `prefix(7)`: the pool holds 15 authored lines and the first seven
        // were the only ones ever shown (web parity, hud/boot.ts). Drawn from an OWN stream
        // rather than `rng`, so that adding a boot line later shifts these seven and nothing
        // else — the shift's narrative stays put, and the golden re-pin stays explainable.
        var r = LCG(seed: seed &+ 2323)
        for b in shuffledPrefix(Script.boot, 7, &r) {
            lines.append(Line(text: prefix(.status) + b, category: .status))
        }
    }

    // MARK: - public (read by Hud)

    func update(t: Double) {
        if phaseEndsAt < 0 { enterPhase(.routine, t: t) }
        if !foreshadowed && phaseEndsAt > 0 && t >= phaseEndsAt - 6 * durationScale {   // Brick C: foreshadow next scene
            foreshadowed = true
            if let line = sceneForeshadow?(Terminal.nextPhase(phase)) {
                lines.append(Line(text: prefix(.hq) + line, category: .hq))
            }
        }
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

    /// Append a line from outside the beat scheduler (Brick C foreshadow / D combat /
    /// E chatter). A speaker callsign overrides the category prefix (e.g. "[UNIT-A] ").
    func pushLine(_ text: String, _ cat: Cat = .hq, speaker: String? = nil) {
        let pre = speaker.map { "[\($0)] " } ?? prefix(cat)
        lines.append(Line(text: pre + text, category: cat))
        if lines.count > 60 { lines.removeFirst(lines.count - 60) }
    }

    func promptLine(t: Double) -> String {
        let cursor = Int(t * 1.4) % 2 == 0 ? "█" : " "
        return persona.prompt + " " + typed + cursor
    }

    // MARK: - scheduler

    private func processAction(_ a: Action, _ t: Double) -> Bool {
        let el = t - actionStart
        switch a {
        case .type(let s):
            let n = min(s.count, Int(el * cps))
            typed = String(s.prefix(n))
            return n >= s.count && el > Double(s.count) / cps + 0.15
        case .typeErase(let s, let hold):
            let typeDur = Double(s.count) / cps
            if el < typeDur {
                typed = String(s.prefix(Int(el * cps)))
            } else if el < typeDur + hold {
                typed = s
            } else {
                let removed = Int((el - typeDur - hold) * cps * 2.2)
                let keep = max(0, s.count - removed)
                typed = String(s.prefix(keep))
                return keep == 0
            }
            return false
        case .commit(let cat):
            if !typed.isEmpty { addLine(typed, cat) }
            typed = ""; return true
        case .line(let text, let cat):
            addLine(text, cat); return true
        case .wait(let d):
            return el >= d
        }
    }

    private func addLine(_ text: String, _ cat: Cat) {
        lines.append(Line(text: prefix(cat) + subst(text), category: cat))
        if lines.count > 60 { lines.removeFirst(lines.count - 60) }
    }

    private func prefix(_ c: Cat) -> String {
        switch c {
        case .status: return "[OK] "; case .warning: return "[!!] "; case .lore: return "[**] "
        case .quotes: return "› "; case .cmd: return "$ "; case .resp: return "  ↳ "
        case .hq: return "[HQ] "; case .deny: return "[NO] "; case .instr: return "« "; case .ghost: return "  ~ "
        }
    }

    /// Substitute persona tokens into command/response text.
    private func subst(_ s: String) -> String {
        guard s.contains("{") || s.contains("$P") else { return s }
        return s.replacingOccurrences(of: "{node}", with: persona.node)
                .replacingOccurrences(of: "{hqlower}", with: persona.hq.lowercased())
                .replacingOccurrences(of: "{hq}", with: persona.hq)
                .replacingOccurrences(of: "{sector}", with: "7")
                .replacingOccurrences(of: "$P", with: persona.hq)
    }

    // MARK: - phases

    private func dur(_ p: ShiftPhase) -> Double {
        let base: Double
        switch p {
        case .routine: base = rngIn(70, 110); case .intrusion: base = rngIn(110, 160)
        case .alarm: base = rngIn(120, 180); case .panic: base = rngIn(60, 100); case .silence: base = rngIn(25, 45)
        }
        return base * durationScale
    }
    private func phaseRest() -> Double {
        switch phase {
        case .routine: return rngIn(3.5, 6); case .intrusion: return rngIn(2.2, 4.5)
        case .alarm: return rngIn(1.4, 3.2); case .panic: return rngIn(0.6, 1.6); case .silence: return rngIn(2.5, 4.5)
        }
    }
    private func phaseSpeed(_ p: ShiftPhase) -> Double {
        switch p {                                    // faster under adrenaline, slow + defeated in silence
        case .routine, .intrusion: return 1; case .alarm: return 1.11; case .panic: return 1.28; case .silence: return 0.59
        }
    }
    static func nextPhase(_ p: ShiftPhase) -> ShiftPhase {
        switch p {
        case .routine: return .intrusion; case .intrusion: return .alarm
        case .alarm: return .panic; case .panic: return .silence; case .silence: return .routine
        }
    }

    private func enterPhase(_ p: ShiftPhase, t: Double) {
        phase = p; phaseStartedAt = t; phaseEndsAt = t + dur(p); queue.removeAll(); actionStart = -1; restUntil = t
        cps = 26.3 / Double(persona.trait.baseSpeed) * phaseSpeed(p)
        foreshadowed = false
        onPhaseEnter?(p)
    }
    private func advancePhase(_ t: Double) {
        switch phase {
        case .routine: enterPhase(.intrusion, t: t)
        case .intrusion: enterPhase(.alarm, t: t)
        case .alarm: enterPhase(.panic, t: t)
        case .panic: enterPhase(.silence, t: t)
        case .silence:
            lines.removeAll(); typed = ""
            persona = Persona.make(&rng); ghostlinkOpen = false; usedExchanges.removeAll()
            enterPhase(.routine, t: t)
        }
    }

    // MARK: - beats

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
        if rng.nextF() < 0.12 { beatMentor(.routine); return }
        if rng.nextF() < 0.18 {
            queue.append(.line(pick(Script.hqInboundRoutine), .hq))
            queue.append(.wait(rngIn(0.8, 2.2)))
            queue.append(.type(pick(Script.hqReplyRoutine))); queue.append(.commit(.cmd))
            return
        }
        let b = pick(Script.routineBeats)
        queue.append(.type(subst(b.cmd))); queue.append(.wait(rngIn(0.18, 0.44))); queue.append(.commit(.cmd))
        for r in b.resp { queue.append(.wait(rngIn(0.22, 0.44))); queue.append(.line(r.0, r.1)) }
    }

    private func beatIntrusion() {
        if rng.nextF() < 0.22 { beatMentor(.intrusion); return }
        if rng.nextF() < 0.6 {
            let ev = pick(Script.intrusionsQuotes + Script.intrusionsFragments)
            onIntrusion?()
            queue.append(.line(ev.text, .quotes))
            if let f = ev.followup { queue.append(.wait(0.5)); queue.append(.line(f, .quotes)) }
            queue.append(.wait(rngIn(0.9, 2.1)))
            if rng.nextF() < 0.45 {
                let h = pick(Script.hesitations)
                queue.append(.typeErase(h.typed, rngIn(0.35, 0.85)))
                queue.append(.type(h.replacement)); queue.append(.wait(0.22)); queue.append(.commit(.cmd))
            } else {
                queue.append(.type(pick(Script.reactionsFirst))); queue.append(.wait(0.22)); queue.append(.commit(.cmd))
            }
            let r = pick(Script.reactionsFirstResp)
            queue.append(.wait(0.42)); queue.append(.line(r.0, r.1))
        } else { beatRoutine() }
    }

    private func beatAlarm() {
        if rng.nextF() < 0.28 { beatMentor(.alarm); return }
        let c = rng.nextF()
        if c < 0.35 {
            let d = pick(Script.hqEscalationDrafts)
            for draft in d.drafts { queue.append(.typeErase(draft, rngIn(0.4, 0.8))); queue.append(.wait(rngIn(0.2, 0.5))) }
            queue.append(.type(d.final)); queue.append(.wait(0.28)); queue.append(.commit(.cmd))
            let r = pick(Script.hqNonResponses)
            queue.append(.wait(rngIn(0.7, 1.5))); queue.append(.line(r.0, r.1))
        } else if c < 0.7 {
            queue.append(.type(pick(Script.reactionsAlarm))); queue.append(.wait(0.28)); queue.append(.commit(.cmd))
            let r = pick(Script.reactionsAlarmResp)
            queue.append(.wait(0.44)); queue.append(.line(r.0, r.1))
        } else {
            queue.append(.line(pick(Script.intrusionsQuotes).text, .quotes))
        }
    }

    private func beatPanic() {
        if rng.nextF() < 0.22 { beatMentor(.panic); return }
        let c = rng.nextF()
        if c < 0.4 {
            let p = pick(Script.panicDrafts)
            for draft in p.drafts { queue.append(.typeErase(draft, rngIn(0.25, 0.6))); queue.append(.wait(rngIn(0.25, 0.6))) }
            queue.append(.type(p.final)); queue.append(.wait(0.22)); queue.append(.commit(.cmd))
            let r = pick(Script.systemFinal)
            queue.append(.wait(rngIn(0.8, 1.8))); queue.append(.line(r.0, r.1))
        } else if c < 0.75 {
            queue.append(.type(pick(Script.reactionsPanic))); queue.append(.wait(0.18)); queue.append(.commit(.cmd))
            let r = pick(Script.reactionsPanicResp)
            queue.append(.wait(0.36)); queue.append(.line(r.0, r.1))
        } else {
            let n = 2 + Int(rng.nextF() * 2)
            for _ in 0..<n { queue.append(.line(pick(Script.intrusionsQuotes).text, .quotes)); queue.append(.wait(rngIn(0.28, 0.5))) }
        }
    }

    private func beatSilence() {
        if rng.nextF() < 0.5 { queue.append(.type(pick(Script.lastWords))); queue.append(.wait(rngIn(3, 5))) }
        else { queue.append(.line(pick(Script.farewells), .quotes)); queue.append(.wait(rngIn(2.4, 4))) }
    }

    /// Encrypted ghostlink to the former instructor. First call per shift opens
    /// the channel (handshake); each call sends one exchange + a phase-toned reply.
    private func beatMentor(_ phase: ShiftPhase) {
        if !ghostlinkOpen {
            queue.append(.type("ghostlink init --recipient \(Script.mentorName) --priority advisory"))
            queue.append(.wait(0.22)); queue.append(.commit(.cmd))
            let hash = Script.genHash(&rng)
            for line in Script.ghostlinkHandshake {
                queue.append(.wait(rngIn(0.38, 0.8)))
                queue.append(.line(line.replacingOccurrences(of: "<HASH>", with: hash), .ghost))
            }
            ghostlinkOpen = true
            queue.append(.wait(0.7))
        }
        // pick an unused exchange for this phase, else any for this phase
        let idxs = Script.mentorExchanges.indices.filter { Script.mentorExchanges[$0].phase == phase }
        guard !idxs.isEmpty else { return }
        let fresh = idxs.filter { !usedExchanges.contains($0) }
        let pool = fresh.isEmpty ? idxs : fresh
        let i = pool[Int(rng.nextF() * Float(pool.count)) % pool.count]
        usedExchanges.insert(i)
        let ex = Script.mentorExchanges[i]

        queue.append(.type("secure-transmit \"\(ex.out)\"")); queue.append(.wait(0.28)); queue.append(.commit(.cmd))
        let sizeKb = String(format: "%.1f", 0.8 + Double(rng.nextF()) * 1.6)
        for line in Script.ghostlinkTransmit(sizeKb) { queue.append(.wait(rngIn(0.28, 0.56))); queue.append(.line(line, .ghost)) }

        if ex.reply.isEmpty {                                   // silence — the mentor stops answering
            queue.append(.wait(rngIn(7, 11))); queue.append(.line(Script.ghostlinkTimeout, .ghost)); return
        }
        let base: Double = phase == .panic ? 4.5 : phase == .alarm ? 3.2 : 2.2
        queue.append(.wait(base + rngIn(0, 2.5))); queue.append(.line(Script.ghostlinkInbound, .ghost))
        for r in ex.reply { queue.append(.wait(rngIn(0.7, 1.5))); queue.append(.line(r, .instr)) }
    }

    // MARK: - helpers

    private func rngIn(_ lo: Double, _ hi: Double) -> Double { lo + Double(rng.nextF()) * (hi - lo) }
    private func pick<T>(_ a: [T]) -> T { a[Int(rng.nextF() * Float(a.count)) % a.count] }
}

// Per-shift operator persona (persona.ts). Trait drives typing rhythm.
struct Persona {
    let prompt: String
    let designation: String
    let node: String
    let hq: String
    let trait: Trait

    enum Trait {
        case methodical, tense, overworked, rookie
        var baseSpeed: Float {     // multiplier on typing delay (higher = slower)
            switch self { case .methodical: return 1.25; case .tense: return 0.85; case .overworked: return 1.1; case .rookie: return 0.95 }
        }
    }

    private static let roles = ["OFC", "CMP", "AUD", "TEL", "REL"]
    private static let nodes = ["7.2-N04", "7.4-N11", "7.6-N03", "7.4-N02", "7.2-N07", "7.6-N08"]
    private static let hqs = ["COMP-DIV", "AUDIT-DIV", "OPS-TIER", "PAU"]
    private static let traits: [Trait] = [.methodical, .tense, .overworked, .rookie]

    static func make() -> Persona { var r = LCG(seed: freshSeed()); return make(&r) }

    static func make(_ r: inout LCG) -> Persona {
        let role = roles[Int(r.nextF() * 5) % 5]
        let num = 2000 + Int(r.nextF() * 5000)
        let node = nodes[Int(r.nextF() * 6) % 6]
        let hq = hqs[Int(r.nextF() * 4) % 4]
        let trait = traits[Int(r.nextF() * 4) % 4]
        let designation = "\(role)-\(num)"
        return Persona(prompt: "\(designation)@SCT-\(node):~", designation: designation, node: node, hq: hq, trait: trait)
    }
}
