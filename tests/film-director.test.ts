import { describe, it, expect } from 'vitest';
import { FilmDirector } from '../src/engine/modes/film-director';
import { mkRng } from '../src/engine/engine/rng';
import type { ArcState } from '../src/engine/terminal/arc';
import type { Phase } from '../src/engine/terminal/narrative';

// Oracle = the pre-Slice-7 algorithm, verbatim, as the additive-invariant reference.
const PHASE_CANDIDATES: Record<Phase, string[]> = {
  ROUTINE: ['terrain', 'city'],
  INTRUSION: ['city', 'rift'],
  ALARM: ['rift', 'tunnel'],
  PANIC: ['tunnel', 'void', 'wreckage'],
  SILENCE: ['void', 'wreckage'],
};
function oracle(seed: number, index: number, phase: Phase, prev: string | null): string {
  const cands = PHASE_CANDIDATES[phase];
  const r = mkRng((seed ^ (index * 0x9e3779b1)) >>> 0)();
  let i = Math.floor(r * cands.length) % cands.length;
  if (cands[i] === prev && cands.length > 1) i = (i + 1) % cands.length;
  return cands[i];
}
const PHASES: Phase[] = ['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE'];
const ALL = ['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage', null] as const;
function arcWith(scenes: ArcState['arc']['scenes']): ArcState {
  return { arc: { id: 'x', weight: 1, antagonist: '', mentor: null, beatTags: {}, scenes, ending: { default: 'normal' } } as any, threatStage: 0, peakStage: 0 };
}

describe('FilmDirector additive invariant (arc-less ≡ pre-Slice-7 oracle)', () => {
  it('matches the oracle across a sweep with arc=undefined / empty / missing-phase', () => {
    for (const seed of [1, 42, 1337, 0x9e3779b1 | 0]) {
      const fd = new FilmDirector(seed);
      for (let index = 0; index < 60; index++) {
        for (const phase of PHASES) {
          for (const prev of ALL) {
            const want = oracle(seed, index, phase, prev);
            expect(fd.sceneAt(index, phase, prev)).toBe(want);                       // undefined arc
            expect(fd.sceneAt(index, phase, prev, arcWith(undefined))).toBe(want);   // no scenes
            expect(fd.sceneAt(index, phase, prev, arcWith({}))).toBe(want);          // empty scenes
            expect(fd.sceneAt(index, phase, prev, arcWith({ ROUTINE: [] }))).toBe(want); // empty phase list + other phases missing
          }
        }
      }
    }
  });
});

describe('FilmDirector arc bias', () => {
  it('weights the heavy scene roughly proportionally and never picks off-override scenes', () => {
    const fd = new FilmDirector(12345);
    const arc = arcWith({ PANIC: [{ scene: 'wreckage', weight: 3 }, { scene: 'void', weight: 1 }] });
    let wreck = 0, voidc = 0;
    const N = 600;
    for (let index = 0; index < N; index++) {
      const s = fd.sceneAt(index, 'PANIC', null, arc); // prev=null → anti-repeat never fires
      expect(s === 'wreckage' || s === 'void').toBe(true);
      if (s === 'wreckage') wreck++; else voidc++;
    }
    expect(wreck).toBeGreaterThan(voidc);            // heavy scene dominates
    expect(wreck / voidc).toBeGreaterThan(1.8);      // ≈3:1, generous tolerance
    expect(wreck / voidc).toBeLessThan(5.0);
  });

  it('allows an off-list scene the phase candidates do not include', () => {
    const fd = new FilmDirector(7);
    const arc = arcWith({ PANIC: [{ scene: 'terrain', weight: 1 }] });
    for (let index = 0; index < 10; index++) {
      expect(fd.sceneAt(index, 'PANIC', null, arc)).toBe('terrain');
    }
  });

  it('avoids an immediate repeat on a weighted array when an alternative exists', () => {
    const fd = new FilmDirector(99);
    const arc = arcWith({ PANIC: [{ scene: 'wreckage', weight: 3 }, { scene: 'void', weight: 1 }] });
    for (let index = 0; index < 50; index++) {
      expect(fd.sceneAt(index, 'PANIC', 'wreckage', arc)).not.toBe('wreckage');
    }
  });
});
