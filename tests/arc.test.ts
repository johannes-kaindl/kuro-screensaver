import { describe, it, expect, vi, afterEach } from 'vitest';
import { pick, pickArc, arcAllows, type ArcState, type ArcTemplate } from '../src/engine/terminal/arc';
import { selectArc, resolveEnding, quantizeThreat } from '../src/engine/terminal/arc';

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

describe('quantizeThreat', () => {
  it('steps at 0.15 / 0.40 / 0.70', () => {
    expect(quantizeThreat(0.0, false)).toBe(0);
    expect(quantizeThreat(0.14, false)).toBe(0);
    expect(quantizeThreat(0.15, false)).toBe(1);
    expect(quantizeThreat(0.39, false)).toBe(1);
    expect(quantizeThreat(0.40, false)).toBe(2);
    expect(quantizeThreat(0.69, false)).toBe(2);
    expect(quantizeThreat(0.70, false)).toBe(3);
    expect(quantizeThreat(1.0, false)).toBe(3);
  });
  it('calm forces stage 0', () => {
    expect(quantizeThreat(0.99, true)).toBe(0);
  });
});

describe('resolveEnding', () => {
  const arc = ARC({
    ending: { default: 'harmonized', divertOnThreat: [{ atStage: 3, to: 'cold-path' }] },
  });
  it('returns default below the divert stage', () => {
    expect(resolveEnding(arc, 0)).toBe('harmonized');
    expect(resolveEnding(arc, 2)).toBe('harmonized');
  });
  it('diverts at/above the divert stage', () => {
    expect(resolveEnding(arc, 3)).toBe('cold-path');
  });
  it('first matching divert wins; no divert → default', () => {
    const a2 = ARC({ ending: { default: 'wraith' } });
    expect(resolveEnding(a2, 3)).toBe('wraith');
  });
});

describe('selectArc', () => {
  const arcs: ArcTemplate[] = [
    ARC({ id: 'a', weight: 1 }), ARC({ id: 'b', weight: 1 }), ARC({ id: 'c', weight: 1 }),
    ARC({ id: 'd', weight: 1 }),
  ];
  it('never returns an id present in the last-3 completed', () => {
    seedMathRandom(99);
    for (let i = 0; i < 30; i++) {
      const got = selectArc(arcs, ['a', 'b', 'c']);
      expect(got.id).toBe('d');   // only survivor
    }
  });
  it('cold history → weighted over all arcs (deterministic for a fixed seed)', () => {
    seedMathRandom(2025);
    const first = selectArc(arcs, []);
    seedMathRandom(2025);
    expect(selectArc(arcs, []).id).toBe(first.id);  // reproducible
  });
  it('all arcs recently completed → falls back to full set (no starve)', () => {
    seedMathRandom(3);
    const got = selectArc(arcs, ['a', 'b', 'c', 'd']);
    expect(arcs.map((a) => a.id)).toContain(got.id);
  });
});
