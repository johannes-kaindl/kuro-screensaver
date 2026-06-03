// @ts-nocheck
// Spoiler-free atmospheric dictionary, NeuroVim-flavored.
// Pools are mixed at runtime; lore intensity controls categorical weights.

export const DICT = {
  BOOT_LINES: [
    'CRONOS-7 BIOS v5.1.0 ... ',
    'NEURAL UPLINK // GHOST RELAY ESTABLISHED ... ',
    'WEBGL RENDERER // ANTIALIAS ... ',
    'UNREAL BLOOM + AFTERIMAGE PASS ... ',
    'PROCEDURAL GEOMETRY ENGINE // SEEDED ... ',
    'SECTOR-7 PERIMETER NOMINAL ... ',
    'CODEX MATRIX // 2841 NODES SYNCED ... ',
    'ANCHOR DOCTRINE LOADED ... ',
    'CHROME RAVEN PROTOCOL // STANDBY ... ',
    'SIGNAL HUNTER // PASSIVE LISTEN ... ',
    'PATTERN BREAKER // ARMED ... ',
    'OBSIDIAN VAULT INTERFACE ... ',
    'KATA QUEUE FLUSHED ... ',
    'WILDCARD PROTOCOL ARMED ... ',
    'MIRROR REWRITE STAGED ... ',
  ] as const,

  BOOT_HEADERS: {
    terrain: '>> TERRAIN SWEEP ENGAGED // RECON ALTITUDE',
    city:    '>> CITY RECON ONLINE // LOW ALTITUDE APPROACH',
    rift:    '>> RIFT INCURSION ACTIVE // INVERSION VECTOR ARMED',
    tunnel:  '>> TUNNEL LOCK CONFIRMED // INFIL VECTOR PRIMED',
    void:    '>> VOID DRIFT ACTIVE // DEEP SPACE ANCHOR',
    matrix:  '>> MATRIX RAIN ENGAGED // DIGITAL DOWNPOUR',
  } as const,

  TERMINAL: {
    STATUS: [
      '> SIGNAL CLEAR // SECTOR-9 NOMINAL',
      '> PROTOCOL READER ACTIVE',
      '> GHOST RELAY: 14 OPERATIVES ACTIVE',
      '> PERIMETER SCAN CLEAR',
      '> NEURAL LATENCY: 1.4MS',
      '> ALL SYSTEMS NOMINAL',
      '> COMMS BURST RECEIVED // DECRYPTING',
      '> ANTENNA RELAY // SECTOR 7-F ACTIVE',
      '> LIDAR ECHO: NOMINAL',
      '> FLIGHT DECK NOMINAL // WP-3 AHEAD',
      '> VECTOR GRID STABLE',
      '> THREE.JS WEBGL // OBSIDIAN PLUGIN ACTIVE',
    ] as const,

    WARNING: [
      '> PATTERN BREAK DETECTED // SECTOR-12',
      '> CHROME RAVEN INBOUND // RANGE 2.1KM',
      '> HEAT SIG: 3 CONTACTS // ROOFTOP DELTA',
      '> ECM COUNTERMEASURE // ACTIVE',
      '> POWER GRID ANOMALY: SECTOR-12 WEST',
      '> HOSTILE UAV: RANGE 2.1KM NORTHEAST',
      '> ANOMALY AUDIT QUEUED',
      '> WARNING: UNKNOWN SIGNAL ON SECTOR-7',
      '> TRACE PURGE INITIATED',
    ] as const,

    LORE: [
      '> FRAGMENT 04 RECOVERED',
      '> CODEX SYNC AT 87.3%',
      '> ANCHOR DOCTRINE: HOLDING',
      '> PRE-CORP ARCHIVE INDEXED',
      '> KATA STREAK: 14',
      '> WILDCARD PROTOCOL ARMED',
      '> MIRROR REWRITE PENDING',
      '> HANDLER LOG: ENTRY 0021',
      '> EXTRACTION HOLD CLEARED',
    ] as const,

    QUOTES: [
      '> "KEEP IT LOW." — GHOST-7',
      '> "PATTERNS BREAK FOR THOSE WHO READ THEM."',
      '> "THE SIGNAL DOES NOT FORGET."',
      '> "READ TWICE. STRIKE ONCE." — RAVEN',
      '> "IT DOESN\'T MATTER." — PLISSKEN',
      '> "EFFICIENCY IS ANOTHER WORD FOR SILENCE."',
    ] as const,
  },

  HUD_HANDLES: [
    'GHOST@CRONOS-7', 'RAVEN@SECTOR-9', 'WRAITH@URBAN-DELTA',
    'OPERATIVE@CODEX', 'NULL@VOID-12', 'CIPHER@ANCHOR-3',
  ] as const,

  MODE_LABELS: {
    terrain: ['RECON', 'SWEEP', 'PATROL'],
    city:    ['LOW LEVEL', 'URBAN', 'HIGH PASS'],
    rift:    ['THE RIFT', 'CHASM', 'INVERSION'],
    tunnel:  ['INFIL', 'TRANSIT', 'BOOST'],
    void:    ['DRIFT', 'BELT', 'SWARM'],
    matrix:  ['RAIN', 'CASCADE', 'DELUGE'],
  } as const,

  FLASH_PHRASES: [
    'SECTOR-7 BREACH', 'ANCHOR HOLD', 'CHROME RAVEN', 'CODEX MATRIX',
    'PATTERN BREAK', 'GHOST RELAY', 'SIGNAL LOST', 'TRACE PURGE',
    'WILDCARD ARMED', 'MIRROR REWRITE',
  ] as const,

  ALERT_PHRASES: [
    'INTRUSION DETECTED // SECTOR 9',
    'PROTOCOL VIOLATION // PURGE INITIATED',
    'TRACE ACQUIRED // GO DARK',
    'CHROME RAVEN UNCAGED // EVASIVE',
    'ANCHOR LOST // RECONNECT IN 03:00',
  ] as const,

  // Faux command sessions — typed at the prompt, then 1-3 response lines stream in.
  // Gives the terminal an interactive-session feel instead of a passive log.
  //
  // Response items:
  //   • plain string  → renders as RESP category (indented "↳ ...")
  //   • {cat, text}   → renders with override category (e.g. QUOTES gets "[":] ..."
  //                     prefix) — used to surface lore/quotes with full impact
  //                     INSIDE the conversational flow, not as ambient log noise.
  COMMAND_SESSIONS: [
    // Pure technical sessions
    { cmd: 'status --sector 7',          resp: ['SECTOR-7 PERIMETER NOMINAL', '14 OPERATIVES ACTIVE'] },
    { cmd: 'scan --threats',             resp: ['0 INTERCEPTS // CORRIDOR CLEAR', 'NEAREST CONTACT 2.1KM N'] },
    { cmd: 'ping cronos-7',              resp: ['CRONOS-7 RESPONSIVE // 1.4MS'] },
    { cmd: 'tail -f /var/log/relay',     resp: ['ANTENNA RELAY // SECTOR 7-F ACTIVE', 'COMMS BURST RECEIVED // DECRYPTING', 'GHOST RELAY: 14 OPERATIVES'] },
    { cmd: 'whoami',                     resp: ['ghost-7 / sector-9 / priv::deep'] },
    { cmd: 'comms list --active',        resp: ['CRONOS-7 (encrypted)', 'RAVEN (relay)', 'NULL (backup)'] },
    { cmd: 'route --to anchor-3',        resp: ['BEARING 287° // RANGE 4.2KM', 'ETA 02:14'] },
    { cmd: 'sec --audit perimeter',      resp: ['PERIMETER NOMINAL', 'NO BREACH IN 142H'] },
    { cmd: 'kata streak',                resp: ['CURRENT STREAK: 14', 'BEST: 27', 'PATTERN BREAK PROBABILITY: 0.04'] },

    // Sessions that surface LORE — codex queries, fragment work, protocol arming
    { cmd: 'fragment recover --id 04',   resp: [
        { cat: 'LORE' as const, text: 'FRAGMENT 04 RECOVERED' },
        { cat: 'LORE' as const, text: 'CODEX SYNC AT 87.3%' } ] },
    { cmd: 'codex query anchor-doctrine', resp: [
        { cat: 'LORE' as const, text: 'ANCHOR DOCTRINE: HOLDING' },
        { cat: 'LORE' as const, text: 'NODE COUNT: 2841' },
        'SYNC NOMINAL' ] },
    { cmd: 'codex query handler-7',      resp: [
        { cat: 'LORE' as const, text: 'HANDLER LOG: ENTRY 0021' },
        { cat: 'QUOTES' as const, text: '"KEEP IT LOW." — GHOST-7' } ] },
    { cmd: 'mirror --status',            resp: [
        { cat: 'LORE' as const, text: 'MIRROR REWRITE PENDING' },
        'STAGE: 3/7' ] },
    { cmd: 'fragment list --recovered',  resp: [
        { cat: 'LORE' as const, text: 'FRAGMENT 02 INDEXED' },
        { cat: 'LORE' as const, text: 'FRAGMENT 04 INDEXED' },
        { cat: 'LORE' as const, text: 'FRAGMENT 09 PARTIAL' } ] },

    // Sessions that surface QUOTES — "whispers" to NPCs
    { cmd: 'whisper plisken',            resp: [
        { cat: 'QUOTES' as const, text: '"IT DOESN\'T MATTER." — PLISSKEN' } ] },
    { cmd: 'whisper raven',              resp: [
        { cat: 'QUOTES' as const, text: '"READ TWICE. STRIKE ONCE." — RAVEN' } ] },
    { cmd: 'whisper ghost-7',            resp: [
        { cat: 'QUOTES' as const, text: '"KEEP IT LOW." — GHOST-7' } ] },
    { cmd: 'codex quote --rand',         resp: [
        { cat: 'QUOTES' as const, text: '"PATTERNS BREAK FOR THOSE WHO READ THEM."' } ] },
    { cmd: 'codex quote --rand',         resp: [
        { cat: 'QUOTES' as const, text: '"THE SIGNAL DOES NOT FORGET."' } ] },
    { cmd: 'codex quote --rand',         resp: [
        { cat: 'QUOTES' as const, text: '"EFFICIENCY IS ANOTHER WORD FOR SILENCE."' } ] },

    // Sessions that surface WARNINGS — armed protocols, anomalies
    { cmd: 'protocol arm wildcard',      resp: [
        { cat: 'WARNING' as const, text: 'WILDCARD PROTOCOL ARMED' },
        { cat: 'WARNING' as const, text: 'TRACE PURGE STAGED' } ] },
    { cmd: 'pattern --analyze',          resp: [
        { cat: 'WARNING' as const, text: 'PATTERN BREAK DETECTED // SECTOR-12' },
        { cat: 'QUOTES' as const, text: '"PATTERNS BREAK FOR THOSE WHO READ THEM."' } ] },
    { cmd: 'sec --audit chrome-raven',   resp: [
        { cat: 'WARNING' as const, text: 'CHROME RAVEN UNCAGED // EVASIVE' },
        'LAST PING: 03:14:22' ] },
  ] as const,
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
