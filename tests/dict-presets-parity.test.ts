import { describe, it, expect } from 'vitest';
import { PRESETS } from '../src/engine/data/presets';
import { DICT } from '../src/engine/data/dictionary';

// Additive-invariant guard for the Slice 1b JSON-SSOT migration: PRESETS (presets.ts)
// and DICT (dictionary.ts) move verbatim into story-content.json, then both modules
// become facades re-reading from the SSOT. This pins an FNV-1a hash of the *facade
// output* (JSON.stringify of each export) so the move is proven byte-identical:
// the pinned hashes were captured from the pre-migration literals and must not change.
//
// Sibling of tests/script-bank-parity.test.ts (the Slice 1a guard). Together these are
// the safety nets that every later content/arc change must keep green.
//
// Scope (what this guard does NOT cover, on purpose):
//   • lore-intensity WEIGHTS + pickTerminalLine stay code-side (logic, per design §2) —
//     not part of this content hash; revisit if a later slice moves WEIGHTS into the SSOT.
//   • This is a WEB-INTERNAL move-fidelity guard, not a web↔native parity check. Native
//     still hand-mirrors this content (Palette.swift/Script.swift); web↔native parity is
//     Slice 1.3's job (StoryContent Codable + schema test), covered separately there.

function fnv1a(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const enc = new TextEncoder().encode(s);
  for (const b of enc) { h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}

describe('dict/presets SSOT migration parity', () => {
  it('PRESETS survives the move into story-content.json unchanged', () => {
    expect(fnv1a(JSON.stringify(PRESETS))).toBe(7533571888607463794n);
  });

  // Hash re-pinned when the `metro` scene was added (its modeLabels.metro +
  // boot.headers.metro entries are legitimate new DICT content, not a refactor).
  // Re-pinned again 2026-08-21: two boot lines named the web renderer ("WEBGL RENDERER",
  // "UNREAL BLOOM") and would have been a lie once the native Metal app started reading
  // the same pool, so they were neutralised to "GPU RENDERER" / "BLOOM". Authored content
  // change, not a refactor — the native side pins the same pool in tests/main.swift.
  it('DICT pools survive the move into story-content.json unchanged', () => {
    expect(fnv1a(JSON.stringify(DICT))).toBe(17523085815514849234n);
  });
});
