// FlightDirector — sequences camera manoeuvres on ONE continuous clock and owns the
// continuous speed multiplier. It POST-PROCESSES the pose the scene already wrote
// (additive, like the parallax/hesitation seam), and NEVER writes fog/bloom.
// Camera ownership note: in this brick the director only overlays (ownsCamera=false);
// full ownership during transitions arrives in Brick B.
import { mkRng } from '../engine/rng';
import type { EventBus, FlightEvent } from '../events/bus';
import type { TransitionProfile } from './transition-profiles';

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

/** Fuller camera the director drives during a transition (adds pitch + FOV). */
export interface TransitionCam {
  position: { x: number; y: number };
  rotation: { x: number; z: number };
  fov: number;
}

export class FlightDirector {
  private clock = 0;
  private active: Manoeuvre[] = [];
  private speedMul = 1;          // 1 outside a transition; ramped by the warp
  ownsCamera = false;
  private rng: () => number;
  private trans: { p: TransitionProfile; t0: number; swapped: boolean; onSwap: () => void; baseFov: number } | null = null;
  get inTransition(): boolean { return this.trans !== null; }

  constructor(seed: number, bus?: EventBus) {
    this.rng = mkRng(seed ^ 0x9e3779b9);
    bus?.subscribe('intrusion', (e: FlightEvent) =>
      this.enqueue({ kind: 'kick', dur: Math.max(0.3, e.intensity ?? 1.5), dir: 0, intensity: 0.55 }),
    );
  }

  /** continuous forward-speed multiplier (enum base is applied by the caller). */
  speed(): number { return this.speedMul; }

  enqueue(m: Manoeuvre): void { this.active.push(m); }

  /** Start a warp transition; fires onSwap once at the warp peak (the scene swap). */
  beginTransition(p: TransitionProfile, baseFov: number, onSwap: () => void): void {
    this.trans = { p, t0: this.clock, swapped: false, onSwap, baseFov };
    this.ownsCamera = true;
  }

  /** advance the director clock and retire finished manoeuvres. Call once/frame. */
  update(_t: number, dt: number): void {
    this.clock += dt / 1000;
    for (const m of this.active) if (m.start == null) m.start = this.clock;
    this.active = this.active.filter((m) => (this.clock - (m.start as number)) / m.dur < 1);

    const tr = this.trans;
    if (tr) {
      const el = this.clock - tr.t0;
      const total = tr.p.windupDur + tr.p.warpDur + tr.p.emergeDur;
      if (el >= tr.p.windupDur && el < tr.p.windupDur + tr.p.warpDur) {
        const pw = (el - tr.p.windupDur) / tr.p.warpDur;
        this.speedMul = 1 + (tr.p.warpSpeed - 1) * envelope(pw);          // sin² hump (C1)
        if (!tr.swapped && pw >= 0.5) { tr.swapped = true; tr.onSwap(); } // swap at the peak
      } else {
        this.speedMul = 1;
      }
      if (el >= total) { this.trans = null; this.ownsCamera = false; this.speedMul = 1; }
    }
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

  /** Override the scene-written pose during a transition. Returns true if FOV changed
   *  (so the caller can refresh the projection matrix). Reads the scene's just-written
   *  pose as the emerge blend target, so control hands back smoothly. */
  applyTransition(cam: TransitionCam): boolean {
    const tr = this.trans; if (!tr) return false;
    const el = this.clock - tr.t0;
    const { windupDur, warpDur, emergeDur, fovPush, climbPitch, entryAltitude } = tr.p;
    if (el < windupDur) {
      const e = envelope(0.5 + 0.5 * (el / windupDur));      // ramp the climb in, hold near peak
      if (climbPitch) cam.rotation.x += climbPitch * e;
      return false;
    }
    if (el < windupDur + warpDur) {
      const h = envelope((el - windupDur) / warpDur);
      cam.fov = tr.baseFov + fovPush * h;
      cam.position.x += (this.rng() - 0.5) * 0.06 * h;        // seeded warp shake
      cam.position.y += (this.rng() - 0.5) * 0.06 * h;
      return true;
    }
    const pe = Math.min(1, (el - windupDur - warpDur) / emergeDur);
    const k = 1 - (1 - pe) * (1 - pe);                        // easeOut
    if (entryAltitude != null) cam.position.y = entryAltitude + (cam.position.y - entryAltitude) * k;
    cam.fov = tr.baseFov;
    return true;
  }
}
