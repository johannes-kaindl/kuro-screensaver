// Script — the COMPLETE terminal content, ported from the web
// engine/terminal/script-bank.ts (CORP operator's shift: ROUTINE→INTRUSION→
// ALARM→PANIC→SILENCE) plus the INSTR-KARSEN mentor/ghostlink backchannel.
// Command strings carry persona tokens ({node},{hq},{hqlower},{sector}); the
// Terminal substitutes them at runtime. "$P" in a response → persona.hq.

import Foundation

/// Narrative phase (shared by Terminal + the mentor exchange tags).
enum ShiftPhase { case routine, intrusion, alarm, panic, silence }

enum Script {
    typealias C = Terminal.Cat
    struct Beat { let cmd: String; let resp: [(String, C)] }
    struct Intrusion { let text: String; let followup: String? }
    struct Drafts { let drafts: [String]; let final: String }
    struct MentorExchange { let out: String; let reply: [String]; let phase: ShiftPhase }

    // ── PHASE 1: ROUTINE — calm, professional status checks ──────────────────
    static let routineBeats: [Beat] = [
        Beat(cmd: "harmonization-cli status --node {node}",
             resp: [("ENGINE v4.1 NOMINAL", .status), ("INTERCEPT RATE 94.2%", .status)]),
        Beat(cmd: "audit-cli list --window 24h --tier informational",
             resp: [("7 events in window", .resp), ("5 auto-resolved", .resp), ("2 pending classification", .resp)]),
        Beat(cmd: "pattern-analysis check --baseline q1-2047",
             resp: [("BASELINE STABLE", .status), ("p > 0.05 — within tolerance", .status)]),
        Beat(cmd: "relay-cluster query --node {node} --metrics rate,latency",
             resp: [("CLUSTER NOMINAL", .status), ("NEXT MAINT WINDOW: 03:00 UTC", .resp)]),
        Beat(cmd: "workforce-opt status --queue active",
             resp: [("ALL CASES PROCESSING", .status), ("12 reclassifications scheduled", .resp)]),
        Beat(cmd: "telemetry flush --window 1h", resp: [("BUFFER FLUSHED // 14.2 MB", .status)]),
        Beat(cmd: "comms ping --tier hq", resp: [("HQ RESPONSIVE // 1.4MS", .status)]),
        Beat(cmd: "transmit {hqlower} -- nominal", resp: [("TRANSMITTED // CHECKSUM OK", .status)]),
        Beat(cmd: "secure-transmit --tier {hqlower} --priority routine \"shift change confirmed\"",
             resp: [("ENCRYPTED // 1.4 KB", .status), ("DELIVERY ACK", .status)]),
        Beat(cmd: "compliance-rate --window 24h --sector 7", resp: [("94.7% — within target", .status)]),
        Beat(cmd: "endpoint scan --sector {sector} --depth shallow",
             resp: [("847 endpoints scanned", .resp), ("0 flagged", .resp), ("NO LEGACY-PROTOCOL ACTIVITY", .status)]),
        Beat(cmd: "corpsh log --tail 20 --since 1h",
             resp: [("engine.harmonization v4.1 — heartbeat", .resp), ("relay-7.4 sync ok", .resp), ("audit-stream — flushed", .resp)]),
        Beat(cmd: "report file --to {hqlower} --status nominal",
             resp: [("REPORT FILED", .status), ("$P acknowledged", .resp)]),
        Beat(cmd: "pattern-analysis sigtest --window 14d",
             resp: [("CHI-SQUARE 0.087", .status), ("no anomalous skew", .resp)]),
    ]
    static let hqInboundRoutine = [
        "shift roll: confirm presence", "q2 audit window opens 06-26 03:00 utc",
        "relay 7.4-N02 maintenance complete", "rotate credentials by 0400 utc",
        "reminder: legacy-protocol incidents tier-2 escalation",
    ]
    static let hqReplyRoutine = ["present", "ack", "confirmed", "noted", "on it"]

