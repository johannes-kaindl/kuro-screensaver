import { describe, it, expect } from 'vitest';
import { CHATTER } from '../src/engine/terminal/chatter-bank';

// Byte-true-move guard for the CHATTER → story-content.json migration (Slice 5),
// same method as tests/dict-presets-parity.test.ts. The pinned hash was captured from
// the PRE-migration chatter-bank.ts literal and covers ONLY the 7 pools that existed
// then — so later additive content (the sceneChange:* pools) never disturbs this proof.
// Web-internal move fidelity only; web↔native chatter parity is Slice 1.3's job.
function fnv1a(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const enc = new TextEncoder().encode(s);
  for (const b of enc) { h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}

const MIGRATED_KEYS = [
  'incomingFire', 'unitArrive', 'unitCrash',
  'phase:INTRUSION', 'phase:ALARM', 'phase:PANIC', 'phase:SILENCE',
] as const;

describe('CHATTER SSOT migration parity', () => {
  it('the 7 pre-migration pools survive the move into story-content.json unchanged', () => {
    const migrated = Object.fromEntries(MIGRATED_KEYS.map((k) => [k, CHATTER[k]]));
    expect(fnv1a(JSON.stringify(migrated))).toBe(3913490057233810303n);
  });
});
