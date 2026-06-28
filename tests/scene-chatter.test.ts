import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CHATTER, type ChatterLine } from '../src/engine/terminal/chatter-bank';
import { ChatterDirector } from '../src/engine/modes/chatter-director';

const PHASES = ['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE'] as const;

function makeDirector() {
  const lines: { text: string; cat: string; speaker?: string }[] = [];
  const hud = { addLine: (text: string, cat: string, speaker?: string) => { lines.push({ text, cat, speaker }); } };
  // seed is arbitrary; chatter selection is seeded + deterministic.
  return { dir: new ChatterDirector(12345, hud as any), lines };
}

describe('sceneChange chatter content', () => {
  it('has a base sceneChange pool and one per phase, all non-empty + well-formed', () => {
    const keys = ['sceneChange', ...PHASES.map((p) => `sceneChange:${p}`)];
    for (const key of keys) {
      const pool = CHATTER[key];
      expect(pool, `missing pool ${key}`).toBeTruthy();
      expect(pool.length, `empty pool ${key}`).toBeGreaterThan(0);
      for (const exchange of pool) {
        expect(exchange.length).toBeGreaterThan(0);
        for (const line of exchange as ChatterLine[]) {
          expect(typeof line.speaker).toBe('string');
          expect(line.category === 'HQ' || line.category === 'GHOSTLINK').toBe(true);
          expect(line.text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('ChatterDirector.has', () => {
  it('reports presence of a non-empty pool', () => {
    const { dir } = makeDirector();
    expect(dir.has('sceneChange:PANIC')).toBe(true);
    expect(dir.has('sceneChange:NOPE')).toBe(false);
  });
});

describe('ChatterDirector.fireSceneChange', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires a non-empty line for the phase-keyed pool', () => {
    const { dir, lines } = makeDirector();
    expect(dir.fireSceneChange('PANIC', false, 0)).toBe(true);
    vi.advanceTimersByTime(2000); // flush the staggered turns
    expect(lines.length).toBeGreaterThan(0);
  });

  it('is suppressed under calm (reduced-motion)', () => {
    const { dir, lines } = makeDirector();
    expect(dir.fireSceneChange('PANIC', true, 0)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(lines.length).toBe(0);
  });

  it('throttles within the cooldown and allows after it', () => {
    const { dir } = makeDirector();
    expect(dir.fireSceneChange('ROUTINE', false, 1000)).toBe(true);
    expect(dir.fireSceneChange('ROUTINE', false, 1500)).toBe(false); // 500ms < 1200ms
    expect(dir.fireSceneChange('ROUTINE', false, 2300)).toBe(true);  // 1300ms ≥ 1200ms
  });

  it('falls back to the base pool when the phase key is absent', () => {
    const { dir, lines } = makeDirector();
    // 'WEIRD' has no sceneChange:WEIRD pool → fires base 'sceneChange'
    expect(dir.fireSceneChange('WEIRD', false, 0)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(lines.length).toBeGreaterThan(0);
  });
});
