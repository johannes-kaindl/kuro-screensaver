import { describe, it, expect } from 'vitest';
import { mkRng } from '../src/engine/engine/rng';

// The LCG is the foundation of every web↔native parity test: procedural layouts,
// beat selection, and (soon) arc selection all draw from it. These expected values
// are the SAME constants asserted in the native harness
// (native/macos/KuroNativeSaver/tests/main.swift, "LCG seed1"/"LCG seed1337") —
// if web and native ever drift, both suites fail loudly.
describe('mkRng — web↔native LCG parity', () => {
  it('seed 1 matches the native sequence', () => {
    const r = mkRng(1);
    const got = [r(), r(), r(), r(), r()];
    const want = [
      0.236455525271595, 0.369270673720166, 0.504242032300681,
      0.704883263679221, 0.050543628633022,
    ];
    got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 12));
  });

  it('seed 1337 matches the native sequence', () => {
    const r = mkRng(1337);
    const got = [r(), r(), r(), r(), r()];
    const want = [
      0.754225567914546, 0.549500931752846, 0.274493878241628,
      0.158748119371012, 0.449464006349444,
    ];
    got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 12));
  });

  it('is deterministic — same seed yields the same stream', () => {
    const a = mkRng(42);
    const b = mkRng(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('seed 0 falls back to 1 (avoids a dead generator)', () => {
    const zero = mkRng(0);
    const one = mkRng(1);
    expect(zero()).toBe(one());
  });
});
