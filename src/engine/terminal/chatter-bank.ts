// chatter-bank.ts — Brick E: multi-speaker radio chatter.
//
// Event-keyed exchanges between callsigns, streamed as staggered speaker turns by the
// ChatterDirector. Generalizes the old single-speaker combatLine() into unit cross-talk:
//   RADIO   — the CORP net (automated / dispatch register)        → HQ colour
//   UNIT-A  — a friendly CORP wingman in the fight                 → HQ colour
//   WRAITH  — the compromised hostile (the antagonist's voice)     → GHOSTLINK colour
//
// Keys: a FlightEventKind ('incomingFire' | 'unitArrive' | 'unitCrash'), a phase key
// ('phase:ALARM' | 'phase:PANIC' | 'phase:SILENCE' | 'phase:INTRUSION'), or a Slice-5
// course-correction key ('sceneChange' | 'sceneChange:<PHASE>').
import type { LineCategory } from '../data/dictionary';
import story from '../data/story-content.json';

export interface ChatterLine {
  /** callsign rendered as "[SPEAKER] " (overrides the category prefix). */
  speaker: string;
  /** colour register — HQ for friendly net, GHOSTLINK for the hostile/compromised voice. */
  category: LineCategory;
  text: string;
}

// FACADE over the shared content SSOT (story-content.json). The literal pools moved into
// the JSON in Slice 5 (byte-true, guarded by tests/chatter-parity.test.ts); the native
// twin (Chatter.swift) stays hand-mirrored until Slice 1.3's Codable bundle path.
/** key → list of exchanges; each exchange is an ordered set of speaker turns. */
export const CHATTER = (story as { chatter: Record<string, ChatterLine[][]> }).chatter;
