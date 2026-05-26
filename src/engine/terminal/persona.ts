// Operator persona — generated per shift, drives prompt label, command flavor,
// HQ comms style, and reaction patterns to compromise events.
//
// Worldbuilding: this is a CORP (Conglomerate of Regulated Processes) Sector
// Compliance Officer in 2047, working out of a Northern Relay Cluster (Sector 7).
// Their job is monitoring "Harmonization Engine v4.1" output for legacy-protocol
// incidents, processing audit queries, coordinating with their Compliance Tier
// HQ. They believe the system works. They're about to find out otherwise.

export interface OperatorPersona {
  /** Prompt label shown at the cursor: e.g. "OFC-3041@SCT-7.4-R3:~" */
  prompt: string;
  /** Designation shown in occasional whoami responses */
  designation: string;
  /** Sector node they're stationed at (used in commands & logs) */
  node: string;
  /** Sector number */
  sector: 7;
  /** Operations Tier they report to */
  hq: 'COMP-DIV' | 'AUDIT-DIV' | 'OPS-TIER' | 'PAU' /* Pattern Analysis Unit */;
  /** Personality bias — affects typing rhythm, escalation pattern, hesitation depth */
  trait: 'methodical' | 'tense' | 'overworked' | 'rookie';
}

const ROLES = ['OFC', 'CMP', 'AUD', 'TEL', 'REL'] as const;          // Officer / Compliance / Auditor / Telemetry / Relay
const NODE_PREFIXES = ['7.2-N04', '7.4-N11', '7.6-N03', '7.4-N02', '7.2-N07', '7.6-N08'] as const;
const HQ_OPTIONS = ['COMP-DIV', 'AUDIT-DIV', 'OPS-TIER', 'PAU'] as const;
const TRAITS = ['methodical', 'tense', 'overworked', 'rookie'] as const;

export function makePersona(rng: () => number): OperatorPersona {
  const role  = ROLES[Math.floor(rng() * ROLES.length)];
  const num   = String(2000 + Math.floor(rng() * 5000)).padStart(4, '0');
  const node  = NODE_PREFIXES[Math.floor(rng() * NODE_PREFIXES.length)];
  const hq    = HQ_OPTIONS[Math.floor(rng() * HQ_OPTIONS.length)];
  const trait = TRAITS[Math.floor(rng() * TRAITS.length)];
  const designation = `${role}-${num}`;
  return {
    prompt: `${designation}@SCT-${node}:~`,
    designation,
    node,
    sector: 7,
    hq,
    trait,
  };
}

/**
 * Trait-derived typing modifiers. All values are multipliers on the base timing.
 * Methodical = slow, deliberate, few mistakes. Rookie = fast bursts but many corrections.
 * Tense = fast but pauses long before sensitive words. Overworked = frequent typos, slower recovery.
 */
export interface TraitProfile {
  baseSpeed: number;       // multiplier on typewriter delay (lower = faster)
  jitter: number;          // multiplier on per-char random jitter
  typoChance: number;      // 0..1 per word
  pauseChance: number;     // 0..1 per char (mid-word micro-pause)
  pauseLengthMs: number;   // base pause length when triggered
  abandonChance: number;   // 0..1 per command (whole-line delete-and-retype)
}

export function profileFor(trait: OperatorPersona['trait']): TraitProfile {
  switch (trait) {
    case 'methodical':
      return { baseSpeed: 1.25, jitter: 0.6, typoChance: 0.04, pauseChance: 0.02, pauseLengthMs: 350, abandonChance: 0.02 };
    case 'tense':
      return { baseSpeed: 0.85, jitter: 1.2, typoChance: 0.07, pauseChance: 0.06, pauseLengthMs: 500, abandonChance: 0.06 };
    case 'overworked':
      return { baseSpeed: 1.1,  jitter: 1.0, typoChance: 0.11, pauseChance: 0.04, pauseLengthMs: 280, abandonChance: 0.04 };
    case 'rookie':
      return { baseSpeed: 0.95, jitter: 1.4, typoChance: 0.13, pauseChance: 0.05, pauseLengthMs: 220, abandonChance: 0.08 };
  }
}

/**
 * Modulate a base trait profile by the current narrative phase. Operator gets
 * progressively more rattled: more typos, more abandons, faster strokes during
 * panic (less thinking, more reaction). SILENCE goes slower again — defeated.
 */
export type PhaseName = 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC' | 'SILENCE';

export function phaseModulate(p: TraitProfile, phase: PhaseName): TraitProfile {
  switch (phase) {
    case 'ROUTINE':
      return p;
    case 'INTRUSION':
      return {
        ...p,
        typoChance:  p.typoChance  * 1.5,
        pauseChance: p.pauseChance * 1.4,
        pauseLengthMs: p.pauseLengthMs * 1.2,
      };
    case 'ALARM':
      return {
        ...p,
        baseSpeed:     p.baseSpeed     * 0.9,    // slightly faster — adrenaline
        typoChance:    p.typoChance    * 1.9,
        pauseChance:   p.pauseChance   * 1.6,
        pauseLengthMs: p.pauseLengthMs * 1.3,
        abandonChance: p.abandonChance * 1.8,
      };
    case 'PANIC':
      return {
        ...p,
        baseSpeed:     p.baseSpeed     * 0.78,   // bursts of fast typing
        jitter:        p.jitter        * 1.5,    // more erratic
        typoChance:    p.typoChance    * 2.5,
        pauseChance:   p.pauseChance   * 0.6,    // less pause — pure reaction
        abandonChance: p.abandonChance * 3.0,
      };
    case 'SILENCE':
      return {
        ...p,
        baseSpeed:     p.baseSpeed     * 1.7,    // slow, defeated, hesitant
        jitter:        p.jitter        * 0.7,
        typoChance:    p.typoChance    * 0.4,
        pauseChance:   p.pauseChance   * 0.4,
        pauseLengthMs: p.pauseLengthMs * 2.0,    // long thinking pauses
      };
  }
}
