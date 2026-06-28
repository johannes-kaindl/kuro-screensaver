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

  private lastSceneChange = Number.NEGATIVE_INFINITY;

  /** True if a non-empty pool exists for `key`. */
  has(key: string): boolean {
    const pool = CHATTER[key];
    return !!pool && pool.length > 0;
  }

  /**
   * Course-correction chatter for a user-initiated scene change. Phase-keyed
   * (`sceneChange:<PHASE>`, falling back to the base `sceneChange` pool), suppressed
   * under reduced-motion (`calm`), and throttled to one firing per `cooldownMs`.
   * `now` is a monotonic millisecond timestamp supplied by the caller. Returns whether
   * it fired (so callers/tests can assert).
   */
  fireSceneChange(phase: string, calm: boolean, now: number, cooldownMs = 1200): boolean {
    if (calm) return false;
    if (now - this.lastSceneChange < cooldownMs) return false;
    this.lastSceneChange = now;
    const phaseKey = `sceneChange:${phase}`;
    this.fire(this.has(phaseKey) ? phaseKey : 'sceneChange');
    return true;
  }
}
