import { describe, it, expect } from 'vitest';
import { ENDINGS, ARCS } from '../src/engine/terminal/script-bank';

const ENDING_IDS = ['harmonized', 'cold-path', 'karsen', 'wraith', 'captured', 'normal'];

describe('arc content shape', () => {
  it('every EndingId has a farewells and lastWords set', () => {
    for (const id of ENDING_IDS) {
      expect(ENDINGS.farewells[id as keyof typeof ENDINGS.farewells].length).toBeGreaterThan(0);
      expect(ENDINGS.lastWords[id as keyof typeof ENDINGS.lastWords].length).toBeGreaterThan(0);
    }
  });
  it('the 5 selectable arcs are present with valid endings', () => {
    expect(ARCS.map((a) => a.id).sort()).toEqual(
      ['cold-path', 'harmonized', 'karsen', 'normal', 'wraith'],
    );
    for (const a of ARCS) {
      expect(ENDING_IDS).toContain(a.ending.default);
      expect(a.weight).toBeGreaterThan(0);
      for (const d of a.ending.divertOnThreat ?? []) expect(ENDING_IDS).toContain(d.to);
    }
  });
  it('captured is divert-only (not a selectable arc)', () => {
    expect(ARCS.map((a) => a.id)).not.toContain('captured');
  });
});
