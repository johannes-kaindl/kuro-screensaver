---
paths:
  - "native/macos/**"
  - "src/engine/data/story-content.json"
  - "src/engine/terminal/script-bank.ts"
  - "src/engine/data/dictionary.ts"
  - "tests/dict-presets-parity.test.ts"
---

# Der Swift-Zwilling der Engine-Logik

Wie die handgepflegte Swift-Logik und die TS-Engine zusammenhalten. Lädt, sobald macOS-Code oder die Story-Quelle berührt wird. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert).

### The Swift twin

The native engine logic is a **hand-maintained, line-for-line twin** of the TS engine
(`Core/Script.swift` ↔ `terminal/script-bank.ts`, FilmDirector, palettes …). Two rules keep
that twin from silently drifting apart:

- **Story CONTENT is authored once**, in `src/engine/data/story-content.json`. The web reads
  it through `data/dictionary.ts`; native decodes the same file via `Core/StoryContent.swift`
  (`Bundle.main` — the build scripts drop the JSON next to every binary, so tests, harness and
  `.app` share one code path). Swift-side literals that duplicate SSOT content should become
  facades over `StoryContent.shared` — `Script.boot` is the first one.
- **Story LOGIC stays a twin** (phases, timing, RNG) — that is deliberate, not debt.

`tests/main.swift` § *Parity* compares the remaining Swift literals section by section against
the JSON. **A mismatch there is a content-parity finding, not a test defect**: fix the content
or move the literal to the SSOT, do not relax the test. Both sides additionally pin a golden
hash (`tests/main.swift`, `tests/dict-presets-parity.test.ts`); when an authored content change
moves them, re-pin *with* a comment saying why — an unexplained re-pin is indistinguishable
from an accident.

Content that names the runtime is a trap: a line reading `WEBGL RENDERER` is true on the web
and a lie in the Metal app. Shared content stays platform-neutral.
