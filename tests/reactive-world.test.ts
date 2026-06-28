import { describe, it, expect } from 'vitest';
import { ReactiveWorld } from '../src/engine/fx/reactive-world';
import type { ArcState } from '../src/engine/terminal/arc';
import type { Phase } from '../src/engine/terminal/narrative';

// Minimal fakes: ReactiveWorld only touches these members of engine/narrative.
function fakeEngine() {
  return {
    seed: 1, onFrame: null as unknown,
    bus: { emit() {} },
    threat: 0, storm: 0, fogThreatMult: 1,
    setEnemyFraction() {}, setCrtThreat() {}, setBloomThreat() {},
  };
}
function fakeNarrative(phase: Phase, progress: number, arc?: ArcState) {
  const stages: number[] = [];
  return {
    obj: {
      currentPhase: phase,
      phaseProgress: progress,
      currentArc: arc,
      updateThreatStage: (s: number) => stages.push(s),
      d: { onIntrusion: undefined as undefined | (() => void) },
    },
    stages,
  };
}
function arcWith(threatCurve: ArcState['arc']['threatCurve']): ArcState {
  return { arc: { id: 'x', weight: 1, antagonist: '', mentor: null, beatTags: {}, threatCurve, ending: { default: 'normal' } } as any, threatStage: 0, peakStage: 0 };
}

/** Drive update() to steady state at the given phase/progress; return the last stage fed. */
function steadyStage(arc: ArcState | undefined, phase: Phase = 'PANIC', progress = 1): number {
  const eng = fakeEngine();
  const narr = fakeNarrative(phase, progress, arc);
  const rw = new ReactiveWorld({ engine: eng as any, narrative: narr.obj as any, crt: null, settings: {} as any, calm: false });
  for (let i = 0; i < 4000; i++) rw.update(i * 16, 16); // low-pass converges to target
  return narr.stages[narr.stages.length - 1];
}

describe('ReactiveWorld arc threatCurve', () => {
  it('additive invariant: no arc / arc-without-curve / curve-missing-phase all reach the BAND stage', () => {
    const baseline = steadyStage(undefined);                            // BAND PANIC [0.70,1.0] → 3
    expect(baseline).toBe(3);
    expect(steadyStage(arcWith(undefined))).toBe(baseline);            // arc, no curve
    expect(steadyStage(arcWith({}))).toBe(baseline);                   // empty curve
    expect(steadyStage(arcWith({ ROUTINE: [0, 0.05] }))).toBe(baseline); // curve missing PANIC
  });

  it('a capping curve keeps PANIC below the stage-3 threshold', () => {
    expect(steadyStage(arcWith({ PANIC: [0.0, 0.65] }))).toBe(2); // < 0.70 → stage 2
  });

  it('a full curve still reaches stage 3', () => {
    expect(steadyStage(arcWith({ PANIC: [0.0, 1.0] }))).toBe(3);
  });

  it('an ALARM cap lowers the ALARM-phase stage', () => {
    expect(steadyStage(arcWith({ ALARM: [0.0, 0.30] }), 'ALARM', 1)).toBe(1); // < 0.40 → stage 1
    expect(steadyStage(undefined, 'ALARM', 1)).toBe(2);                       // BAND ALARM hi 0.70 → stage 2
  });
});
