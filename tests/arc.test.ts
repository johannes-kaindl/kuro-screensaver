import { describe, it, expect, vi, afterEach } from 'vitest';
import { pick, pickArc, arcAllows, type ArcState, type ArcTemplate } from '../src/engine/terminal/arc';

afterEach(() => vi.restoreAllMocks());

// A seeded Math.random so pick/pickArc are reproducible (the LCG from rng.ts).
function seedMathRandom(seed: number) {
  let s = (seed | 0) || 1;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  });
}

const ARC = (over: Partial<ArcTemplate> = {}): ArcTemplate => ({
  id: 'x', weight: 1, antagonist: 'a', mentor: null,
  beatTags: {}, ending: { default: 'normal' }, ...over,
});
const STATE = (arc: ArcTemplate): ArcState => ({ arc, threatStage: 0, peakStage: 0 });

describe('arcAllows', () => {
  it('untagged beat is always eligible', () => {
    expect(arcAllows(undefined, { include: ['wraith'] })).toBe(true);
    expect(arcAllows([], { include: ['wraith'] })).toBe(true);
  });
  it('include: tagged beat must share >=1 include tag', () => {
    expect(arcAllows(['wraith'], { include: ['wraith', 'aggressive'] })).toBe(true);
    expect(arcAllows(['drift'], { include: ['wraith', 'aggressive'] })).toBe(false);
  });
  it('exclude: tagged beat sharing an exclude tag is rejected', () => {
    expect(arcAllows(['calm'], { exclude: ['calm'] })).toBe(false);
  });
  it('exclude wins over include on conflict', () => {
    expect(arcAllows(['wraith', 'calm'], { include: ['wraith'], exclude: ['calm'] })).toBe(false);
  });
});

describe('pickArc RNG-neutrality (the additive invariant)', () => {
  it('pickArc(pool, undefined) returns the same sequence as pick(pool)', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    seedMathRandom(2025);
    const viaPick = Array.from({ length: 50 }, () => pick(pool));
    seedMathRandom(2025);
    const viaArc = Array.from({ length: 50 }, () => pickArc(pool, undefined));
    expect(viaArc).toEqual(viaPick);
  });
  it('pickArc filters tagged object pools by the arc tags', () => {
    const pool = [
      { text: 'w', tags: ['wraith'] },
      { text: 'd', tags: ['drift'] },
      { text: 'u' }, // untagged → always eligible
    ];
    const arc = STATE(ARC({ beatTags: { include: ['wraith'] } }));
    seedMathRandom(7);
    const got = Array.from({ length: 40 }, () => pickArc(pool, arc).text);
    expect(got).not.toContain('d');         // drift excluded by include set
    expect(new Set(got)).toEqual(new Set(['w', 'u']));
  });
  it('empty filter result falls back to the full pool (never starves)', () => {
    const pool = [{ text: 'd', tags: ['drift'] }];
    const arc = STATE(ARC({ beatTags: { include: ['wraith'] } }));
    seedMathRandom(1);
    expect(pickArc(pool, arc).text).toBe('d');
  });
});
