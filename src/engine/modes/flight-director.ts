// FlightDirector — sequences camera manoeuvres on ONE continuous clock and owns the
// continuous speed multiplier. It POST-PROCESSES the pose the scene already wrote
// (additive, like the parallax/hesitation seam), and NEVER writes fog/bloom.
// Camera ownership note: in this brick the director only overlays (ownsCamera=false);
// full ownership during transitions arrives in Brick B.
import { mkRng } from '../engine/rng';
import type { EventBus, FlightEvent } from '../events/bus';

export type ManoeuvreKind = 'kick' | 'roll' | 'dive' | 'climb' | 'bank';

export interface Manoeuvre {
  kind: ManoeuvreKind;
  dur: number;       // seconds
  dir: number;       // -1 | 0 | +1
  intensity: number; // unit-ish amplitude
  start?: number;    // filled when dequeued (continuous director clock)
}

/** sin²(πp): value AND slope are 0 at p=0 and p=1 → chained manoeuvres never snap. */
export function envelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const s = Math.sin(Math.PI * p);
  return s * s;
}

export interface CameraTarget {
  position: { x: number; y: number };
  rotation: { z: number };
}

export class FlightDirector {
  private clock = 0;
  private active: Manoeuvre[] = [];
  private speedMul = 1;          // ramps in Brick B (warp); 1 here
  ownsCamera = false;
  private rng: () => number;

  constructor(seed: number, bus?: EventBus) {
    this.rng = mkRng(seed ^ 0x9e3779b9);
    bus?.subscribe('intrusion', (e: FlightEvent) =>
      this.enqueue({ kind: 'kick', dur: Math.max(0.3, e.intensity ?? 1.5), dir: 0, intensity: 0.55 }),
    );
  }

  /** continuous forward-speed multiplier (enum base is applied by the caller). */
  speed(): number { return this.speedMul; }

  enqueue(m: Manoeuvre): void { this.active.push(m); }

  /** advance the director clock and retire finished manoeuvres. Call once/frame. */
  update(_t: number, dt: number): void {
    this.clock += dt / 1000;
    for (const m of this.active) if (m.start == null) m.start = this.clock;
    this.active = this.active.filter((m) => (this.clock - (m.start as number)) / m.dur < 1);
  }

  /** additive overlay on the pose the scene just wrote (modifies in place). */
  apply(cam: CameraTarget): void {
    for (const m of this.active) {
      const p = (this.clock - (m.start as number)) / m.dur;
      const env = envelope(p);
      if (env === 0) continue;
      switch (m.kind) {
        case 'kick':  cam.position.x *= 1 - m.intensity * env; break;       // lateral steadying (== old hesitation)
        case 'roll':  cam.rotation.z += m.dir * m.intensity * env; break;   // barrel-roll
        case 'bank':  cam.position.x += m.dir * m.intensity * env; cam.rotation.z += m.dir * 0.3 * env; break;
        case 'dive':  cam.position.y -= m.intensity * env; break;
        case 'climb': cam.position.y += m.intensity * env; break;
      }
    }
  }
}
