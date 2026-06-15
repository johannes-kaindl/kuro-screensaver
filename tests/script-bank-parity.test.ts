import { describe, it, expect } from 'vitest';
import { mkRng } from '../src/engine/engine/rng';
import { makePersona, subst, type OperatorPersona } from '../src/engine/terminal/persona';
import * as bank from '../src/engine/terminal/script-bank';

// Additive-invariant guard for the JSON-SSOT migration (Slice 1). The migration
// converts ROUTINE_BEATS cmd functions → token strings resolved by subst(), and
// moves all pools into story-content.json. This test pins:
//   (a) a hash of every PLAIN pool (must stay byte-identical through the move), and
//   (b) a hash of the RESOLVED routine cmd+resp stream for a fixed persona (must stay
//       identical when functions become token+subst).
// The resolver below handles BOTH the pre-migration (function) and post-migration
// (token string) forms, so this exact test stays green across the refactor.

function fnv1a(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  const enc = new TextEncoder().encode(s);
  for (const b of enc) { h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h;
}

const persona = makePersona(mkRng(2025));

function resolveCmd(cmd: unknown, p: OperatorPersona): string {
  return typeof cmd === 'function' ? (cmd as (x: OperatorPersona) => string)(p) : subst(p, cmd as string);
}
function resolveRespText(r: unknown, p: OperatorPersona): string {
  const raw = typeof r === 'string' ? r
    : typeof (r as { text: unknown }).text === 'function'
      ? ((r as { text: (x: OperatorPersona) => string }).text)(p)
      : ((r as { text: string }).text);
  return subst(p, raw);   // no-op on already-resolved strings; resolves $P on resp
}

// Effective render category, mirroring narrative.ts:315-316 (OK→STATUS, WARN→WARNING,
// bare string / INFO → RESP). Captured so a resp shape/category drift is caught too.
function effCat(r: unknown): string {
  if (typeof r === 'string') return 'RESP';
  const cat = (r as { cat?: string }).cat;
  return cat === 'OK' ? 'STATUS' : cat === 'WARN' ? 'WARNING' : 'RESP';
}

function routineStream(): string {
  let out = '';
  for (const beat of bank.ROUTINE_BEATS) {
    out += 'CMD:' + resolveCmd(beat.cmd, persona) + '\n';
    for (const r of beat.resp) out += effCat(r) + ':' + resolveRespText(r, persona) + '\n';
  }
  return out;
}

function plainPools(): string {
  // Every pool EXCEPT ROUTINE_BEATS (functions can't serialize; covered by routineStream).
  return JSON.stringify({
    HQ_INBOUND_ROUTINE: bank.HQ_INBOUND_ROUTINE,
    HQ_REPLY_ROUTINE: bank.HQ_REPLY_ROUTINE,
    INTRUSIONS_QUOTES: bank.INTRUSIONS_QUOTES,
    INTRUSIONS_FRAGMENTS: bank.INTRUSIONS_FRAGMENTS,
    REACTIONS_FIRST: bank.REACTIONS_FIRST,
    REACTIONS_FIRST_RESP: bank.REACTIONS_FIRST_RESP,
    HESITATIONS: bank.HESITATIONS,
    REACTIONS_ALARM: bank.REACTIONS_ALARM,
    REACTIONS_ALARM_RESP: bank.REACTIONS_ALARM_RESP,
    HQ_ESCALATION_DRAFTS: bank.HQ_ESCALATION_DRAFTS,
    HQ_NON_RESPONSES: bank.HQ_NON_RESPONSES,
    REACTIONS_PANIC: bank.REACTIONS_PANIC,
    REACTIONS_PANIC_RESP: bank.REACTIONS_PANIC_RESP,
    PANIC_DRAFTS: bank.PANIC_DRAFTS,
    SYSTEM_FINAL: bank.SYSTEM_FINAL,
    FAREWELLS: bank.FAREWELLS,
    LAST_WORDS: bank.LAST_WORDS,
    MENTOR_NAME: bank.MENTOR_NAME,
    GHOSTLINK_HANDSHAKE: bank.GHOSTLINK_HANDSHAKE,
    GHOSTLINK_INBOUND: bank.GHOSTLINK_INBOUND,
    GHOSTLINK_TIMEOUT: bank.GHOSTLINK_TIMEOUT,
    GHOSTLINK_TEARDOWN: bank.GHOSTLINK_TEARDOWN,
    MENTOR_EXCHANGES: bank.MENTOR_EXCHANGES,
    SCENE_FORESHADOW: bank.SCENE_FORESHADOW,
    SCENE_ARRIVAL: bank.SCENE_ARRIVAL,
    COMBAT_LINES: bank.COMBAT_LINES,
  });
}

describe('script-bank SSOT migration parity', () => {
  it('routine cmd+resp resolve byte-identically (functions → token+subst)', () => {
    expect(fnv1a(routineStream())).toBe(240487417651606697n);
  });

  it('plain pools survive the move into story-content.json unchanged', () => {
    expect(fnv1a(plainPools())).toBe(16533446474660952139n);
  });
});
