import { describe, it, expect } from 'vitest';
import { mkRng, shufflePick } from '../src/engine/engine/rng';

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

// `shufflePick` — the boot-line selector. Was `[...pool].sort(() => Math.random() - 0.5)`
// in hud/boot.ts, which is NOT a uniform shuffle: a comparator that answers randomly
// violates the transitivity every sort algorithm assumes, and the pool's leading entries
// come up measurably more often. The native twin is `shuffledPrefix` in Core/LCG.swift;
// the uniformity assertion below is what the old comparator version fails.
describe('shufflePick — uniform Fisher-Yates selection', () => {
  const pool = Array.from({ length: 15 }, (_, i) => `L${i}`);

  it('returns exactly n distinct entries, all from the pool', () => {
    const got = shufflePick(pool, 7, mkRng(4242));
    expect(got).toHaveLength(7);
    expect(new Set(got).size).toBe(7);
    got.forEach((g) => expect(pool).toContain(g));
  });

  it('is deterministic for a given rng seed', () => {
    expect(shufflePick(pool, 7, mkRng(99))).toEqual(shufflePick(pool, 7, mkRng(99)));
  });

  it('leaves the source pool untouched', () => {
    const before = [...pool];
    shufflePick(pool, 7, mkRng(7));
    expect(pool).toEqual(before);
  });

  it('picks every entry about equally often — no positional bias', () => {
    const runs = 20000;
    const seen = new Map(pool.map((p) => [p, 0]));
    const r = mkRng(20260902);
    for (let i = 0; i < runs; i++) shufflePick(pool, 7, r).forEach((p) => seen.set(p, seen.get(p)! + 1));
    const want = (7 / 15) * runs;                       // each entry in 7 of 15 slots
    for (const [entry, n] of seen) {
      expect(Math.abs(n - want) / want, `${entry} appeared ${n}x, expected ~${want}`).toBeLessThan(0.05);
    }
  });
});
