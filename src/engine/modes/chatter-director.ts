// ChatterDirector — Brick E. Turns events (combat + phase changes) into staggered
// multi-speaker radio chatter on the terminal. One exchange per event; speaker turns
// stream with a short delay so it reads as cross-talk, not a wall of text. Replaces the
// old single-speaker combatLine() path.
import { CHATTER, type ChatterLine } from '../terminal/chatter-bank';
import type { LineCategory } from '../data/dictionary';
import { mkRng } from '../engine/rng';

interface ChatterHud {
  addLine(txt: string, category: LineCategory, speaker?: string): Promise<void> | void;
}

export class ChatterDirector {
  private rng: () => number;
  private lastExchange: Record<string, number> = {};

  constructor(seed: number, private hud: ChatterHud) {
    this.rng = mkRng((seed ^ 0xc4a77e) >>> 0);
  }

  /** Fire chatter for an event/phase key (no-op when the pool is empty). */
  fire(key: string): void {
    const pool = CHATTER[key];
    if (!pool || pool.length === 0) return;
    // pick an exchange; avoid repeating this key's immediately-previous one.
    let idx = Math.floor(this.rng() * pool.length);
    if (pool.length > 1 && idx === this.lastExchange[key]) idx = (idx + 1) % pool.length;
    this.lastExchange[key] = idx;
    pool[idx].forEach((line: ChatterLine, i: number) => {
      setTimeout(() => void this.hud.addLine(line.text, line.category, line.speaker), i * 520);
    });
  }
}
