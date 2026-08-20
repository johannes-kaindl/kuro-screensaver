// StoryContent — the narrative/content SSOT, decoded from story-content.json.
//
// The JSON is shared verbatim with the web engine (src/engine/data/story-content.json);
// it is the single source for beats, mentor exchanges, dictionaries, presets and arcs, so
// a story line is authored once instead of twice (see AGENTS.md § the Swift twin).
//
// Loading: `Bundle.main.url(forResource:)`. Inside KuroMetalApp.app that resolves to
// Contents/Resources; for the bare CLI binaries (tests, harness) Bundle.main is the
// executable's own directory — the build scripts drop the JSON there. One code path,
// no environment variables, no absolute paths.

import Foundation

struct StoryContent: Decodable {
    struct Accent: Decodable {
        let color: String
        let rgb: String
    }

    struct Preset: Decodable {
        let id: String
        let label: String
        let kanji: String
        let darkAccent: Accent
        let lightAccent: Accent
        let glowIntensity: Double
        let scanlineOpacity: Double
        let vignetteStrength: Double
    }

    // --- terminal beats ------------------------------------------------------
    struct Line: Decodable {          // a rendered terminal line: category + text
        let cat: String
        let text: String
    }
    /// A command response is a union in the shared schema (`script-bank.ts:21`):
    /// a bare string, or `{cat, text}`. Bare lines carry no category prefix.
    struct Response: Decodable {
        let cat: String?
        let text: String

        private enum CodingKeys: String, CodingKey { case cat, text }

        init(from decoder: Decoder) throws {
            if let bare = try? decoder.singleValueContainer().decode(String.self) {
                cat = nil
                text = bare
                return
            }
            let o = try decoder.container(keyedBy: CodingKeys.self)
            cat = try o.decodeIfPresent(String.self, forKey: .cat)
            text = try o.decode(String.self, forKey: .text)
        }
    }
    /// Operator command with its responses. Same shape for shift beats and the
    /// idle `commandSessions` pool.
    struct Command: Decodable {
        let cmd: String
        let resp: [Response]
    }
    struct Quote: Decodable {          // intrusion quote, arc-filterable by tags
        let text: String
        let tags: [String]
    }
    /// Intrusion fragment. Both `followup` and `tags` are genuinely absent on some
    /// entries — an untagged beat is eligible under every arc (`arc.ts:47`).
    struct Fragment: Decodable {
        let text: String
        let followup: String?
        let tags: [String]?
    }
    struct Hesitation: Decodable {     // typed-then-replaced line (operator second-guessing)
        let typed: String
        let replacement: String
    }
    struct Drafted: Decodable {        // successive drafts before a final, sent message
        let drafts: [String]
        let final: String
    }
    struct LastWord: Decodable {       // closing line, abandoned mid-typing at a ratio
        let typed: String
        let abandonAt: Double
    }

    struct Beats: Decodable {
        let routine: [Command]
        let hqInboundRoutine: [String]
        let hqReplyRoutine: [String]
        let intrusionsQuotes: [Quote]
        let intrusionsFragments: [Fragment]
        let reactionsFirst: [String]
        let reactionsFirstResp: [Line]
        let hesitations: [Hesitation]
        let reactionsAlarm: [String]
        let reactionsAlarmResp: [Line]
        let hqEscalationDrafts: [Drafted]
        let hqNonResponses: [Line]
        let reactionsPanic: [String]
        let reactionsPanicResp: [Line]
        let panicDrafts: [Drafted]
        let systemFinal: [Line]
    }

    // --- mentor / film / chatter ---------------------------------------------
    struct Mentor: Decodable {
        struct Exchange: Decodable {
            let phase: String
            let out: String
            let reply: [String]
        }
        let name: String
        let handshake: [String]
        let exchanges: [Exchange]
    }

    struct Film: Decodable {
        let foreshadow: [String: [String]]   // keyed by scene id
        let arrival: [String: [String]]
        let combat: [String: [String]]       // keyed by event kind
    }

    struct ChatterLine: Decodable {          // one radio turn inside an exchange
        let speaker: String
        let category: String
        let text: String
    }

    struct Boot: Decodable {
        let lines: [String]
        let headers: [String: String]        // keyed by scene id
    }

    // --- arcs ----------------------------------------------------------------
    struct Arc: Decodable {
        struct MentorRef: Decodable {
            let name: String
            let availablePhases: [String]
        }
        struct BeatTags: Decodable {
            let include: [String]?
            let exclude: [String]?
        }
        struct SceneWeight: Decodable {
            let scene: String
            let weight: Double
        }
        struct Ending: Decodable {
            struct Divert: Decodable {
                let atStage: Int
                let to: String
            }
            let `default`: String
            let divertOnThreat: [Divert]?
        }
        let id: String
        let weight: Double
        let antagonist: String
        let mentor: MentorRef?               // null = arc runs without a mentor
        let phaseRouting: [String: String]?
        let durationScale: [String: Double]?
        let beatTags: BeatTags
        let scenes: [String: [SceneWeight]]?
        let threatCurve: [String: [Double]]?
        let ending: Ending
    }

    struct Endings: Decodable {
        let farewells: [String: [String]]    // keyed by ending id
        let lastWords: [String: [LastWord]]
    }

    let schemaVersion: Int
    let beats: Beats
    let mentor: Mentor
    let film: Film
    let presets: [Preset]
    let boot: Boot
    let terminalDicts: [String: [String]]
    let hudHandles: [String]
    let modeLabels: [String: [String]]
    let flashPhrases: [String]
    let alertPhrases: [String]
    let commandSessions: [Command]
    let endings: Endings
    let arcs: [Arc]
    let chatter: [String: [[ChatterLine]]]   // pool key → exchanges → turns

    /// Parsed once at first use. A missing or malformed resource is a build error, not a
    /// runtime condition — fail loudly rather than ship a saver with no words in it.
    static let shared: StoryContent = load()

    static func load() -> StoryContent {
        guard let url = Bundle.main.url(forResource: "story-content", withExtension: "json") else {
            fatalError("story-content.json not found next to the executable (\(Bundle.main.bundlePath))")
        }
        do {
            return try JSONDecoder().decode(StoryContent.self, from: Data(contentsOf: url))
        } catch {
            fatalError("story-content.json failed to decode: \(error)")
        }
    }
}
