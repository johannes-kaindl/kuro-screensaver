// District — the baked OpenStreetMap district the METRO scene renders.
//
// The JSON is shared verbatim with the web engine (src/engine/data/osm-district.json)
// and is BAKED AT BUILD TIME by scripts/bake-osm-district.mjs — it is never fetched.
// That is a hard architectural rule, not a preference: the screensaver must run fully
// offline and the Windows .scr bundle has a <5 MB budget (AGENTS.md § Architecture
// notes). Do not add a runtime download here or anywhere downstream.
//
// Loading mirrors StoryContent: `Bundle.main.url(forResource:)`, which resolves to
// Contents/Resources inside KuroMetalApp.app and to the executable's own directory for
// the bare CLI binaries — all three build scripts drop the file there.
//
// Map data © OpenStreetMap contributors, ODbL 1.0
// (https://www.openstreetmap.org/copyright).

import Foundation

struct District: Decodable {
    struct Meta: Decodable {
        /// Decimetres → metres (0.1). The ring coordinates are stored as integers.
        let scale: Double
        /// Extent along Z in metres — the METRO tile length is derived from it so the
        /// district tiles at TRUE scale instead of being squashed into a fixed tile.
        let spanZ: Double
        let attribution: String?
    }

    /// One building: height in metres, ring in delta-encoded decimetres.
    struct Footprint: Decodable {
        let h: Double
        let r: [Int]
    }

    let meta: Meta
    let footprints: [Footprint]

    /// Parsed once at first use. A missing or malformed resource is a build error, not a
    /// runtime condition — same stance as StoryContent: fail loudly rather than ship a
    /// METRO scene with an empty city in it.
    static let shared: District = load()

    static func load() -> District {
        guard let url = Bundle.main.url(forResource: "osm-district", withExtension: "json") else {
            fatalError("osm-district.json not found next to the executable (\(Bundle.main.bundlePath))")
        }
        do {
            return try JSONDecoder().decode(District.self, from: Data(contentsOf: url))
        } catch {
            fatalError("osm-district.json failed to decode: \(error)")
        }
    }
}
