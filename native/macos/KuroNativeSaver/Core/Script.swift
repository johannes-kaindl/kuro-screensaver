// Script — terminal content pools, a faithful representative subset of the web
// script-bank.ts / dictionary.ts (STATUS/WARNING/LORE/QUOTES + command sessions
// verbatim; intrusion/HQ/panic/farewell lines in the same established style).
// Can be expanded verbatim from script-bank.ts later.

import Foundation

enum Script {
    typealias C = Terminal.Cat

    static let status = [
        "SIGNAL CLEAR // SECTOR-9 NOMINAL", "PROTOCOL READER ACTIVE",
        "GHOST RELAY: 14 OPERATIVES ACTIVE", "PERIMETER SCAN CLEAR",
        "NEURAL LATENCY: 1.4MS", "ALL SYSTEMS NOMINAL",
        "COMMS BURST RECEIVED // DECRYPTING", "ANTENNA RELAY // SECTOR 7-F ACTIVE",
        "LIDAR ECHO: NOMINAL", "VECTOR GRID STABLE",
    ]
    static let warnings = [
        "PATTERN BREAK DETECTED // SECTOR-12", "CHROME RAVEN INBOUND // RANGE 2.1KM",
        "HEAT SIG: 3 CONTACTS // ROOFTOP DELTA", "ECM COUNTERMEASURE // ACTIVE",
        "POWER GRID ANOMALY: SECTOR-12 WEST", "HOSTILE UAV: RANGE 2.1KM NORTHEAST",
        "ANOMALY AUDIT QUEUED", "WARNING: UNKNOWN SIGNAL ON SECTOR-7", "TRACE PURGE INITIATED",
    ]

    static let commands: [(cmd: String, resp: [(String, C)])] = [
        ("status --sector 7", [("SECTOR-7 PERIMETER NOMINAL", .resp), ("14 OPERATIVES ACTIVE", .resp)]),
        ("scan --threats", [("0 INTERCEPTS // CORRIDOR CLEAR", .status), ("NEAREST CONTACT 2.1KM N", .resp)]),
        ("ping cronos-7", [("CRONOS-7 RESPONSIVE // 1.4MS", .status)]),
        ("whoami", [("ghost-7 / sector-9 / priv::deep", .resp)]),
        ("route --to anchor-3", [("BEARING 287° // RANGE 4.2KM", .resp), ("ETA 02:14", .resp)]),
        ("kata streak", [("CURRENT STREAK: 14", .resp), ("PATTERN BREAK PROBABILITY: 0.04", .resp)]),
        ("fragment recover --id 04", [("FRAGMENT 04 RECOVERED", .lore), ("CODEX SYNC AT 87.3%", .lore)]),
        ("codex query anchor-doctrine", [("ANCHOR DOCTRINE: HOLDING", .lore), ("NODE COUNT: 2841", .lore)]),
        ("sec --audit perimeter", [("PERIMETER NOMINAL", .status), ("NO BREACH IN 142H", .resp)]),
        ("comms list --active", [("CRONOS-7 (encrypted)", .resp), ("RAVEN (relay)", .resp)]),
    ]

    static let intrusions = [
        "\"THE SIGNAL DOES NOT FORGET.\"", "\"PATTERNS BREAK FOR THOSE WHO READ THEM.\"",
        "WE SEE YOUR RELAY, SECTOR-9.", "YOU LEFT A DOOR OPEN.",
        "\"READ TWICE. STRIKE ONCE.\"", "TRACE LOCK // 47% AND CLIMBING",
        "EVERY KEYSTROKE IS A CONFESSION.", "WE HAVE YOUR HANDLER LOG.",
        "GHOST-7. WE KNOW THE NAME.", "ANCHOR WILL NOT HOLD.",
    ]
    static let reactions = [
        "trace --source", "lockdown --sector 9", "comms --kill relay",
        "purge --logs", "anchor --reinforce", "scan --deep", "evade --pattern", "isolate --node",
    ]
    static let hqInbound = [
        "HQ: REPORT STATUS SECTOR-9", "HQ: ESCALATE OR HOLD?", "HQ: CHROME RAVEN AUTHORIZED",
        "HQ: DO NOT ENGAGE", "HQ: AUDIT-DIV REQUESTS LOG",
    ]
    static let panicCmds = [
        "abort --all", "purge --everything", "comms --kill", "anchor --emergency",
        "lockdown --total", "wipe --session", "help",
    ]
    static let systemFinal = [
        "AUTH CASCADE FAILURE", "RELAY SEVERED // GHOST DARK", "TRACE COMPLETE // POSITION KNOWN",
        "ANCHOR LOST", "SYSTEM PURGE 91%", "NO CARRIER",
    ]
    static let farewells = [
        "keep it low.", "tell raven i read the pattern.", "it doesn't matter.",
        "going dark.", "the signal does not forget.", "... nevermore.",
    ]

    static let boot = [
        "CRONOS-7 BIOS v5.1.0", "NEURAL UPLINK // GHOST RELAY ESTABLISHED",
        "PROCEDURAL GEOMETRY ENGINE // SEEDED", "SECTOR-7 PERIMETER NOMINAL",
        "CODEX MATRIX // 2841 NODES SYNCED", "ANCHOR DOCTRINE LOADED",
        "CHROME RAVEN PROTOCOL // STANDBY", "OBSIDIAN VAULT INTERFACE",
        "WILDCARD PROTOCOL ARMED", "MIRROR REWRITE STAGED",
    ]
}
