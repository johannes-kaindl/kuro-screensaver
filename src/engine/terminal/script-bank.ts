// Script bank — all the textual material for the operator's shift.
//
// Organized by phase. Each beat is a self-contained narrative micro-event.
// The narrative runner picks beats appropriate to the current phase + persona.
//
// Worldbuilding sources: NeuroVim FRAGMENTS 01-10, Mission briefings,
// THE RAVEN, FRAGMENT-09 anomaly audit terminology.

import type { OperatorPersona } from './persona';

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: ROUTINE — operator is calm, doing the job, professional cadence
// ─────────────────────────────────────────────────────────────────────────────

/** Routine commands (calm phase). Operator runs status checks. Replies categorized. */
export interface RoutineBeat {
  cmd: string | ((p: OperatorPersona) => string);
  resp: ReadonlyArray<string | { cat: 'OK' | 'WARN' | 'INFO'; text: string | ((p: OperatorPersona) => string) }>;
}

export const ROUTINE_BEATS: readonly RoutineBeat[] = [
  {
    cmd: (p) => `harmonization-cli status --node ${p.node}`,
    resp: [
      { cat: 'OK', text: 'ENGINE v4.1 NOMINAL' },
      { cat: 'OK', text: 'INTERCEPT RATE 94.2%' },
    ],
  },
  {
    cmd: 'audit-cli list --window 24h --tier informational',
    resp: [
      { cat: 'INFO', text: '7 events in window' },
      { cat: 'INFO', text: '5 auto-resolved' },
      { cat: 'INFO', text: '2 pending classification' },
    ],
  },
  {
    cmd: 'pattern-analysis check --baseline q1-2047',
    resp: [
      { cat: 'OK', text: 'BASELINE STABLE' },
      { cat: 'OK', text: 'p > 0.05 — within tolerance' },
    ],
  },
  {
    cmd: (p) => `relay-cluster query --node ${p.node} --metrics rate,latency`,
    resp: [
      { cat: 'OK', text: 'CLUSTER NOMINAL' },
      { cat: 'INFO', text: 'NEXT MAINT WINDOW: 03:00 UTC' },
    ],
  },
  {
    cmd: 'workforce-opt status --queue active',
    resp: [
      { cat: 'OK', text: 'ALL CASES PROCESSING' },
      { cat: 'INFO', text: '12 reclassifications scheduled' },
    ],
  },
  {
    cmd: 'telemetry flush --window 1h',
    resp: [
      { cat: 'OK', text: 'BUFFER FLUSHED // 14.2 MB' },
    ],
  },
  {
    cmd: 'comms ping --tier hq',
    resp: [
      { cat: 'OK', text: 'HQ RESPONSIVE // 1.4MS' },
    ],
  },
  {
    cmd: (p) => `transmit ${p.hq.toLowerCase()} -- nominal`,
    resp: [
      { cat: 'OK', text: 'TRANSMITTED // CHECKSUM OK' },
    ],
  },
  {
    cmd: (p) => `secure-transmit --tier ${p.hq.toLowerCase()} --priority routine "shift change confirmed"`,
    resp: [
      { cat: 'OK', text: 'ENCRYPTED // 1.4 KB' },
      { cat: 'OK', text: 'DELIVERY ACK' },
    ],
  },
  {
    cmd: 'compliance-rate --window 24h --sector 7',
    resp: [
      { cat: 'OK', text: '94.7% — within target' },
    ],
  },
  {
    cmd: (p) => `endpoint scan --sector ${p.sector} --depth shallow`,
    resp: [
      { cat: 'INFO', text: '847 endpoints scanned' },
      { cat: 'INFO', text: '0 flagged' },
      { cat: 'OK', text: 'NO LEGACY-PROTOCOL ACTIVITY' },
    ],
  },
  {
    cmd: 'corpsh log --tail 20 --since 1h',
    resp: [
      'engine.harmonization v4.1 — heartbeat',
      'relay-7.4 sync ok',
      'audit-stream — flushed',
    ],
  },
  {
    cmd: (p) => `report file --to ${p.hq.toLowerCase()} --status nominal`,
    resp: [
      { cat: 'OK', text: 'REPORT FILED' },
      { cat: 'INFO', text: `${'$P'} acknowledged` },
    ],
  },
  {
    cmd: 'pattern-analysis sigtest --window 14d',
    resp: [
      { cat: 'OK', text: 'CHI-SQUARE 0.087' },
      { cat: 'INFO', text: 'no anomalous skew' },
    ],
  },
];

