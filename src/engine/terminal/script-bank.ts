// Script bank — FACADE over the shared content SSOT (src/engine/data/story-content.json).
//
// All the operator's shift material now lives in story-content.json (the single source
// shared with the native Swift twin). This module re-exports it under the original names
// + types so consumers are unchanged, keeps the persona-token form (`{node}` etc. — see
// persona.subst), and retains the small code-side helpers (genHash, foreshadow/arrival/
// combat lookups, computed ghostlink strings) that are logic, not content.
//
// Worldbuilding sources: NeuroVim FRAGMENTS 01-10, Mission briefings, THE RAVEN.

import story from '../data/story-content.json';
import type { ArcTemplate, EndingId } from './arc';

type Cat3 = 'OK' | 'WARN' | 'INFO';

// ── PHASE 1: ROUTINE ──────────────────────────────────────────────────────────
/** Routine command. `cmd` carries persona tokens ({node}/{hqlower}/{sector}); the
 *  narrative resolves them via persona.subst (twin of native Terminal.subst). */
export interface RoutineBeat {
  cmd: string;
  resp: ReadonlyArray<string | { cat: Cat3; text: string }>;
  tags?: string[];   // Slice 2 — arc beat-tag filter (optional; untagged = universal)
}
export const ROUTINE_BEATS = story.beats.routine as readonly RoutineBeat[];
export const HQ_INBOUND_ROUTINE = story.beats.hqInboundRoutine as readonly string[];
export const HQ_REPLY_ROUTINE = story.beats.hqReplyRoutine as readonly string[];

// ── PHASE 2: FIRST INTRUSION ──────────────────────────────────────────────────
export interface IntrusionEvent {
  text: string;
  followup?: string;
  tags?: string[];   // Slice 2 — arc beat-tag filter (optional; untagged = universal)
}
export const INTRUSIONS_QUOTES = story.beats.intrusionsQuotes as readonly IntrusionEvent[];
export const INTRUSIONS_FRAGMENTS = story.beats.intrusionsFragments as readonly IntrusionEvent[];
export const REACTIONS_FIRST = story.beats.reactionsFirst as readonly string[];
export const REACTIONS_FIRST_RESP =
  story.beats.reactionsFirstResp as readonly { cat: 'WARN' | 'INFO' | 'OK'; text: string }[];
export const HESITATIONS =
  story.beats.hesitations as readonly { typed: string; replacement: string }[];

// ── PHASE 3: ALARM ────────────────────────────────────────────────────────────
export const REACTIONS_ALARM = story.beats.reactionsAlarm as readonly string[];
export const REACTIONS_ALARM_RESP =
  story.beats.reactionsAlarmResp as readonly { cat: 'WARN' | 'DENY' | 'INFO'; text: string }[];
export const HQ_ESCALATION_DRAFTS =
  story.beats.hqEscalationDrafts as readonly { drafts: string[]; final: string }[];
export const HQ_NON_RESPONSES =
  story.beats.hqNonResponses as readonly { cat: 'OK' | 'INFO' | 'AUTO'; text: string }[];

// ── PHASE 4: PANIC ────────────────────────────────────────────────────────────
export const REACTIONS_PANIC = story.beats.reactionsPanic as readonly string[];
export const REACTIONS_PANIC_RESP =
  story.beats.reactionsPanicResp as readonly { cat: 'DENY' | 'AUTO' | 'WARN'; text: string }[];
export const PANIC_DRAFTS =
  story.beats.panicDrafts as readonly { drafts: string[]; final: string }[];
export const SYSTEM_FINAL =
  story.beats.systemFinal as readonly { cat: 'DENY' | 'WARN' | 'AUTO'; text: string }[];

// ── PHASE 5: SILENCE ──────────────────────────────────────────────────────────
// SILENCE content moved under `endings` (keyed by EndingId) in Slice 2. FAREWELLS /
// LAST_WORDS alias the `normal` set so their values are unchanged (parity guard stays
// green); the arc-aware narrative picks ENDINGS[endingId] instead.
export const FAREWELLS = story.endings.farewells.normal as readonly string[];
export const LAST_WORDS =
  story.endings.lastWords.normal as readonly { typed: string; abandonAt: number }[];

export const ENDINGS = story.endings as {
  farewells: Record<EndingId, readonly string[]>;
  lastWords: Record<EndingId, readonly { typed: string; abandonAt: number }[]>;
};
export const ARCS = story.arcs as readonly ArcTemplate[];

// ── MENTOR (ghostlink) ────────────────────────────────────────────────────────
export const MENTOR_NAME = story.mentor.name;
export const GHOSTLINK_HANDSHAKE = story.mentor.handshake as readonly string[];

/** ASCII-pseudo-hash for visual flavor (logic, stays code-side). */
export function genHash(): string {
  const c = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += c[Math.floor(Math.random() * c.length)];
    if ((i + 1) % 4 === 0 && i < 15) s += '-';
  }
  return s;
}

export interface MentorExchange {
  out: string;
  reply: readonly string[];
  phase: 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC';
}
export const MENTOR_EXCHANGES = story.mentor.exchanges as readonly MentorExchange[];

/** GHOSTLINK status messages used between exchanges (computed from MENTOR_NAME). */
export const GHOSTLINK_TRANSMIT_LINES = (sizeKb: string): readonly string[] => [
  `encrypted (${sizeKb} KB) → ${MENTOR_NAME}`,
  'delivery: pending',
];
export const GHOSTLINK_INBOUND = `inbound // ${MENTOR_NAME}`;
export const GHOSTLINK_TIMEOUT = 'no response.';
export const GHOSTLINK_TEARDOWN = 'channel closed.';

// ── Scene foreshadow / arrival / combat lines (keyed by sceneId) ──────────────
export const SCENE_FORESHADOW = story.film.foreshadow as Record<string, string[]>;
/** Deterministic foreshadow line for a scene (index keeps it varied + reproducible). */
export function foreshadowLine(scene: string, index: number): string | null {
  const lines = SCENE_FORESHADOW[scene];
  return lines && lines.length ? lines[index % lines.length] : null;
}

export const SCENE_ARRIVAL = story.film.arrival as Record<string, string[]>;
export function arrivalLine(scene: string, index: number): string | null {
  const lines = SCENE_ARRIVAL[scene];
  return lines && lines.length ? lines[index % lines.length] : null;
}

export const COMBAT_LINES = story.film.combat as Record<string, string[]>;
export function combatLine(kind: string, index: number): string | null {
  const lines = COMBAT_LINES[kind];
  return lines && lines.length ? lines[index % lines.length] : null;
}
