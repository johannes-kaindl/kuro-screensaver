// CombatDirector — seeded spawn cadence for combat actors. Reads threat each frame,
// spawns/retires the antagonist + CORP support units; the actors self-manage motion +
// fire and emit events on the bus. Cinematic, no damage model.
import { mkRng } from '../engine/rng';
import type { EventBus } from '../events/bus';
import { AntagonistDrone, SupportUnit, type Actor } from './actors';

// Disabled for now (2026-06-05 feedback): the drones read as glitches, not aircraft,
// and the tracers aren't legible ("taking fire" with nothing visible). The whole
// actor/event infrastructure stays; flip this on once actors look like real craft.
const COMBAT_ACTORS_ENABLED = false;

export interface ActorHost {
  add(a: Actor): void;
  /** current accent / enemy colour hex (actors build their own materials from these). */
  accentHex(): number;
  enemyHex(): number;
}

export class CombatDirector {
  private rng: () => number;
  private antagonist: Actor | null = null;
  private support: Actor[] = [];
  private nextSupportT = 10;

  constructor(private seed: number, private bus: EventBus, private host: ActorHost) {
    this.rng = mkRng((seed ^ 0xc0ffee) >>> 0);
  }

  update(t: number, _dt: number, threat: number): void {
    if (!COMBAT_ACTORS_ENABLED) return;
    // antagonist: appears once threat is up; the actor self-retires at threat<0.05.
    if (threat > 0.35 && (!this.antagonist || !this.antagonist.alive)) {
      const a = new AntagonistDrone(this.host.enemyHex(), this.seed,
        () => this.bus.emit({ kind: 'incomingFire', intensity: threat }));
      this.antagonist = a;
      this.host.add(a);
    }
    // CORP support: seeded beats during high threat, ≤2 concurrent.
    this.support = this.support.filter((s) => s.alive);
    if (threat > 0.4 && this.support.length < 2 && t > this.nextSupportT) {
      this.nextSupportT = t + 9 + this.rng() * 13;
      if (this.rng() < 0.6) {
        const crash = this.rng() < 0.5;
        const s = new SupportUnit(this.host.accentHex(), this.seed + Math.floor(t),
          crash, () => this.bus.emit({ kind: 'unitCrash' }));
        this.support.push(s);
        this.host.add(s);
        this.bus.emit({ kind: 'unitArrive' });
      }
    }
  }
}