// HQ messages addressed TO the operator (they appear unprompted in the feed).
export const HQ_INBOUND_ROUTINE: readonly string[] = [
  'shift roll: confirm presence',
  'q2 audit window opens 06-26 03:00 utc',
  'relay 7.4-N02 maintenance complete',
  'rotate credentials by 0400 utc',
  'reminder: legacy-protocol incidents tier-2 escalation',
];

// Operator's reply pattern to routine HQ pings — usually one word.
export const HQ_REPLY_ROUTINE: readonly string[] = [
  'present',
  'ack',
  'confirmed',
  'noted',
  'on it',
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: FIRST INTRUSION — the first quote/anomaly. Operator notices.
// ─────────────────────────────────────────────────────────────────────────────

/** A compromise event — something appears in the feed that shouldn't.
 *  text: the line that injects.  followup: optional second-line emphasis. */
export interface IntrusionEvent {
  text: string;
  /** Optional secondary line (e.g., a citation tag). */
  followup?: string;
}

export const INTRUSIONS_QUOTES: readonly IntrusionEvent[] = [
  { text: '"the work is the answer"' },
  { text: '"keep it low." — ghost-7' },
  { text: '"read twice. strike once." — raven' },
  { text: '"patterns break for those who read them"' },
  { text: '"the signal does not forget"' },
  { text: '"efficiency is another word for silence"' },
  { text: '"this document was not written. it was generated."' },
  { text: 'one word. that\'s all you get.' },
  { text: 'you remember the cold path.' },
  { text: 'the work is the answer.' },
  { text: 'silence is not acknowledgement.' },
  { text: 'i taught them the cold path. i know they remember it.' },
];

export const INTRUSIONS_FRAGMENTS: readonly IntrusionEvent[] = [
  { text: '> [recovered fragment // origin: unknown]', followup: '> "broadcast open. whoever finds this..."' },
  { text: '> from: WRAITH. one line. no reply.', followup: '> "if your cover is thinning, say so."' },
  { text: '> handler-tier transmission ends.' },
  { text: '> [pre-cascade archive — 2029-08-03]', followup: '> "it\'s not shortcuts, it\'s a language."' },
  { text: '> NEVERMORE noise pattern detected — UNHARMONIZED' },
];

/** Operator's reactions to detecting an intrusion (in order of escalation) */
export const REACTIONS_FIRST: readonly string[] = [
  'audit log --recent 50',
  'harmonization rerun --target last',
  'pattern --analyze --window 5m',
  'dmesg | grep WARN',
  'relay-cluster status',
];

export const REACTIONS_FIRST_RESP: readonly { cat: 'WARN' | 'INFO' | 'OK'; text: string }[] = [
  { cat: 'WARN', text: 'INJECTION DETECTED — origin unknown' },
  { cat: 'WARN', text: 'NEVERMORE pattern // UNREGISTERED' },
  { cat: 'INFO', text: '0 matching workforce records' },
  { cat: 'INFO', text: 'engine output // anomalous run detected' },
  { cat: 'WARN', text: 'no upstream flag — local insert?' },
];

// Operator's internal-monologue lines — typed at the prompt then deleted.
// Used to convey "he was about to say something but reconsidered".
export const HESITATIONS: readonly { typed: string; replacement: string }[] = [
  { typed: 'what was that',                replacement: 'audit log --tail' },
  { typed: 'did anyone else see',          replacement: 'pattern --check' },
  { typed: 'this isn\'t in the manual',    replacement: 'manual lookup --topic injection' },
  { typed: 'something\'s off',             replacement: 'dmesg | tail' },
  { typed: 'maybe i\'m misreading',        replacement: 'audit log --recent 10' },
  { typed: 'i should escalate',            replacement: 'comms ping hq' },
  { typed: 'should i flag this',           replacement: 'flag --severity low' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: ALARM — multiple intrusions. Operator escalates.
// ─────────────────────────────────────────────────────────────────────────────

export const REACTIONS_ALARM: readonly string[] = [
  'purge --line last',
  'harmonization rerun --hard',
  'pattern --analyze --deep',
  'sec --audit endpoint self',
  'comms escalate --tier 2',
  'firewall reset --partial',
];

export const REACTIONS_ALARM_RESP: readonly { cat: 'WARN' | 'DENY' | 'INFO'; text: string }[] = [
  { cat: 'INFO', text: 'PURGE QUEUED' },
  { cat: 'WARN', text: 'INJECTION RECURS — same byte signature' },
  { cat: 'DENY', text: 'COMMAND DENIED // ROOT COMPROMISE' },
  { cat: 'WARN', text: 'pattern concordance: cross-file match' },
  { cat: 'WARN', text: 'endpoint integrity check FAILED' },
  { cat: 'DENY', text: 'ESCALATION REJECTED // CHANNEL UNAUTHORIZED' },
];

// Drafts of the operator's HQ escalation message — typed, deleted, retyped.
// Each entry is one full reformulation cycle. Final version in `final`.
export const HQ_ESCALATION_DRAFTS: readonly { drafts: string[]; final: string }[] = [
  {
    drafts: [
      'unauthorized injection in sector feed possible compromise need',
      'unauthorized injection sector 7 possible compromise',
      'sector 7 anomaly possible',
    ],
    final: 'sector 7 anomaly. requesting tier-2 review.',
  },
  {
    drafts: [
      'something is wrong with the harmonization engine output',
      'engine output anomaly cross-file pattern',
      'engine v4.1 output integrity question',
    ],
    final: 'engine v4.1 output integrity flag. tier-2 review.',
  },
  {
    drafts: [
      'i think we have a problem in sector 7 the engine',
      'sector 7 engine v4.1 — recurring injection',
      'sector 7 — possible NEVERMORE drift',
    ],
    final: 'possible NEVERMORE drift sector 7. confirm protocol.',
  },
];

// HQ silent-or-automated responses — replies feel hollow / non-help.
export const HQ_NON_RESPONSES: readonly { cat: 'OK' | 'INFO' | 'AUTO'; text: string }[] = [
  { cat: 'AUTO', text: 'TICKET FILED // ID 7734-Δ-04891' },
  { cat: 'AUTO', text: 'AUTOMATED ACK // QUEUED FOR REVIEW' },
  { cat: 'INFO', text: 'response time non-guaranteed for non-priority' },
  { cat: 'AUTO', text: 'no human reviewer assigned at this tier' },
  { cat: 'INFO', text: 'HQ silent.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: PANIC — heavy backspacing, refused commands, fast intrusions
// ─────────────────────────────────────────────────────────────────────────────

export const REACTIONS_PANIC: readonly string[] = [
  'sec --lockdown self',
  'comms --emergency hq',
  'disconnect --force',
  'sudo purge',
  'kill --all sessions',
  'help',
  'who is doing this',
];

export const REACTIONS_PANIC_RESP: readonly { cat: 'DENY' | 'AUTO' | 'WARN'; text: string }[] = [
  { cat: 'DENY', text: 'COMMAND DENIED' },
  { cat: 'DENY', text: 'PERMISSION ESCALATION REFUSED' },
  { cat: 'AUTO', text: 'PROTOCOL LOCK ENGAGED' },
  { cat: 'DENY', text: 'CONNECTION HOLD — DO NOT TERMINATE' },
  { cat: 'DENY', text: 'no.' },
];

// Final drafts before silence — the operator gives up on professional language.
export const PANIC_DRAFTS: readonly { drafts: string[]; final: string }[] = [
  { drafts: ['help', 'help me', 'someone'], final: 'help' },
  { drafts: ['compromise sector 7', 'compromise', 'comp'], final: 'compromise' },
  { drafts: ['i need extraction', 'extraction sector 7', 'extract'], final: 'extract' },
  { drafts: ['who is this', 'who are you', 'why are you'], final: 'who' },
];

// What the system "says" back during panic — hostile or final.
export const SYSTEM_FINAL: readonly { cat: 'DENY' | 'WARN' | 'AUTO'; text: string }[] = [
  { cat: 'WARN', text: 'CONNECTION INTEGRITY: DEGRADED' },
  { cat: 'DENY', text: 'OUTBOUND COMMS BLOCKED' },
  { cat: 'AUTO', text: 'WORKFORCE OPTIMIZATION REVIEW SCHEDULED' },
  { cat: 'WARN', text: 'CHROME RAVEN PROTOCOL // YOU ARE NOT THE OPERATOR' },
  { cat: 'AUTO', text: 'SESSION TERMINATED // SUBJECT FLAGGED' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: SILENCE — final transmission, fade to black, reset
// ─────────────────────────────────────────────────────────────────────────────

export const FAREWELLS: readonly string[] = [
  '> you should have used the cold path.',
  '> the work is the answer.',
  '> "keep it low." — ghost-7',
  '> the signal does not forget.',
  '> [TRANSMISSION ENDS]',
  '> goodnight, officer.',
];

// Operator's last-typed line — half-finished, abandoned mid-word like FRAGMENT-02.
export const LAST_WORDS: readonly { typed: string; abandonAt: number }[] = [
  { typed: 'i was just running through the final wait someone\'s at the door and that', abandonAt: 0 /* never aborts */ },
  { typed: 'tell my', abandonAt: 0 },
  { typed: 'who are y', abandonAt: 0 },
  { typed: 'no n', abandonAt: 0 },
  { typed: 'why', abandonAt: 0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// MENTOR — Instructor-Karsen, the operator's former teacher at CORP Academy IV.
// Encrypted "ghostlink" backchannel. Karsen speaks in koans — terse, withholding,
// careful. As the operator's situation worsens, his replies grow shorter, more
// guarded, until eventually silent.
// ─────────────────────────────────────────────────────────────────────────────

export const MENTOR_NAME = 'INSTR-KARSEN';

/** Lines that play during ghostlink channel setup, in order. <HASH> is replaced. */
export const GHOSTLINK_HANDSHAKE: readonly string[] = [
  'handshake initiated',
  'key exchange: ECDH-P384 ........ OK',
  'session hash: <HASH>',
  'tunnel established // recipient acknowledged',
];

/** ASCII-pseudo-hash for visual flavor. */
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
  /** Operator's outbound (typed at the prompt as `secure-transmit "..."`). */
  out: string;
  /** Mentor's reply lines — render with INSTR category. Empty = silence. */
  reply: readonly string[];
  /** Phase this exchange fits. */
  phase: 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC';
}

export const MENTOR_EXCHANGES: readonly MentorExchange[] = [
  // ── ROUTINE — friendly check-ins ───────────────────────────────────────
  { phase: 'ROUTINE', out: 'shift opened. quiet so far.',
    reply: ['copy.', 'enjoy it while it lasts.'] },
  { phase: 'ROUTINE', out: 'q2 audit window opens monday. anything to know?',
    reply: ['watch the relay timing.', 'baseline drift means questions you can\'t answer.'] },
  { phase: 'ROUTINE', out: 'do you remember the sector seven thing from training?',
    reply: ['yes.', 'why.'] },
  { phase: 'ROUTINE', out: 'how are you',
    reply: ['working.', 'work is the answer.'] },
  { phase: 'ROUTINE', out: 'rotation starts thursday. cover holding fine.',
    reply: ['good.', 'eat something today.'] },

  // ── INTRUSION — first concerns ─────────────────────────────────────────
  { phase: 'INTRUSION', out: 'seeing strings in the harmonization output that aren\'t in the spec.',
    reply: ['describe.'] },
  { phase: 'INTRUSION', out: 'looks like text. fragments. maybe injection.',
    reply: ['log it.', 'don\'t engage.', 'capture pattern before any purge.'] },
  { phase: 'INTRUSION', out: 'is this what we covered in module 14?',
    reply: ['no.', 'module 14 is theory.', 'this is a different thing.'] },
  { phase: 'INTRUSION', out: 'inter-injection distance is wrong',
    reply: ['p value?', 'how many windows.'] },
  { phase: 'INTRUSION', out: 'i think this is signed',
    reply: ['by whom.'] },

  // ── ALARM — increasing tension, mentor grows guarded ───────────────────
  { phase: 'ALARM', out: 'they keep coming back. same byte signature.',
    reply: ['then it\'s deliberate.', 'someone is talking to you.', 'be careful what you answer.'] },
  { phase: 'ALARM', out: 'should i tell hq',
    reply: ['hq is automated at this hour.', 'wait until thursday.', 'and not from this terminal.'] },
  { phase: 'ALARM', out: 'i think my session is compromised',
    reply: ['if it is, this channel is too.', 'sit. breathe. read.'] },
  { phase: 'ALARM', out: 'i\'m about to escalate',
    reply: ['to whom.'] },
  { phase: 'ALARM', out: 'the engine is lying to me',
    reply: ['the engine has always been lying.', 'the question is who\'s listening now.'] },
  { phase: 'ALARM', out: 'tell me what to do',
    reply: ['nothing fast.', 'nothing recorded.', 'nothing from there.'] },

  // ── PANIC — final warnings, then silence ───────────────────────────────
  { phase: 'PANIC', out: 'they know my designation',
    reply: ['they always did.'] },
  { phase: 'PANIC', out: 'help',
    reply: ['route the question through the right channel.', 'not this one.', 'i taught you the cold path.'] },
  { phase: 'PANIC', out: 'please',
    reply: ['i\'m sorry.'] },
  { phase: 'PANIC', out: 'are you still there',
    reply: [] },                           // silence
  { phase: 'PANIC', out: 'karsen',
    reply: [] },                           // silence
];

/** GHOSTLINK status messages used between exchanges. */
export const GHOSTLINK_TRANSMIT_LINES = (sizeKb: string): readonly string[] => [
  `encrypted (${sizeKb} KB) → ${MENTOR_NAME}`,
  'delivery: pending',
];
export const GHOSTLINK_INBOUND  = `inbound // ${MENTOR_NAME}`;
export const GHOSTLINK_TIMEOUT  = 'no response.';
export const GHOSTLINK_TEARDOWN = 'channel closed.';

// Foreshadow hints for an upcoming scene, keyed by sceneId. Emitted ~6s before the
// warp (Brick C) so the transition feels motivated. Same lore register as the bank.
export const SCENE_FORESHADOW: Record<string, string[]> = {
  terrain: ['// dropping to terrain sweep', '// low-altitude recon vector locked'],
  city:    ['// proximity alert: megacity grid ahead', '// approach vector — CHROME district'],
  rift:    ['// fault line detected — descending', '// the floor opens up ahead'],
  tunnel:  ['// hyperdrive spinning up', '// conduit acquired — punch-through in 3'],
  void:    ['// debris field on the scope', '// CORP station wreckage ahead'],
};

/** Deterministic foreshadow line for a scene (index keeps it varied + reproducible). */
export function foreshadowLine(scene: string, index: number): string | null {
  const lines = SCENE_FORESHADOW[scene];
  return lines && lines.length ? lines[index % lines.length] : null;
}
