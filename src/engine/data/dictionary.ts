// @ts-nocheck
// Spoiler-free atmospheric dictionary, NeuroVim-flavored.
// Pools are mixed at runtime; lore intensity controls categorical weights.
//
// FACADE over the shared content SSOT (story-content.json) since Slice 1b: the pools
// moved into flat JSON sections (boot/terminalDicts/hudHandles/modeLabels/flashPhrases/
// alertPhrases/commandSessions). DICT is rebuilt here in the original key order so the
// facade output is byte-identical (guarded by tests/dict-presets-parity.test.ts). The
// lore-intensity WEIGHTS table + pickTerminalLine/pickCommandSession/pickFrom stay
// code-side (logic, per design spec §2).

import story from './story-content.json';

export const DICT = {
  BOOT_LINES: story.boot.lines,
  BOOT_HEADERS: story.boot.headers,
  TERMINAL: story.terminalDicts,
  HUD_HANDLES: story.hudHandles,
  MODE_LABELS: story.modeLabels,
  FLASH_PHRASES: story.flashPhrases,
  ALERT_PHRASES: story.alertPhrases,
  COMMAND_SESSIONS: story.commandSessions,
} as const;

export type LineCategory =
  | 'STATUS' | 'WARNING' | 'LORE' | 'QUOTES'
  | 'CMD' | 'RESP'
  | 'HQ' | 'DENY'
  | 'GHOSTLINK'   // system status from the secure mentor channel
  | 'INSTR';      // inbound message from the instructor (mentor)

export interface TerminalLine {
  category: LineCategory;
  text: string;
}

// Faux command sessions (story.commandSessions) — a `cmd` is typed at the prompt, then
// 1-3 response lines stream in, giving the terminal an interactive-session feel instead
// of a passive log. Each response item is a RespItem:
//   • plain string  → renders as RESP category (indented "↳ ...")
//   • { cat, text } → renders with that override category (e.g. QUOTES gets the "[":] ..."
//                     prefix) — used to surface lore/quotes with full impact INSIDE the
//                     conversational flow, not as ambient log noise.
// (Doc relocated here in Slice 1b — JSON can't carry the comment that lived above the
// COMMAND_SESSIONS literal; the consuming switch lives in hud/index.ts runCommandSession.)
export type RespItem = string | { cat: LineCategory; text: string };
export interface CommandSession {
  cmd: string;
  resp: readonly RespItem[];
}

const WEIGHTS: Record<string, [number, number, number, number]> = {
  // [STATUS, WARNING, LORE, QUOTES]
  none:   [1.0, 0.0, 0.0, 0.0],
  subtle: [0.6, 0.25, 0.05, 0.10],
  full:   [0.30, 0.25, 0.25, 0.20],
};

export function pickTerminalLine(
  intensity: 'none' | 'subtle' | 'full',
  rng: () => number,
): TerminalLine {
  const w = WEIGHTS[intensity];
  const r = rng();
  let acc = 0;
  const cats = ['STATUS', 'WARNING', 'LORE', 'QUOTES'] as const;
  for (let i = 0; i < cats.length; i++) {
    acc += w[i];
    if (r <= acc) {
      const pool = DICT.TERMINAL[cats[i]];
      return { category: cats[i], text: pool[Math.floor(rng() * pool.length)] };
    }
  }
  const pool = DICT.TERMINAL.STATUS;
  return { category: 'STATUS', text: pool[Math.floor(rng() * pool.length)] };
}

export function pickCommandSession(rng: () => number): { cmd: string; resp: readonly string[] } {
  const arr = DICT.COMMAND_SESSIONS;
  return arr[Math.floor(rng() * arr.length)];
}

export function pickFrom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}
