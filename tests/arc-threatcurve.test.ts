import { describe, it, expect } from 'vitest';
import { ARCS } from '../src/engine/terminal/script-bank';
import { resolveEnding, quantizeThreat } from '../src/engine/terminal/arc';

const PHASES = new Set(['ROUTINE', 'INTRUSION', 'ALARM', 'PANIC', 'SILENCE']);

describe('arc threatCurve content', () => {
  it('every declared threatCurve entry is a valid [lo,hi] with 0 ≤ lo ≤ hi ≤ 1', () => {
    for (const arc of ARCS) {
      if (!arc.threatCurve) continue;
      for (const [phase, band] of Object.entries(arc.threatCurve)) {
        expect(PHASES.has(phase), `arc ${arc.id} bad phase ${phase}`).toBe(true);
        expect(Array.isArray(band) && band!.length === 2, `arc ${arc.id}/${phase} not a pair`).toBe(true);
        const [lo, hi] = band!;
        expect(lo >= 0 && lo <= hi && hi <= 1, `arc ${arc.id}/${phase} bad band [${lo},${hi}]`).toBe(true);
      }
    }
  });

  it('the flavoured arcs declare threatCurve; normal stays pure', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    for (const id of ['harmonized', 'cold-path', 'karsen', 'wraith']) {
      expect(byId[id]?.threatCurve, `arc ${id} should declare threatCurve`).toBeTruthy();
    }
    expect(byId['normal']?.threatCurve).toBeUndefined();
  });

  it('curves drive divergent endings: harmonized stays shallow, cold-path/karsen reach captured', () => {
    const byId = Object.fromEntries(ARCS.map((a) => [a.id, a]));
    // harmonized PANIC band caps below 0.70 → peakStage 2 → no divert → 'harmonized'
    const hPanic = byId['harmonized'].threatCurve!.PANIC!;
    expect(quantizeThreat(hPanic[1], false)).toBeLessThan(3);
    expect(resolveEnding(byId['harmonized'], quantizeThreat(hPanic[1], false))).toBe('harmonized');
    // cold-path PANIC band reaches stage 3 → divert → 'captured'
    const cPanic = byId['cold-path'].threatCurve!.PANIC!;
    expect(quantizeThreat(cPanic[1], false)).toBe(3);
    expect(resolveEnding(byId['cold-path'], 3)).toBe('captured');
    // karsen likewise
    expect(resolveEnding(byId['karsen'], quantizeThreat(byId['karsen'].threatCurve!.PANIC![1], false))).toBe('captured');
  });
});
