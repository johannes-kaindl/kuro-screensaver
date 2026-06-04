// ReactiveWorld — couples the 3D world to the operator's narrative shift.
//
// A continuous "threat" (0..1) derived from the narrative phase + progress drives
// fog density, CRT degradation, a bloom surge, the per-scene particle storm, and a
// camera hesitation on intrusions — tuned for a SUBTLE build that pays off near
// PANIC and is released by the existing CRT crash (phase wraps to ROUTINE → exhale).
//
// Design: docs/superpowers/specs/2026-06-04-reactive-narrative-world-design.md
import type { Engine } from '../engine/core';
import type { NarrativeRunner, Phase } from '../terminal/narrative';
import type { CrtSim } from './crt-sim';
import type { ScreensaverSettings } from '../data/defaults';

// Per-phase threat band [lo, hi], lerped across the phase by smoothstep(progress).
const BAND: Record<Phase, [number, number]> = {
  ROUTINE:   [0.00, 0.12],
  INTRUSION: [0.12, 0.38],
  ALARM:     [0.38, 0.70],
  PANIC:     [0.70, 1.00],
  SILENCE:   [1.00, 1.00],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export interface ReactiveWorldDeps {
  engine: Engine;
  narrative: NarrativeRunner | null;
  crt: CrtSim | null;
  settings: ScreensaverSettings;
  /** prefers-reduced-motion → calm mode: gentle fog only, no motion/flicker/storm. */
  calm?: boolean;
  /** Tuning override: pin threat to a fixed value (URL ?threat=). */
  forcedThreat?: number;
}

export class ReactiveWorld {
  private threat = 0;
  /** One-shot additive envelopes layered on the threat-derived mults (NOT threat). */
  private envelopes: { t0: number; dur: number; bloom: number; fog: number }[] = [];
  private nowT = 0;                     // live frame clock (so pulse() needs no arg)
  private relaxing = false;            // fast-relax after a crash/reset
  private lastPhase: Phase = 'ROUTINE';
  private crtIntensityBase: number;
  private rngState: number;            // seeded xorshift for hesitation jitter

  constructor(private d: ReactiveWorldDeps) {
    this.crtIntensityBase = d.crt ? d.crt.settings.crtSim.intensity : 0;
    this.rngState = ((d.engine.seed ^ 0x5f3759df) >>> 0) || 1;
    d.engine.onFrame = (t, dt) => this.update(t, dt);
    if (d.narrative) d.narrative.d.onIntrusion = () => this.onIntrusion();
  }

  private rand(): number {              // deterministic per session
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState % 100000) / 100000;
  }

  private onIntrusion() {
    if (this.d.calm) return;
    this.d.engine.bus.emit({ kind: 'intrusion', intensity: 1.5 + this.rand() * 1.5 });
  }

  /** Fire a one-shot world envelope (additive bump on bloom/fog mults). calm-gated.
   *  'warp' is the scene-transition punch (strong bloom + brief fog clear). */
  pulse(kind: 'flash' | 'surge' | 'warp') {
    if (this.d.calm) return;
    const t = this.nowT;
    if (kind === 'flash') this.envelopes.push({ t0: t, dur: 0.6, bloom: 0.6, fog: 0 });
    else if (kind === 'warp') this.envelopes.push({ t0: t, dur: 1.4, bloom: 0.9, fog: -0.2 });
    else this.envelopes.push({ t0: t, dur: 1.2, bloom: 0.3, fog: -0.1 });
  }

  update(t: number, dt: number) {
    const e = this.d.engine;
    const calm = !!this.d.calm;
    this.nowT = t;

    // ── target threat ──
    let target: number;
    if (this.d.forcedThreat != null) {
      target = clamp01(this.d.forcedThreat);
      this.threat = target;             // snap (tuning)
    } else if (this.d.narrative) {
      const phase = this.d.narrative.currentPhase;
      if (phase === 'ROUTINE' && this.lastPhase !== 'ROUTINE') this.relaxing = true;
      if (phase !== 'ROUTINE') this.relaxing = false;
      this.lastPhase = phase;
      const [lo, hi] = BAND[phase];
      target = lo + (hi - lo) * smoothstep(0, 1, this.d.narrative.phaseProgress);
    } else {
      target = 0;
    }

    // ── low-pass (fast exhale while relaxing after the crash) ──
    if (this.d.forcedThreat == null) {
      const tau = this.relaxing ? 0.4 : 2.5;
      const k = 1 - Math.exp(-Math.min(0.1, dt / 1000) / tau);
      this.threat += (target - this.threat) * k;
      if (this.relaxing && this.threat < 0.02) this.relaxing = false;
    }

    const threat = this.threat;
    const storm = calm ? 0 : smoothstep(0.70, 1.00, threat);
    e.threat = threat;
    e.storm = storm;

    // ── transient one-shot envelopes (additive on the mults; never raw fog/bloom) ──
    let bloomAdd = 0, fogAdd = 0;
    this.envelopes = this.envelopes.filter((ev) => {
      const p = (t - ev.t0) / ev.dur;
      if (p >= 1) return false;
      const s = Math.sin(Math.PI * p), env = s * s;
      bloomAdd += ev.bloom * env; fogAdd += ev.fog * env;
      return true;
    });

    // ── push to subsystems (compose on user settings; calm = gentle, no motion) ──
    e.fogThreatMult = 1 + threat * (calm ? 0.6 : 1.6) + fogAdd;
    // Enemy-colour infection creeps in from INTRUSION (slow colour, OK in calm mode).
    e.setEnemyFraction(smoothstep(0.25, 0.90, threat));
    e.setCrtThreat(calm ? 0 : threat * 0.35, calm ? 0 : threat * 0.45);
    e.setBloomThreat(1 + storm * 0.4 + bloomAdd);
    if (this.d.crt) {
      this.d.crt.settings.crtSim.intensity = calm
        ? this.crtIntensityBase
        : Math.min(1, this.crtIntensityBase + threat * 0.7);
    }
  }

  dispose() {
    const e = this.d.engine;
    e.onFrame = null;
    this.envelopes = [];
    e.threat = 0; e.storm = 0;
    e.fogThreatMult = 1;
    e.setCrtThreat(0, 0);
    e.setBloomThreat(1);
    if (this.d.crt) this.d.crt.settings.crtSim.intensity = this.crtIntensityBase;
    if (this.d.narrative) this.d.narrative.d.onIntrusion = undefined;
  }
}
