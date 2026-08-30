// Assert-based logic tests for the renderer Core. Run via
// scripts/run-native-tests.sh — exits non-zero if any assertion fails.
// Reference values for LCG + height computed from the web engine (Python/JS).

import Foundation
import simd
import Metal

var failures = 0
func check(_ cond: Bool, _ msg: String) {
    if cond { print("ok   - \(msg)") } else { print("FAIL - \(msg)"); failures += 1 }
}
func approx(_ a: Double, _ b: Double, _ tol: Double, _ msg: String) {
    check(abs(a - b) <= tol, "\(msg) (got \(a), want \(b), tol \(tol))")
}

// --- LCG: bit-for-bit vs web mkRng -----------------------------------------
do {
    var r = LCG(seed: 1)
    let exp1 = [0.236455525271595, 0.369270673720166, 0.504242032300681,
                0.704883263679221, 0.050543628633022]
    for (i, e) in exp1.enumerated() { approx(r.next(), e, 1e-12, "LCG seed1 [\(i)]") }

    var r2 = LCG(seed: 1337)
    let exp2 = [0.754225567914546, 0.549500931752846, 0.274493878241628,
                0.158748119371012, 0.449464006349444]
    for (i, e) in exp2.enumerated() { approx(r2.next(), e, 1e-12, "LCG seed1337 [\(i)]") }
}

// --- terrain height field vs web heightAt ----------------------------------
do {
    approx(Double(terrainHeight(0, 0)), 1.8, 2e-3, "height(0,0)")
    approx(Double(terrainHeight(5, -12)), -2.702330068427646, 2e-3, "height(5,-12)")
    approx(Double(terrainHeight(-3.5, 7.25)), -0.873893886150996, 2e-3, "height(-3.5,7.25)")
}

// --- camera FOV breakpoints -------------------------------------------------
do {
    check(Camera.defaultFovDeg(width: 2560, height: 1440) == 62, "fov 16:9 = 62")
    check(Camera.defaultFovDeg(width: 600, height: 800) == 95, "fov portrait = 95")
    check(Camera.defaultFovDeg(width: 1280, height: 1024) == 72, "fov ~5:4 = 72")
}

// --- terrain seam continuity ------------------------------------------------
do {
    check(abs(Terrain.startB - Terrain.startA) == Terrain.D, "|startB-startA| == D")
    let la = Terrain.startA, lb = Terrain.startB
    // The meeting edges sample the SAME logical z: (-90 + la) == (90 + lb).
    for x: Float in [-50, -10, 0, 10, 50] {
        approx(Double(terrainHeight(x, -90 + la)),
               Double(terrainHeight(x, 90 + lb)), 1e-6, "seam continuity x=\(x)")
    }
    // After a wrap (both offsets -= 2D) the relation still holds.
    let la2 = la - 2 * Terrain.D, lb2 = lb - 2 * Terrain.D
    approx(Double(terrainHeight(0, -90 + la2)),
           Double(terrainHeight(0, 90 + lb2)), 1e-6, "seam continuity after wrap")
}

// --- palette sanity ---------------------------------------------------------
do {
    check(Palette.presets.count == 13, "13 presets")
    let p = Palette.preset("phosphor")
    check(p.accentHex == 0x39ff7a, "phosphor accent hex")
    // glow*4 = 2.8, capped at 1.8 (2026-06-03 colour tuning — keeps the hue vs blowing to white)
    approx(Double(p.bloomStrength), 1.8, 1e-6, "phosphor bloomStrength (capped at 1.8)")
    check(Palette.preset("nope").id == "toxic-haze", "unknown preset falls back to toxic-haze")
}

// --- scene registry ---------------------------------------------------------
// Guards against scene drift (e.g. a scene added to the web SCENE_REGISTRY but not
// here, or vice versa). Keep in sync with src/engine/engine/core.ts SCENE_REGISTRY.
do {
    check(SceneRegistry.ids.count == 7, "7 scenes (+ wreckage)")
    check(Set(SceneRegistry.ids).count == SceneRegistry.ids.count, "scene ids unique")
    check(SceneRegistry.ids.contains("matrix"), "matrix scene registered")
}

