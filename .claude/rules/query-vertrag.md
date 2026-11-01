---
paths:
  - "native/shared/**"
  - "native/linux/host/**"
  - "native/windows/host/**"
  - "native/macos/KuroNativeSaver/tests/**"
  - "native/macos/KuroMetalApp/AppDefaults.swift"
  - "tests/screensaver-params.test.ts"
  - "src/screensaver/params.ts"
  - "src/engine/data/defaults.ts"
---

# Query-Vertrag der vier Hosts

Die eine Datei `native/shared/query-contract.txt` und die vier Tests, die sie lesen. Lädt, sobald eine der beteiligten Seiten berührt wird. Verschoben aus dem Kern der `AGENTS.md` (Wortlaut unverändert).

- **The query contract is one file:** `native/shared/query-contract.txt` holds the query that
  unchanged default settings must produce. Four tests read it — `native/linux/host/tests`,
  `native/windows/host/tests` (both check the WRITE direction), `tests/screensaver-params.test.ts`
  (the READ direction: that query must yield the default settings) and, since 2026-08-30,
  `native/macos/KuroNativeSaver/tests/main.swift` (macOS `AppDefaults` must equal the contract).
  **Changing that line is a contract change** and all four sides plus
  `src/screensaver/params.ts` have to follow it together. Regenerate it, never retype it:
  `./<build>/options_test --print-default-query`.
  The web test documents two deliberate exceptions to "defaults in, defaults out", both
  mechanism: `hudPreset` → `custom` and `fxInheritFromTheme` → false, so query-set values
  survive a later preset/theme pass. There was a third — `autoCycle` defaulted to off on the
  web and on in every native host, contradicting those hosts' own header promise. The fixture
  found it on its first run (unnoticed since v0.10) and it was resolved on 2026-08-30 by
  pulling **all three** native hosts to the web default, macOS included.
  **macOS joined the fixture later the same day** and was the loose end that made autoCycle
  possible: the Metal app reads `UserDefaults` and hung on no parity checkpoint at all, so it
  could drift freely. Its defaults now live in `native/macos/KuroMetalApp/AppDefaults.swift`
  (the macOS counterpart to `data/defaults.ts`) — extracted from `AppSettings` precisely so a
  test can read them without touching a store. The check is exhaustive by construction: every
  contract key is either compared or listed as a **named exception with a reason**, and a key
  that is neither fails the run — a later contract change cannot be adopted by three hosts and
  silently skipped by the fourth. Two more divergences fell out of it at once (`cycleMinutes`
  0.5 vs 5 — a factor of 10 — and `dayNight` off vs on) plus a vocabulary gap: `Settings.Weather`
  knew only `clear/storm/dust`, where native `.clear` was in fact the web's `light-fog` (both the
  no-op scene default) while the web's own `clear` and `heavy-fog` had no native value at all.
  The enum now carries the web vocabulary with the fog factor on the enum (like `Fog.mul`),
  derived from `controller.ts:363`, not guessed.
