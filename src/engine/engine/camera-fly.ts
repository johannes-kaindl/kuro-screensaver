// CameraFly — "banked weaving flight" choreography, ported from the native Metal
// app (CameraFly.swift). Multi-frequency lateral + vertical sway with roll/yaw
// that bank INTO the turn (derived from the smooth weave velocity), plus
// occasional eased maneuvers (hard-bank / dive / climb). C1-continuous (no "hard
// cuts") and starts centered + LEVEL via a per-instance local clock + ramp.
import { mkRng } from './rng';

export interface FlySample { x: number; y: number; pitch: number; yaw: number; roll: number; }

export class CameraFly {
  private rng: () => number;
  private t0 = -1;
  private nextEventT: number;
  private event: { kind: number; start: number; dur: number; dir: number } | null = null;

  constructor(
    seed: number,
    public latAmp = 10, public vertAmp = 2.4, public vertBase = 6.5,
    public pitchBase = -0.2, public bankScale = 1,
    public bankGain = 2.2, public yawGain = 0.8,
  ) {
    this.rng = mkRng(seed);
    this.nextEventT = 6 + this.rng() * 8;
  }

  private smooth01(u: number) { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c); }

  sample(t: number, forwardSpeed: number): FlySample {
    if (this.t0 < 0) this.t0 = t;
    const lt = t - this.t0;                       // local clock → starts centered + level

    let x = Math.sin(lt * 0.11) * this.latAmp + Math.sin(lt * 0.043) * this.latAmp * 0.5;
    const xv = 0.11 * this.latAmp * Math.cos(lt * 0.11) + 0.043 * this.latAmp * 0.5 * Math.cos(lt * 0.043);
    let y = this.vertBase + Math.sin(lt * 0.17) * this.vertAmp + Math.sin(lt * 0.063) * this.vertAmp * 0.5;
    let pitch = this.pitchBase + Math.sin(lt * 0.13) * 0.045;
    let extraRoll = 0;

    // occasional eased maneuver — sin²(πp): value AND slope are 0 at both ends → no snap
    if (!this.event && lt > this.nextEventT) {
      this.event = { kind: Math.floor(this.rng() * 3), start: lt, dur: 2.8 + this.rng() * 2.4, dir: this.rng() < 0.5 ? 1 : -1 };
      this.nextEventT = lt + 12 + this.rng() * 16;
    }
    if (this.event) {
      const p = (lt - this.event.start) / this.event.dur;
      if (p >= 1) { this.event = null; }
      else {
        const s = Math.sin(p * Math.PI), env = s * s;
        if (this.event.kind === 0) { x += this.event.dir * this.latAmp * 0.5 * env; extraRoll += this.event.dir * 0.3 * env; }
        else if (this.event.kind === 1) { y -= 3.2 * env; pitch -= 0.13 * env; }
        else { y += 4.0 * env; pitch += 0.10 * env; }
      }
    }

    const turn = Math.max(-0.4, Math.min(0.4, -xv / Math.max(1, forwardSpeed)));
    const bank = this.bankScale * this.smooth01(lt / 3.5);   // ease the bank in from level
    return { x, y, pitch, yaw: turn * this.yawGain * bank, roll: (turn * this.bankGain + extraRoll) * bank };
  }
}
