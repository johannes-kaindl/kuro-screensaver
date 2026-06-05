// chatter-bank.ts — Brick E: multi-speaker radio chatter.
//
// Event-keyed exchanges between callsigns, streamed as staggered speaker turns by the
// ChatterDirector. Generalizes the old single-speaker combatLine() into unit cross-talk:
//   RADIO   — the CORP net (automated / dispatch register)        → HQ colour
//   UNIT-A  — a friendly CORP wingman in the fight                 → HQ colour
//   WRAITH  — the compromised hostile (the antagonist's voice)     → GHOSTLINK colour
//
// Keys: a FlightEventKind ('incomingFire' | 'unitArrive' | 'unitCrash') or a phase key
// ('phase:ALARM' | 'phase:PANIC' | 'phase:SILENCE' | 'phase:INTRUSION').
import type { LineCategory } from '../data/dictionary';

export interface ChatterLine {
  /** callsign rendered as "[SPEAKER] " (overrides the category prefix). */
  speaker: string;
  /** colour register — HQ for friendly net, GHOSTLINK for the hostile/compromised voice. */
  category: LineCategory;
  text: string;
}

/** key → list of exchanges; each exchange is an ordered set of speaker turns. */
export const CHATTER: Record<string, ChatterLine[][]> = {
  incomingFire: [
    [{ speaker: 'UNIT-A', category: 'HQ', text: 'EVASIVE — ROUNDS INBOUND' },
     { speaker: 'WRAITH', category: 'GHOSTLINK', text: 'reacquired. hold still.' }],
    [{ speaker: 'RADIO', category: 'HQ', text: 'CONTACT — WEAPONS HOT' },
     { speaker: 'UNIT-A', category: 'HQ', text: 'BREAKING — STAY ON MY WING' }],
    [{ speaker: 'WRAITH', category: 'GHOSTLINK', text: 'i see every move before you make it.' },
     { speaker: 'UNIT-A', category: 'HQ', text: 'JINK! GET OFF THE LINE!' }],
    [{ speaker: 'UNIT-A', category: 'HQ', text: 'TRACERS — HIGH AND RIGHT' },
     { speaker: 'RADIO', category: 'HQ', text: 'HOLD COURSE. RELIEF IS CLOSE.' }],
  ],
  unitArrive: [
    [{ speaker: 'RADIO', category: 'HQ', text: 'CORP-7 ON STATION — FORMING UP' },
     { speaker: 'UNIT-A', category: 'HQ', text: 'EYES ON. WE HAVE YOUR SIX.' }],
    [{ speaker: 'UNIT-A', category: 'HQ', text: 'INBOUND TO ASSIST — TEN SECONDS' },
     { speaker: 'RADIO', category: 'HQ', text: 'RELIEF FLIGHT CLEARED HOT' }],
    [{ speaker: 'RADIO', category: 'HQ', text: 'REINFORCEMENT VECTOR CONFIRMED' },
     { speaker: 'WRAITH', category: 'GHOSTLINK', text: 'more of you. it changes nothing.' }],
  ],
  unitCrash: [
    [{ speaker: 'RADIO', category: 'HQ', text: 'UNIT DOWN — TRANSPONDER DARK' },
     { speaker: 'WRAITH', category: 'GHOSTLINK', text: 'one less.' }],
    [{ speaker: 'UNIT-A', category: 'HQ', text: "MAYDAY — I'M HIT, GOING IN—" },
     { speaker: 'RADIO', category: 'HQ', text: 'BEACON LOGGED. KEEP MOVING.' }],
    [{ speaker: 'RADIO', category: 'HQ', text: 'LOST CORP-7. NO CHUTE.' },
     { speaker: 'UNIT-A', category: 'HQ', text: 'damn it. press on.' }],
  ],
  'phase:INTRUSION': [
    [{ speaker: 'RADIO', category: 'HQ', text: 'ANOMALY ON THE NET — STAND BY' },
     { speaker: 'WRAITH', category: 'GHOSTLINK', text: 'knock knock.' }],
  ],
  'phase:ALARM': [
    [{ speaker: 'RADIO', category: 'HQ', text: 'NET-WIDE ALERT — HOSTILE SIGNATURE' },
     { speaker: 'UNIT-A', category: 'HQ', text: 'WEAPONS FREE. WATCH THE FLANKS.' }],
    [{ speaker: 'WRAITH', category: 'GHOSTLINK', text: "i'm already inside." },
     { speaker: 'RADIO', category: 'HQ', text: 'LOCK DOWN SECONDARY CHANNELS' }],
  ],
  'phase:PANIC': [
    [{ speaker: 'WRAITH', category: 'GHOSTLINK', text: 'your net is mine now.' },
     { speaker: 'RADIO', category: 'HQ', text: 'CHANNELS COMPROMISED — GO DARK' }],
    [{ speaker: 'UNIT-A', category: 'HQ', text: "I CAN'T RAISE COMMAND—" },
     { speaker: 'WRAITH', category: 'GHOSTLINK', text: 'no one is coming.' }],
  ],
  'phase:SILENCE': [
    [{ speaker: 'RADIO', category: 'HQ', text: '...is anyone still receiving?' }],
  ],
};
