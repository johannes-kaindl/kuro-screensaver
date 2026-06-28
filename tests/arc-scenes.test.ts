import { describe, it, expect } from 'vitest';
import { ARCS } from '../src/engine/terminal/script-bank';

const VALID_SCENES = new Set(['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage']);
const PHASES = new Set(['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE']);

describe('arc scenes content', () => {
  it('every declared scenes entry is a valid FlightSceneId with a positive integer weight', () => {
    for (const arc of ARCS) {
      if (!arc.scenes) continue;
      for (const [phase, list] of Object.entries(arc.scenes)) {
        expect(PHASES.has(phase), `arc ${arc.id} bad phase ${phase}`).toBe(true);
        expect(Array.isArray(list)).toBe(true);
        for (const w of list!) {
          expect(VALID_SCENES.has(w.scene), `arc ${arc.id}/${phase} bad scene ${w.scene}`).toBe(true);
          expect(Number.isInteger(w.weight) && w.weight > 0, `arc ${arc.id}/${phase} bad weight ${w.weight}`).toBe(true);
        }
      }
    }
  });

  it('at least the four flavoured arcs declare scenes; normal stays a pure fallback', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    for (const id of ['harmonized', 'cold-path', 'karsen', 'wraith']) {
      expect(byId[id]?.scenes, `arc ${id} should declare scenes`).toBeTruthy();
    }
    expect(byId['normal']?.scenes).toBeUndefined();
  });
});
