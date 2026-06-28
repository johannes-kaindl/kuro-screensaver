import { describe, it, expect } from 'vitest';
import { deepMerge } from '../src/host-web/persistence';
import { DEFAULT_SCREENSAVER } from '../src/engine/data/defaults';

describe('settings forward-compat (deepMerge)', () => {
  it('an old save without `story` gets the default story', () => {
    const oldSave = { speed: 'fast', stats: { totalUptimeMs: 5 } }; // pre-Slice-3 shape
    const merged = deepMerge(structuredClone(DEFAULT_SCREENSAVER), oldSave);
    expect(merged.story).toEqual({ schema: 1, layerCounter: 0, arcsCompleted: [], endingsReached: {} });
    expect(merged.speed).toBe('fast');                    // user override preserved
    expect(merged.stats.scenesLoaded).toBe(0);            // default kept for unset stat
  });
  it('a saved `story` overrides the default', () => {
    const save = { story: { schema: 1, layerCounter: 9, arcsCompleted: ['wraith'], endingsReached: { wraith: 2 } } };
    const merged = deepMerge(structuredClone(DEFAULT_SCREENSAVER), save);
    expect(merged.story.layerCounter).toBe(9);
    expect(merged.story.arcsCompleted).toEqual(['wraith']);
  });
});