    // ── PHASE 2: FIRST INTRUSION ─────────────────────────────────────────────
    static let intrusionsQuotes: [Intrusion] = [
        Intrusion(text: "\"the work is the answer\"", followup: nil),
        Intrusion(text: "\"keep it low.\" — ghost-7", followup: nil),
        Intrusion(text: "\"read twice. strike once.\" — raven", followup: nil),
        Intrusion(text: "\"patterns break for those who read them\"", followup: nil),
        Intrusion(text: "\"the signal does not forget\"", followup: nil),
        Intrusion(text: "\"efficiency is another word for silence\"", followup: nil),
        Intrusion(text: "\"this document was not written. it was generated.\"", followup: nil),
        Intrusion(text: "one word. that's all you get.", followup: nil),
        Intrusion(text: "you remember the cold path.", followup: nil),
        Intrusion(text: "the work is the answer.", followup: nil),
        Intrusion(text: "silence is not acknowledgement.", followup: nil),
        Intrusion(text: "i taught them the cold path. i know they remember it.", followup: nil),
    ]
    static let intrusionsFragments: [Intrusion] = [
        Intrusion(text: "> [recovered fragment // origin: unknown]", followup: "> \"broadcast open. whoever finds this...\""),
        Intrusion(text: "> from: WRAITH. one line. no reply.", followup: "> \"if your cover is thinning, say so.\""),
        Intrusion(text: "> handler-tier transmission ends.", followup: nil),
        Intrusion(text: "> [pre-cascade archive — 2029-08-03]", followup: "> \"it's not shortcuts, it's a language.\""),
        Intrusion(text: "> NEVERMORE noise pattern detected — UNHARMONIZED", followup: nil),
    ]
    static let reactionsFirst = [
        "audit log --recent 50", "harmonization rerun --target last",
        "pattern --analyze --window 5m", "dmesg | grep WARN", "relay-cluster status",
    ]
    static let reactionsFirstResp: [(String, C)] = [
        ("INJECTION DETECTED — origin unknown", .warning), ("NEVERMORE pattern // UNREGISTERED", .warning),
        ("0 matching workforce records", .resp), ("engine output // anomalous run detected", .resp),
        ("no upstream flag — local insert?", .warning),
    ]
    static let hesitations: [(typed: String, replacement: String)] = [
        ("what was that", "audit log --tail"),
        ("did anyone else see", "pattern --check"),
        ("this isn't in the manual", "manual lookup --topic injection"),
        ("something's off", "dmesg | tail"),
        ("maybe i'm misreading", "audit log --recent 10"),
        ("i should escalate", "comms ping hq"),
        ("should i flag this", "flag --severity low"),
    ]

    // ── PHASE 3: ALARM ───────────────────────────────────────────────────────
    static let reactionsAlarm = [
        "purge --line last", "harmonization rerun --hard", "pattern --analyze --deep",
        "sec --audit endpoint self", "comms escalate --tier 2", "firewall reset --partial",
    ]
    static let reactionsAlarmResp: [(String, C)] = [
        ("PURGE QUEUED", .resp), ("INJECTION RECURS — same byte signature", .warning),
        ("COMMAND DENIED // ROOT COMPROMISE", .deny), ("pattern concordance: cross-file match", .warning),
        ("endpoint integrity check FAILED", .warning), ("ESCALATION REJECTED // CHANNEL UNAUTHORIZED", .deny),
    ]
    static let hqEscalationDrafts: [Drafts] = [
        Drafts(drafts: ["unauthorized injection in sector feed possible compromise need",
                        "unauthorized injection sector 7 possible compromise",
                        "sector 7 anomaly possible"],
               final: "sector 7 anomaly. requesting tier-2 review."),
        Drafts(drafts: ["something is wrong with the harmonization engine output",
                        "engine output anomaly cross-file pattern",
                        "engine v4.1 output integrity question"],
               final: "engine v4.1 output integrity flag. tier-2 review."),
        Drafts(drafts: ["i think we have a problem in sector 7 the engine",
                        "sector 7 engine v4.1 — recurring injection",
                        "sector 7 — possible NEVERMORE drift"],
               final: "possible NEVERMORE drift sector 7. confirm protocol."),
    ]
    static let hqNonResponses: [(String, C)] = [
        ("TICKET FILED // ID 7734-Δ-04891", .warning), ("AUTOMATED ACK // QUEUED FOR REVIEW", .warning),
        ("response time non-guaranteed for non-priority", .resp), ("no human reviewer assigned at this tier", .warning),
        ("HQ silent.", .resp),
    ]

    // ── PHASE 4: PANIC ───────────────────────────────────────────────────────
    static let reactionsPanic = [
        "sec --lockdown self", "comms --emergency hq", "disconnect --force",
        "sudo purge", "kill --all sessions", "help", "who is doing this",
    ]
    static let reactionsPanicResp: [(String, C)] = [
        ("COMMAND DENIED", .deny), ("PERMISSION ESCALATION REFUSED", .deny),
        ("PROTOCOL LOCK ENGAGED", .warning), ("CONNECTION HOLD — DO NOT TERMINATE", .deny), ("no.", .deny),
    ]
    static let panicDrafts: [Drafts] = [
        Drafts(drafts: ["help", "help me", "someone"], final: "help"),
        Drafts(drafts: ["compromise sector 7", "compromise", "comp"], final: "compromise"),
        Drafts(drafts: ["i need extraction", "extraction sector 7", "extract"], final: "extract"),
        Drafts(drafts: ["who is this", "who are you", "why are you"], final: "who"),
    ]
    static let systemFinal: [(String, C)] = [
        ("CONNECTION INTEGRITY: DEGRADED", .warning), ("OUTBOUND COMMS BLOCKED", .deny),
        ("WORKFORCE OPTIMIZATION REVIEW SCHEDULED", .warning),
        ("CHROME RAVEN PROTOCOL // YOU ARE NOT THE OPERATOR", .warning),
        ("SESSION TERMINATED // SUBJECT FLAGGED", .warning),
    ]