// --- FlightDirector: envelope math (mirrors src/engine/modes/flight-director.ts) --
// sin²(πp): value AND slope are 0 at both ends, peak 1 at the middle → no roll snap.
do {
    approx(Double(FlightDirector.envelope(0.0)), 0.0, 1e-12, "env(0)=0")
    approx(Double(FlightDirector.envelope(1.0)), 0.0, 1e-12, "env(1)=0")
    approx(Double(FlightDirector.envelope(0.5)), 1.0, 1e-9,  "env(0.5)=1")
    check(FlightDirector.envelope(0.001) < 1e-3, "env slope→0 at start")
    check(FlightDirector.envelope(0.999) < 1e-3, "env slope→0 at end")
}

// --- FlightDirector: same seed ⇒ identical kick result (the regenerating film) ----
do {
    let a = FlightDirector(seed: 1337); let b = FlightDirector(seed: 1337)
    a.enqueue(Manoeuvre(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    b.enqueue(Manoeuvre(kind: .kick, dur: 1.0, dir: 0, intensity: 0.55))
    var ca = Camera(); ca.position.x = 1
    var cb = Camera(); cb.position.x = 1
    for _ in 0..<10 { a.update(t: 0, dt: 0.05); a.apply(&ca); b.update(t: 0, dt: 0.05); b.apply(&cb) }
    approx(Double(ca.position.x), Double(cb.position.x), 1e-12, "director deterministic x")
    check(ca.position.x < 1.0, "kick dampened cam.x")
}

// --- FlightDirector warp transition: stage clock, ramp C1, swap-once ------------
do {
    let d = FlightDirector(seed: 7)
    var swaps = 0
    let p = TransitionProfile(windupDur: 0.5, warpDur: 1.0, emergeDur: 0.5,
                              warpSpeed: 6, fovPush: 30)
    d.beginTransition(p, baseFov: 72) { swaps += 1 }
    check(d.inTransition, "inTransition true after begin")
    var maxSpeed: Float = 0
    for _ in 0..<100 { d.update(t: 0, dt: 0.02); maxSpeed = max(maxSpeed, d.speedMul) }  // 2.0s total
    check(swaps == 1, "swap fired exactly once")
    check(maxSpeed > 5.5 && maxSpeed <= 6.0, "speedMul ramped to ~warpSpeed")
    check(!d.inTransition, "inTransition false after total duration")
    approx(Double(d.speedMul), 1.0, 1e-6, "speedMul back to 1 after transition")
}

// --- FilmDirector: deterministic, tier-matched, no immediate repeat ---------------
do {
    let f = FilmDirector(seed: 99)
    let cands: [ShiftPhase: [String]] = [
        .routine: ["terrain","city"], .intrusion: ["city","rift"], .alarm: ["rift","tunnel"],
        .panic: ["tunnel","void"], .silence: ["void"]]
    let a = f.sceneAt(3, phase: .alarm, prev: nil)
    let b = FilmDirector(seed: 99).sceneAt(3, phase: .alarm, prev: nil)
    check(a == b, "FilmDirector deterministic")
    check(cands[.alarm]!.contains(a), "alarm pick in candidates")
    let prev = f.sceneAt(5, phase: .intrusion, prev: nil)
    let nextPick = f.sceneAt(5, phase: .intrusion, prev: prev)
    check(nextPick != prev, "no immediate repeat when alt exists")
}

// --- CombatDirector: actors gated off (2026-06-05) — no spawn ---------------------
if let device = MTLCreateSystemDefaultDevice() {
    var n = 0
    let host = ActorHost(device: device, add: { _ in n += 1 }, accentRGB: { SIMD3(0, 1, 0) }, enemyRGB: { SIMD3(1, 0, 0.25) })
    let c = CombatDirector(seed: 5, bus: EventBus(), host: host)
    c.update(t: 1, threat: 0.9)
    check(n == 0, "combat actors gated off — no spawn (re-enable to test thresholds)")
} else {
    print("ok   - (combat test skipped — no Metal device)")
}

// --- Terminal: foreshadow lead scales with durationScale (web parity narrative.ts:157) ----
// Pre-fix the lead was a hardcoded `- 6` seconds while dur() didn't scale at all; with a
// scaled phase the foreshadow would fire at the wrong elapsed fraction (web↔native desync).
do {
    let term = Terminal(seed: 42)
    term.durationScale = 0.1                 // routine phase ~7-11s, foreshadow ~0.6s before end
    var firedAtProgress: Double = -1
    var fired = false
    term.sceneForeshadow = { _ in fired = true; return "x" }
    var t = 0.0
    while t < 60 && firedAtProgress < 0 {
        term.update(t: t)
        if fired && firedAtProgress < 0 { firedAtProgress = term.phaseProgress(t) }
        t += 0.05
    }
    check(firedAtProgress > 0.90 && firedAtProgress < 0.99,
          "foreshadow fires ~0.6s (scaled) before phase end, not hardcoded 6s (got progress \(firedAtProgress))")
}

// --- Terminal: deterministic golden stream (additive-invariant guard for arc work) ---
// A fixed seed + tiny durationScale drives several phases fast; we FNV-1a-hash the
// visible line stream. Slice 2 (arc layer) must keep this byte-identical when no arc
// is selected. Capture step prints; the assertion below pins count+hash.
// Re-pinned 2026-08-21 when Script.boot became an SSOT facade: the first 7 lines are boot
// lines, and the shared pool differs from the old hand-copied literals (15 lines, `" ... "`
// filler). Verified line-by-line that ONLY those 7 changed — the other 5 stayed identical.
do {
    let term = Terminal(seed: 1337)
    term.durationScale = 0.05
    let persona0 = term.promptLine(t: 0)              // persona is fixed at init (seed-derived)
    var t = 0.0
    while t < 12 { term.update(t: t); t += 0.02 }
    let visible = term.visibleLines(max: 60).map { $0.text }
    var h: UInt64 = 1469598103934665603
    for byte in visible.joined(separator: "\n").utf8 { h = (h ^ UInt64(byte)) &* 1099511628211 }
    check(visible.count == 12 && h == 3190464026768004751,
          "golden narrative stream stable (got count \(visible.count) hash \(h))")
    check(persona0 == "TEL-4747@SCT-7.4-N11:~ █", "golden persona stable (got \(persona0))")
}

// --- wallpaper render policy (pure decision table) --------------------------
do {
    var i = RenderPolicyInputs()
    check(renderState(i) == .animating(fps: 30), "policy default AC → 30fps")
    i.onBattery = true
    check(renderState(i) == .frozen, "policy battery default → frozen")
    i.animateOnBattery = true
    check(renderState(i) == .animating(fps: 10), "policy battery opt-in → 10fps")
    i = RenderPolicyInputs(); i.lowPowerMode = true
    check(renderState(i) == .frozen, "policy low-power behaves like battery")
    i.animateOnBattery = true
    check(renderState(i) == .animating(fps: 10), "policy low-power opt-in → 10fps")
    i = RenderPolicyInputs(); i.thermalSerious = true
    check(renderState(i) == .animating(fps: 10), "policy thermal serious → 10fps on AC")
    i.thermalCritical = true
    check(renderState(i) == .frozen, "policy thermal critical → frozen")
    i = RenderPolicyInputs(); i.onBattery = true; i.animateOnBattery = true; i.thermalCritical = true
    check(renderState(i) == .frozen, "policy critical beats battery opt-in")
    i = RenderPolicyInputs(); i.occluded = true; i.animateOnBattery = true
    check(renderState(i) == .hidden, "policy occluded beats everything")
    i = RenderPolicyInputs(); i.screenLocked = true
    check(renderState(i) == .hidden, "policy locked → hidden")
    i = RenderPolicyInputs(); i.screensAsleep = true
    check(renderState(i) == .hidden, "policy display sleep → hidden")
}

// --- desktop coverage (replaces the unusable NSWindow.occlusionState) -------
do {
    let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)

    check(isDesktopCovered(by: [], screen: screen) == false,
          "coverage: empty window list → not covered")

    // REGRESSION 2026-08-19: the desktop's own layers sit BELOW level 0. If they
    // counted, the wallpaper would consider itself covered by the icons it draws
    // behind — which is exactly the black-desktop bug this replaces.
    let desktopLevel = -2147483623, wallpaperLevel = desktopLevel + 1, iconLevel = -2147483603
    let ownLayers = [CoveringWindow(level: wallpaperLevel, bounds: screen),
                     CoveringWindow(level: iconLevel, bounds: screen)]
    check(isDesktopCovered(by: ownLayers, screen: screen) == false,
          "coverage: wallpaper + icon layers never cover the desktop")

    check(isDesktopCovered(by: [CoveringWindow(level: 0, bounds: screen)], screen: screen),
          "coverage: fullscreen normal window covers")

    check(isDesktopCovered(by: [CoveringWindow(level: 0, bounds: screen, alpha: 0.5)],
                           screen: screen) == false,
          "coverage: translucent window does not cover")

    check(isDesktopCovered(by: [CoveringWindow(level: 0, bounds: screen, onscreen: false)],
                           screen: screen) == false,
          "coverage: offscreen window does not cover")

    let half = CGRect(x: 0, y: 0, width: 1512, height: 400)
    check(isDesktopCovered(by: [CoveringWindow(level: 0, bounds: half)], screen: screen) == false,
          "coverage: partial overlap does not cover (conservative — keep animating)")

    let bigger = CGRect(x: -10, y: -10, width: 2000, height: 1200)
    check(isDesktopCovered(by: [CoveringWindow(level: 0, bounds: bigger)], screen: screen),
          "coverage: oversized window covers")

    // Two screens, one covered: the signature must distinguish them per screen.
    let second = CGRect(x: 1512, y: 0, width: 1920, height: 1080)
    let sig = coverageSignature(of: [CoveringWindow(level: 0, bounds: screen)],
                                screens: [screen, second])
    check(sig == [true, false], "coverage: per-screen signature (got \(sig))")
}

// --- StoryContent: the JSON SSOT decodes from the bundle ---------------------
// The content twin lives in src/engine/data/story-content.json (shared with web).
// Native loads it as a bundle resource; run-native-tests.sh puts it next to the binary.
do {
    let sc = StoryContent.shared
    check(sc.schemaVersion == 1, "story content schemaVersion is 1 (got \(sc.schemaVersion))")
    check(sc.presets.count == 13, "story content carries 13 colour presets (got \(sc.presets.count))")

    // Section manifest — every section the web engine authors must survive the Swift decode.
    // Counts are the guard against a silently half-decoded schema (a missing key would
    // otherwise just yield an empty array and a mute terminal).
    let manifest: [(String, Int, Int)] = [
        ("beats.routine", sc.beats.routine.count, 14),
        ("beats.hqInboundRoutine", sc.beats.hqInboundRoutine.count, 5),
        ("beats.hqReplyRoutine", sc.beats.hqReplyRoutine.count, 5),
        ("beats.intrusionsQuotes", sc.beats.intrusionsQuotes.count, 12),
        ("beats.intrusionsFragments", sc.beats.intrusionsFragments.count, 5),
        ("beats.reactionsFirst", sc.beats.reactionsFirst.count, 5),
        ("beats.reactionsFirstResp", sc.beats.reactionsFirstResp.count, 5),
        ("beats.hesitations", sc.beats.hesitations.count, 7),
        ("beats.reactionsAlarm", sc.beats.reactionsAlarm.count, 6),
        ("beats.reactionsAlarmResp", sc.beats.reactionsAlarmResp.count, 6),
        ("beats.hqEscalationDrafts", sc.beats.hqEscalationDrafts.count, 3),
        ("beats.hqNonResponses", sc.beats.hqNonResponses.count, 5),
        ("beats.reactionsPanic", sc.beats.reactionsPanic.count, 7),
        ("beats.reactionsPanicResp", sc.beats.reactionsPanicResp.count, 5),
        ("beats.panicDrafts", sc.beats.panicDrafts.count, 4),
        ("beats.systemFinal", sc.beats.systemFinal.count, 5),
        ("mentor.handshake", sc.mentor.handshake.count, 4),
        ("mentor.exchanges", sc.mentor.exchanges.count, 21),
        ("film.foreshadow", sc.film.foreshadow.count, 6),
        ("film.arrival", sc.film.arrival.count, 6),
        ("film.combat", sc.film.combat.count, 3),
        ("boot.lines", sc.boot.lines.count, 15),
        ("boot.headers", sc.boot.headers.count, 8),
        ("terminalDicts", sc.terminalDicts.count, 4),
        ("hudHandles", sc.hudHandles.count, 6),
        ("modeLabels", sc.modeLabels.count, 8),
        ("flashPhrases", sc.flashPhrases.count, 10),
        ("alertPhrases", sc.alertPhrases.count, 5),
        ("commandSessions", sc.commandSessions.count, 23),
        ("endings.farewells", sc.endings.farewells.count, 6),
        ("endings.lastWords", sc.endings.lastWords.count, 6),
        ("arcs", sc.arcs.count, 5),
        ("chatter", sc.chatter.count, 13),
    ]
    let bad = manifest.filter { $0.1 != $0.2 }
    check(bad.isEmpty, "story content decodes every section (mismatched: \(bad.map { "\($0.0) \($0.1)≠\($0.2)" }))")

    // A command response is a union in the web schema (script-bank.ts:21):
    // either a bare string or a categorised {cat,text}. Both must decode.
    let resp = sc.beats.routine.flatMap { $0.resp }
    check(resp.contains { $0.cat == nil } && resp.contains { $0.cat != nil },
          "command responses decode in both shapes (bare string and categorised)")
    check(resp.allSatisfy { !$0.text.isEmpty }, "no command response decodes to empty text")

    // Untagged fragments are legal and stay eligible under every arc (arc.ts:47).
    let frags = sc.beats.intrusionsFragments
    check(frags.contains { $0.tags == nil } && frags.contains { ($0.tags?.count ?? 0) > 0 },
          "intrusion fragments decode both tagged and untagged")
}

// --- StoryContent: the optional arc fields survive the decode -----------------
// These are the fields Slices 2/7/8 consume; a Swift Optional that silently stays nil
// would look like "arc has no bias" rather than "the decode dropped it".
do {
    guard let cold = StoryContent.shared.arcs.first(where: { $0.id == "cold-path" }) else {
        check(false, "arc cold-path present"); exit(1)
    }
    check(cold.phaseRouting?["INTRUSION"] == "PANIC", "arc cold-path routes INTRUSION → PANIC")
    check(cold.durationScale?["PANIC"] == 0.9, "arc cold-path scales PANIC duration")
    check(cold.beatTags.include == ["trace", "technical"] && cold.beatTags.exclude == ["calm"],
          "arc cold-path carries both beat-tag lists")
    check(cold.scenes?["PANIC"]?.first?.scene == "tunnel", "arc cold-path biases PANIC scenes")
    check(cold.threatCurve?["PANIC"] == [0.8, 1], "arc cold-path carries a threat curve")
    check(cold.ending.divertOnThreat?.first.map { $0.atStage == 3 && $0.to == "captured" } == true,
          "arc cold-path diverts to the captured ending at stage 3")
    let normal = StoryContent.shared.arcs.first { $0.id == "normal" }
    check(normal?.phaseRouting == nil && normal?.scenes == nil,
          "arc normal leaves the optional bias fields absent")
}

// --- Parity: the hand-maintained Swift literals vs the shared JSON SSOT -------
// Written BEFORE Script.swift becomes a facade, so a divergence surfaces as a named
// section rather than as an opaque golden-hash change. Any mismatch here is a content
// parity finding (AGENTS.md § the Swift twin), not a test defect.
do {
    let sc = StoryContent.shared
    func same(_ a: [String], _ b: [String], _ name: String) {
        if a == b { check(true, "parity \(name)"); return }
        let onlyNative = a.filter { !b.contains($0) }
        let onlyWeb = b.filter { !a.contains($0) }
        check(false, "parity \(name) — native-only \(onlyNative.count) \(onlyNative.prefix(2)), web-only \(onlyWeb.count) \(onlyWeb.prefix(2))")
    }
    same(Script.hqInboundRoutine, sc.beats.hqInboundRoutine, "beats.hqInboundRoutine")
    same(Script.hqReplyRoutine, sc.beats.hqReplyRoutine, "beats.hqReplyRoutine")
    same(Script.reactionsFirst, sc.beats.reactionsFirst, "beats.reactionsFirst")
    same(Script.reactionsAlarm, sc.beats.reactionsAlarm, "beats.reactionsAlarm")
    same(Script.reactionsPanic, sc.beats.reactionsPanic, "beats.reactionsPanic")
    same(Script.boot, sc.boot.lines, "boot.lines")
    same(Script.ghostlinkHandshake, sc.mentor.handshake, "mentor.handshake")
    check(Script.mentorName == sc.mentor.name, "parity mentor.name")
    same(Script.farewells, sc.endings.farewells["normal"] ?? [], "endings.farewells.normal")
    for scene in sc.film.foreshadow.keys.sorted() {
        same(Script.sceneForeshadow[scene] ?? [], sc.film.foreshadow[scene]!, "film.foreshadow.\(scene)")
    }
    for scene in sc.film.arrival.keys.sorted() {
        same(Script.sceneArrival[scene] ?? [], sc.film.arrival[scene]!, "film.arrival.\(scene)")
    }
    for kind in sc.film.combat.keys.sorted() {
        same(Script.combatLines[kind] ?? [], sc.film.combat[kind]!, "film.combat.\(kind)")
    }

    // Structured sections: compare TEXT only. The category taxonomies differ by design
    // (web Cat3 strings vs the native 10-case Terminal.Cat), so a text match means the
    // facade is a category mapping and nothing more.
    same(Script.routineBeats.map { $0.cmd }, sc.beats.routine.map { $0.cmd }, "beats.routine.cmd")
    same(Script.routineBeats.flatMap { $0.resp.map { $0.0 } },
         sc.beats.routine.flatMap { $0.resp.map { $0.text } }, "beats.routine.resp.text")
    same(Script.reactionsFirstResp.map { $0.0 }, sc.beats.reactionsFirstResp.map { $0.text }, "beats.reactionsFirstResp.text")
    same(Script.reactionsAlarmResp.map { $0.0 }, sc.beats.reactionsAlarmResp.map { $0.text }, "beats.reactionsAlarmResp.text")
    same(Script.reactionsPanicResp.map { $0.0 }, sc.beats.reactionsPanicResp.map { $0.text }, "beats.reactionsPanicResp.text")
    same(Script.hqNonResponses.map { $0.0 }, sc.beats.hqNonResponses.map { $0.text }, "beats.hqNonResponses.text")
    same(Script.systemFinal.map { $0.0 }, sc.beats.systemFinal.map { $0.text }, "beats.systemFinal.text")
    same(Script.intrusionsQuotes.map { $0.text }, sc.beats.intrusionsQuotes.map { $0.text }, "beats.intrusionsQuotes")
    same(Script.intrusionsFragments.map { $0.text }, sc.beats.intrusionsFragments.map { $0.text }, "beats.intrusionsFragments")
    same(Script.hesitations.map { $0.typed }, sc.beats.hesitations.map { $0.typed }, "beats.hesitations.typed")
    same(Script.hqEscalationDrafts.map { $0.final }, sc.beats.hqEscalationDrafts.map { $0.final }, "beats.hqEscalationDrafts.final")
    same(Script.panicDrafts.map { $0.final }, sc.beats.panicDrafts.map { $0.final }, "beats.panicDrafts.final")
    same(Script.mentorExchanges.map { $0.out }, sc.mentor.exchanges.map { $0.out }, "mentor.exchanges.out")
    // Is the web→native category mapping even a function? Collect every (webCat, nativeCat)
    // pair across all categorised sections; if one web category maps to two native ones the
    // facade cannot be mechanical.
    var pairs: [String: Set<String>] = [:]
    func collect(_ nat: [(String, Terminal.Cat)], _ web: [StoryContent.Line]) {
        for (n, w) in zip(nat, web) { pairs[w.cat, default: []].insert("\(n.1)") }
    }
    collect(Script.routineBeats.flatMap { $0.resp },
            sc.beats.routine.flatMap { $0.resp }.map { StoryContent.Line(cat: $0.cat ?? "—", text: $0.text) })
    collect(Script.reactionsFirstResp, sc.beats.reactionsFirstResp)
    collect(Script.reactionsAlarmResp, sc.beats.reactionsAlarmResp)
    collect(Script.reactionsPanicResp, sc.beats.reactionsPanicResp)
    collect(Script.hqNonResponses, sc.beats.hqNonResponses)
    collect(Script.systemFinal, sc.beats.systemFinal)
    let ambiguous = pairs.filter { $0.value.count > 1 }
    check(ambiguous.isEmpty, "web→native category mapping is a function (ambiguous: \(ambiguous))")
    print("     mapping: \(pairs.mapValues { $0.first! }.sorted { $0.key < $1.key })")

    // native lastWords are bare strings; the JSON carries the abandon ratio alongside.
    same(Script.lastWords, (sc.endings.lastWords["normal"] ?? []).map { $0.typed }, "endings.lastWords.normal")

    // BootSequence reads its scene headers from the same SSOT. What the parity test cannot
    // see is a MISSING key: a scene absent from boot.headers silently falls back to
    // ">> SYSTEM ONLINE", which looks like a design choice rather than a gap.
    let headerless = SceneRegistry.ids.filter { sc.boot.headers[$0] == nil }
    check(headerless.isEmpty, "every native scene has a boot header in the SSOT (missing: \(headerless))")
}

// --- weather vocabulary vs the web (controller.ts:363) -----------------------
// The web folds weather into baseFogDensity (scene default 0.01): 'clear' sets an
// absolute 0.004 (= x0.4), 'heavy-fog' multiplies by 2.5, 'light-fog' is the no-op
// scene default. Until 2026-08-30 the native enum had only clear/storm/dust, where
// .clear WAS the no-op — same picture as the web's light-fog, under the web's name
// for a different value, with two web values unreachable on macOS.
do {
    check(Settings.Weather.allCases.map { $0.rawValue }.sorted()
          == ["clear", "dust", "heavy-fog", "light-fog", "storm"],
          "weather vocabulary matches the web")
    check(Settings.Weather.lightFog.fogMul == 1, "light-fog is the scene default (no-op)")
    check(Settings.Weather.clear.fogMul == 0.4, "clear thins the fog (web 0.004 / 0.01)")
    check(Settings.Weather.heavyFog.fogMul == 2.5, "heavy-fog x2.5 (web parity)")
    check(Settings.Weather.dust.fogMul == 2.4, "dust x2.4 unchanged")
    check(Settings.Weather.storm.fogMul == 1.7, "storm x1.7 unchanged")
}

// --- app defaults vs the shared query contract -------------------------------
// The Metal app hung on NO parity checkpoint until 2026-08-30: the web, Windows
// and Linux sides all pin native/shared/query-contract.txt, while macOS read its
// own UserDefaults and could drift freely. That is exactly how autoCycle slipped
// away from the engine unnoticed since v0.10 — found by hand, not by a test.
//
// This section closes that hole: every key of the contract is either CHECKED
// against AppDefaults or listed as a deliberate exception WITH a reason. A key
// that is neither fails the run, so a future contract change cannot be adopted
// by three hosts and silently skipped by the fourth.
do {
    guard let url = Bundle.main.url(forResource: "query-contract", withExtension: "txt") else {
        // A checkpoint that can skip itself proves nothing (the Linux host makes
        // the same call). Missing fixture = failure, not a skipped test.
        print("FAIL - query-contract.txt not found next to the executable (\(Bundle.main.bundlePath))")
        failures += 1
        exit(1)
    }
    let text = try! String(contentsOf: url, encoding: .utf8)
    guard let line = text.split(separator: "\n").first(where: { $0.hasPrefix("?") }) else {
        print("FAIL - query-contract.txt holds no query line"); failures += 1; exit(1)
    }
    var contract: [String: String] = [:]
    for pair in line.dropFirst().split(separator: "&", omittingEmptySubsequences: false) {
        let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        contract[String(kv[0])] = kv.count > 1 ? String(kv[1]) : ""
    }
    check(contract.count >= 30, "contract parsed (\(contract.count) keys)")

    var seen = Set<String>()
    func want(_ key: String, _ got: String) {
        seen.insert(key)
        guard let exp = contract[key] else {
            check(false, "contract has key '\(key)'"); return
        }
        check(got == exp, "default \(key): \(got) == contract \(exp)")
    }
    func wantNum(_ key: String, _ got: Double) {
        seen.insert(key)
        guard let exp = contract[key], let e = Double(exp) else {
            check(false, "contract has numeric key '\(key)'"); return
        }
        check(got == e, "default \(key): \(got) == contract \(e)")
    }
    // Float fields are compared IN Float: the contract carries decimals, the app
    // carries Float, and 0.35 widened to Double is 0.3499999940395355 — a Double
    // comparison would measure the widening, not the value.
    func wantFloat(_ key: String, _ got: Float) {
        seen.insert(key)
        guard let exp = contract[key], let e = Float(exp) else {
            check(false, "contract has numeric key '\(key)'"); return
        }
        check(got == e, "default \(key): \(got) == contract \(e)")
    }
    func wantBool(_ key: String, _ got: Bool) { want(key, got ? "on" : "off") }

    want("scene", AppDefaults.scene)
    want("preset", AppDefaults.preset)
    want("speed", AppDefaults.speed)
    want("altitude", AppDefaults.cityAltitude)
    want("fog", AppDefaults.fog)
    want("weather", AppDefaults.weather)
    want("termlayout", AppDefaults.terminalLayout)
    want("bootspeed", AppDefaults.bootSpeed)
    wantBool("audio", AppDefaults.sound)
    wantBool("matrix", AppDefaults.matrix)
    wantBool("radar", AppDefaults.showRadar)
    wantBool("reactive", AppDefaults.reactiveWorld)
    wantBool("autocycle", AppDefaults.autoCycle)
    wantBool("boot", AppDefaults.bootEnabled)
    wantBool("daynight", AppDefaults.dayNight)
    wantFloat("bank", AppDefaults.bankStrength)
    wantNum("cyclemin", AppDefaults.cycleMinutes)
    wantFloat("crtintensity", AppDefaults.intensity)
    wantFloat("curvature", AppDefaults.curvature)
    wantFloat("aperture", AppDefaults.apertureMask)
    wantFloat("ntsc", AppDefaults.ntsc)
    wantFloat("halation", AppDefaults.halation)

    // Deliberate exceptions — each one is a key the app genuinely has no 1:1
    // counterpart for, NOT a value that happens to disagree. Adding to this list
    // is a decision; letting a key fall through it is not possible (see below).
    let skipped: [String: String] = [
        "look":          "display-only on macOS (which one-click Look is selected); the contract carries it empty",
        "terminal":      "web splits terminal on/off from the layout; macOS encodes both in termlayout",
        "crosshair":     "no separate app setting — folded into showHud",
        "bloom":         "web fx toggle; macOS has only the bloomScale multiplier",
        "bloomstrength": "per-preset strength on macOS (bloomScale multiplies it) — different scale, not comparable",
        "trails":        "web fx toggle; macOS trails is a single amount where 0 means off",
        "trailsamount":  "web damp (0.5..0.95) vs macOS persistence amount — different meaning, see the trails finding",
        "scan":          "no macOS equivalent; scanlines are part of the CRT composite",
        "crt":           "web CRT-sim toggle; macOS drives it from crtintensity alone",
        "scale":         "render scale is wallpaper-only on macOS (WallpaperScale, 0.66)",
        "perfadapt":     "adaptive quality is a web/Windows host feature; the Metal app has its own frame policy",
    ]
    for (k, why) in skipped { seen.insert(k); _ = why }

    let unhandled = Set(contract.keys).subtracting(seen)
    check(unhandled.isEmpty,
          "every contract key is checked or a named exception (unhandled: \(unhandled.sorted()))")
    let stale = seen.subtracting(Set(contract.keys))
    check(stale.isEmpty, "no exception names a key the contract dropped (stale: \(stale.sorted()))")
}

if failures > 0 { print("\n\(failures) FAILURE(S)"); exit(1) }
print("\nALL PASS (\(failures == 0))")