    // ── PHASE 5: SILENCE ─────────────────────────────────────────────────────
    static let farewells = [
        "> you should have used the cold path.", "> the work is the answer.",
        "> \"keep it low.\" — ghost-7", "> the signal does not forget.",
        "> [TRANSMISSION ENDS]", "> goodnight, officer.",
    ]
    static let lastWords = [
        "i was just running through the final wait someone's at the door and that",
        "tell my", "who are y", "no n", "why",
    ]

    // ── MENTOR — INSTR-KARSEN, encrypted ghostlink backchannel ───────────────
    static let mentorName = "INSTR-KARSEN"
    static let ghostlinkHandshake = [
        "handshake initiated", "key exchange: ECDH-P384 ........ OK",
        "session hash: <HASH>", "tunnel established // recipient acknowledged",
    ]
    static let ghostlinkInbound = "inbound // INSTR-KARSEN"
    static let ghostlinkTimeout = "no response."

    static func genHash(_ rng: inout LCG) -> String {
        let c = Array("abcdef0123456789"); var s = ""
        for i in 0..<16 { s.append(c[Int(rng.nextF() * 16) % 16]); if (i + 1) % 4 == 0 && i < 15 { s += "-" } }
        return s
    }
    static func ghostlinkTransmit(_ sizeKb: String) -> [String] {
        ["encrypted (\(sizeKb) KB) → \(mentorName)", "delivery: pending"]
    }

    static let mentorExchanges: [MentorExchange] = [
        // ROUTINE — friendly check-ins
        MentorExchange(out: "shift opened. quiet so far.", reply: ["copy.", "enjoy it while it lasts."], phase: .routine),
        MentorExchange(out: "q2 audit window opens monday. anything to know?", reply: ["watch the relay timing.", "baseline drift means questions you can't answer."], phase: .routine),
        MentorExchange(out: "do you remember the sector seven thing from training?", reply: ["yes.", "why."], phase: .routine),
        MentorExchange(out: "how are you", reply: ["working.", "work is the answer."], phase: .routine),
        MentorExchange(out: "rotation starts thursday. cover holding fine.", reply: ["good.", "eat something today."], phase: .routine),
        // INTRUSION — first concerns
        MentorExchange(out: "seeing strings in the harmonization output that aren't in the spec.", reply: ["describe."], phase: .intrusion),
        MentorExchange(out: "looks like text. fragments. maybe injection.", reply: ["log it.", "don't engage.", "capture pattern before any purge."], phase: .intrusion),
        MentorExchange(out: "is this what we covered in module 14?", reply: ["no.", "module 14 is theory.", "this is a different thing."], phase: .intrusion),
        MentorExchange(out: "inter-injection distance is wrong", reply: ["p value?", "how many windows."], phase: .intrusion),
        MentorExchange(out: "i think this is signed", reply: ["by whom."], phase: .intrusion),
        // ALARM — guarded
        MentorExchange(out: "they keep coming back. same byte signature.", reply: ["then it's deliberate.", "someone is talking to you.", "be careful what you answer."], phase: .alarm),
        MentorExchange(out: "should i tell hq", reply: ["hq is automated at this hour.", "wait until thursday.", "and not from this terminal."], phase: .alarm),
        MentorExchange(out: "i think my session is compromised", reply: ["if it is, this channel is too.", "sit. breathe. read."], phase: .alarm),
        MentorExchange(out: "i'm about to escalate", reply: ["to whom."], phase: .alarm),
        MentorExchange(out: "the engine is lying to me", reply: ["the engine has always been lying.", "the question is who's listening now."], phase: .alarm),
        MentorExchange(out: "tell me what to do", reply: ["nothing fast.", "nothing recorded.", "nothing from there."], phase: .alarm),
        // PANIC — final warnings, then silence
        MentorExchange(out: "they know my designation", reply: ["they always did."], phase: .panic),
        MentorExchange(out: "help", reply: ["route the question through the right channel.", "not this one.", "i taught you the cold path."], phase: .panic),
        MentorExchange(out: "please", reply: ["i'm sorry."], phase: .panic),
        MentorExchange(out: "are you still there", reply: [], phase: .panic),
        MentorExchange(out: "karsen", reply: [], phase: .panic),
    ]

    // ── Boot log (shown at power-on) ─────────────────────────────────────────
    static let boot = [
        "CRONOS-7 BIOS v5.1.0", "NEURAL UPLINK // GHOST RELAY ESTABLISHED",
        "PROCEDURAL GEOMETRY ENGINE // SEEDED", "SECTOR-7 PERIMETER NOMINAL",
        "CODEX MATRIX // 2841 NODES SYNCED", "ANCHOR DOCTRINE LOADED",
        "CHROME RAVEN PROTOCOL // STANDBY", "OBSIDIAN VAULT INTERFACE",
        "WILDCARD PROTOCOL ARMED", "MIRROR REWRITE STAGED",
    ]
}
