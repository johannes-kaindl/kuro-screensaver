// Narrative runner — orchestrates a CORP operator's shift on the terminal.
//
// State machine: ROUTINE → INTRUSION → ALARM → PANIC → SILENCE → (reset)
// Each phase has its own beat scheduler, intrusion frequency, and command pool.
// The runner is interruptible; calling stop() kills all pending beats and timers.
//
// Public surface is small: construct with HUD APIs, call start(), call stop().
// Phase transitions are time-driven (with phase-dependent durations) but can
// also be advanced by intrusion-saturation triggers.

import type { Hud } from '../hud';
import type { LineCategory } from '../data/dictionary';
import { typeInto, typeAndErase } from './typing';
import type { OperatorPersona } from './persona';
import { makePersona, profileFor, phaseModulate, subst } from './persona';
import {
  ROUTINE_BEATS, HQ_INBOUND_ROUTINE, HQ_REPLY_ROUTINE,
  INTRUSIONS_QUOTES, INTRUSIONS_FRAGMENTS,
  REACTIONS_FIRST, REACTIONS_FIRST_RESP, HESITATIONS,
  REACTIONS_ALARM, REACTIONS_ALARM_RESP,
  HQ_ESCALATION_DRAFTS, HQ_NON_RESPONSES,
  REACTIONS_PANIC, REACTIONS_PANIC_RESP,
  PANIC_DRAFTS, SYSTEM_FINAL,
  ENDINGS,
  MENTOR_NAME, GHOSTLINK_HANDSHAKE, MENTOR_EXCHANGES,
  GHOSTLINK_TRANSMIT_LINES, GHOSTLINK_INBOUND, GHOSTLINK_TIMEOUT,
  genHash,
} from './script-bank';
import type { MentorExchange } from './script-bank';
import {
  pick, pickArc, selectArc, resolveEnding,
  type ArcState, type ArcTemplate, type Stage, type EndingId,
} from './arc';

export type Phase = 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC' | 'SILENCE';

// Phase-dependent expected duration (seconds). Variance applied at runtime.
// Total cycle: ~6-9 minutes. ROUTINE kept short so first intrusion lands while
// user attention is still fresh; ALARM and PANIC get the bulk of dramatic time.
const PHASE_DURATION: Record<Phase, [number, number]> = {
  ROUTINE:    [70, 110],
  INTRUSION:  [110, 160],
  ALARM:      [120, 180],
  PANIC:      [60, 100],
  SILENCE:    [25, 45],
};

const NEXT_PHASE: Record<Phase, Phase> = {
  ROUTINE: 'INTRUSION', INTRUSION: 'ALARM', ALARM: 'PANIC', PANIC: 'SILENCE', SILENCE: 'ROUTINE',
};

export interface NarrativeRunnerDeps {
  hud: Hud;
  /** Span receiving the operator's typed input (no handle, no cursor). */
  promptInputEl: HTMLElement;
  /** Span holding the operator handle prefix (e.g. "OFC-3041@SCT-7.4-R3:~"). */
  promptHandleEl: HTMLElement;
  /**
   * Optional shift-end transition. When provided, the SILENCE→ROUTINE reset
   * plays this instead of a silent blank — the CRT crash sequence. The
   * narrative calls it with a `clearScreen` callback to invoke at the blackout
   * peak (so the shift change happens behind black), and the returned promise
   * resolves once the reboot flicker is done.
   */
  onShiftEnd?: (clearScreen: () => void) => Promise<void>;
  /** Fired when an intrusion event lands — drives the reactive-world camera hesitation. */
  onIntrusion?: () => void;
  /** Fired when a phase begins — the film warps to this phase's scene (Brick C). */
  onPhaseEnter?: (phase: Phase) => void;
  /** Resolve a foreshadow line for the NEXT phase's scene (null = none). */
  sceneForeshadow?: (nextPhase: Phase) => string | null;
}

export class NarrativeRunner {
  private phase: Phase = 'ROUTINE';
  private phaseStartedAt = 0;
  private phaseEndsAt = 0;
  private alive = false;
  private timers: number[] = [];
  private currentTyping: { abort(): void } | null = null;
  /** Incremented on every phase change. Each beat loop tracks its own gen and bails when stale. */
  private generation = 0;
  /** Whether the mentor (ghostlink) channel has been opened this shift. */
  private ghostlinkOpen = false;
  /** Track which mentor exchanges have already been used this shift to prevent repeats. */
  private usedExchanges = new Set<MentorExchange>();

  /** Selected arc for the current shift (undefined = today's behaviour, inert). */
  private arc: ArcState | undefined;
  /** Recently-selected arc ids (in-memory ring; persistence is Slice 3). */
  private arcsCompleted: string[] = [];
  /** Ending resolved at SILENCE entry; selects the farewells/lastWords set. */
  private endingId: EndingId = 'normal';

  // Persona for the current shift
  persona: OperatorPersona;

  /**
   * @param durationScale  Scales every phase's duration. 1 = full ~6-9 min
   *   shift (live default). The video render uses ~⅓ for a ~2-3 min loop;
   *   tiny values (~0.04) run a whole cycle in seconds for crash-seam testing.
   *   Does NOT speed up typing or beats — only how long each phase lasts.
   */
  constructor(public d: NarrativeRunnerDeps, rng: () => number, private durationScale = 1,
              private arcs: readonly ArcTemplate[] = []) {
    this.persona = makePersona(rng);
    this.refreshPrompt();
  }

  // ── Reactive-world signal (read by ReactiveWorld each frame) ───────────
  /** Current shift phase. */
  get currentPhase(): Phase { return this.phase; }
  /** 0..1 elapsed within the current phase (from the live phase timers). */
  get phaseProgress(): number {
    const span = this.phaseEndsAt - this.phaseStartedAt;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (Date.now() - this.phaseStartedAt) / span));
  }

  /** Fed each frame by ReactiveWorld; tracks the shift's peak corruption stage. */
  updateThreatStage(stage: Stage): void {
    if (!this.arc) return;
    this.arc.threatStage = stage;
    if (stage > this.arc.peakStage) this.arc.peakStage = stage;
  }

  /** Arc-aware phase routing (falls back to the linear default). */
  private nextPhaseOf(p: Phase): Phase {
    return this.arc?.arc.phaseRouting?.[p] ?? NEXT_PHASE[p];
  }

  /** Is the mentor reachable this phase? No arc → today's behaviour (always). */
  private mentorAvailable(phase: Phase): boolean {
    if (!this.arc) return true;
    const m = this.arc.arc.mentor;
    return !!m && m.availablePhases.includes(phase);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  start() {
    this.alive = true;
    this.enterPhase('ROUTINE');
  }

  stop() {
    this.alive = false;
    this.timers.splice(0).forEach((id) => clearTimeout(id));
    this.currentTyping?.abort();
  }

  /** Pause: same as stop but keeps state — call resume() to continue with same persona. */
  pause() {
    this.alive = false;
    this.timers.splice(0).forEach((id) => clearTimeout(id));
    this.currentTyping?.abort();
  }

  resume() {
    if (this.alive) return;
    this.alive = true;
    this.enterPhase(this.phase);   // restart the current phase loop
  }

  // ── Phase machine ──────────────────────────────────────────────────────
  private enterPhase(p: Phase) {
    if (!this.alive) return;
    // Cancel any in-flight typing from the previous phase to clean the input line.
    this.currentTyping?.abort();
    this.currentTyping = null;
    this.d.promptInputEl.textContent = '';
    // Bump generation — this signals all running beat loops to bail.
    this.generation++;
    const myGen = this.generation;
    this.phase = p;
    if (p === 'SILENCE') {
      this.endingId = this.arc ? resolveEnding(this.arc.arc, this.arc.peakStage) : 'normal';
    }
    this.d.onPhaseEnter?.(p);
    const [lo, hi] = PHASE_DURATION[p];
    const arcScale = this.arc?.arc.durationScale?.[p] ?? 1;
    this.phaseStartedAt = Date.now();
    this.phaseEndsAt = this.phaseStartedAt + (lo + Math.random() * (hi - lo)) * 1000 * this.durationScale * arcScale;
    this.scheduleTransition();
    this.runPhaseLoop(myGen);
  }

  private scheduleTransition() {
    const wait = Math.max(2000, this.phaseEndsAt - Date.now());
    const gen = this.generation;
    // Foreshadow the upcoming scene ~6s before the phase boundary (Brick C).
    // Scale the lead with durationScale so it works at any film speed.
    const lead = 6000 * this.durationScale;
    if (wait > lead + 1500) {
      this.timers.push(window.setTimeout(() => {
        if (!this.alive || this.generation !== gen) return;
        const line = this.d.sceneForeshadow?.(this.nextPhaseOf(this.phase));
        if (line) void this.d.hud.addLine(line, 'HQ');
      }, wait - lead));
    }
    this.timers.push(window.setTimeout(() => {
      if (!this.alive) return;
      if (this.nextPhaseOf(this.phase) === 'ROUTINE') {
        // Reset between shifts — fresh persona, brief blank moment
        this.silentReset(() => {
          this.persona = makePersona(Math.random);
          this.refreshPrompt();
          if (this.arcs.length) {
            const tmpl = selectArc(this.arcs, this.arcsCompleted);
            this.arc = { arc: tmpl, threatStage: 0, peakStage: 0 };
            this.arcsCompleted.push(tmpl.id);
            if (this.arcsCompleted.length > 3) this.arcsCompleted.shift();
          }
          this.enterPhase('ROUTINE');
        });
      } else {
        this.enterPhase(this.nextPhaseOf(this.phase));
      }
    }, wait));
  }

  /**
   * Clear the terminal output and prompt for a fresh shift. The blank moment
   * IS the transition — no narrator-style "shift change" text needed.
   */
  private silentReset(then: () => void) {
    const clearScreen = () => {
      const out = this.d.hud.termOut;
      while (out.firstChild) out.removeChild(out.firstChild);
      this.d.promptInputEl.textContent = '';
      this.d.promptHandleEl.textContent = '';               // hide handle during blank
      // Reset per-shift state
      this.ghostlinkOpen = false;
      this.usedExchanges.clear();
    };

    // With a shift-end transition (CRT crash), the screen is cleared behind
    // the blackout and the new shift begins once power flickers back.
    if (this.d.onShiftEnd) {
      void this.d.onShiftEnd(clearScreen).then(() => {
        if (!this.alive) return;
        this.timers.push(window.setTimeout(() => {
          if (this.alive) then();
        }, 500 + Math.random() * 500));
      });
      return;
    }

    // Fallback: silent blank moment IS the transition.
    clearScreen();
    this.timers.push(window.setTimeout(() => {
      if (!this.alive) return;
      then();
    }, 3500 + Math.random() * 2500));
  }

  // ── Per-phase beat loops ───────────────────────────────────────────────
  private async runPhaseLoop(gen: number): Promise<void> {
    while (this.alive && this.generation === gen && Date.now() < this.phaseEndsAt) {
      switch (this.phase) {
        case 'ROUTINE':   await this.beatRoutine();   break;
        case 'INTRUSION': await this.beatIntrusion(); break;
        case 'ALARM':     await this.beatAlarm();     break;
        case 'PANIC':     await this.beatPanic();     break;
        case 'SILENCE':   await this.beatSilence();   break;
      }
      if (this.generation !== gen) return;
      const [lo, hi] = PHASE_REST[this.phase];
      await this.sleep(lo + Math.random() * (hi - lo));
    }
  }

  // ── Mentor exchange: encrypted ghostlink to former instructor ──────────
  /**
   * Run one ghostlink exchange. First call per shift opens the channel
   * (handshake); subsequent calls are short transmit + reply. Mentor's tone
   * follows the phase (terse → withholding → silent) via MENTOR_EXCHANGES tags.
   */
  private async beatMentor(phase: 'ROUTINE' | 'INTRUSION' | 'ALARM' | 'PANIC') {
    if (!this.ghostlinkOpen) {
      // First time this shift — full handshake
      await this.typeAtPrompt(`ghostlink init --recipient ${MENTOR_NAME} --priority advisory`);
      await this.sleep(220);
      this.commit('CMD');
      const hash = genHash();
      for (const line of GHOSTLINK_HANDSHAKE) {
        await this.sleep(380 + Math.random() * 420);
        await this.d.hud.addLine(line.replace('<HASH>', hash), 'GHOSTLINK');
      }
      this.ghostlinkOpen = true;
      await this.sleep(700);
    }

    // Pick an unused exchange for this phase, fall back to any if exhausted
    const candidates = MENTOR_EXCHANGES.filter(
      (e) => e.phase === phase && !this.usedExchanges.has(e),
    );
    const pool = candidates.length > 0 ? candidates : MENTOR_EXCHANGES.filter((e) => e.phase === phase);
    if (pool.length === 0) return;
    const exchange = pool[Math.floor(Math.random() * pool.length)];
    this.usedExchanges.add(exchange);

    // Operator types the secure-transmit
    await this.typeAtPrompt(`secure-transmit "${exchange.out}"`);
    await this.sleep(280);
    this.commit('CMD');

    // Ghostlink status
    const sizeKb = (0.8 + Math.random() * 1.6).toFixed(1);
    for (const line of GHOSTLINK_TRANSMIT_LINES(sizeKb)) {
      await this.sleep(280 + Math.random() * 280);
      await this.d.hud.addLine(line, 'GHOSTLINK');
    }

    // Mentor reply (or silence)
    if (exchange.reply.length === 0) {
      await this.sleep(7000 + Math.random() * 4000);
      await this.d.hud.addLine(GHOSTLINK_TIMEOUT, 'GHOSTLINK');
      return;
    }

    // Reply delay scales with phase tension — calmer phases = faster, panic = sometimes long pause
    const baseDelay = phase === 'PANIC' ? 4500 : phase === 'ALARM' ? 3200 : 2200;
    await this.sleep(baseDelay + Math.random() * 2500);
    await this.d.hud.addLine(GHOSTLINK_INBOUND, 'GHOSTLINK');
    for (const r of exchange.reply) {
      await this.sleep(700 + Math.random() * 800);
      await this.d.hud.addLine(r, 'INSTR');
    }
  }

  // ── Routine: pick a random command, type it, show responses ────────────
  private async beatRoutine() {
    // 12% chance of mentor exchange in routine — friendly check-ins
    if (this.mentorAvailable('ROUTINE') && Math.random() < 0.12) {
      await this.beatMentor('ROUTINE');
      return;
    }
    if (Math.random() < 0.18) {
      // HQ ping inbound — operator replies briefly
      const ping = pickArc(HQ_INBOUND_ROUTINE, this.arc);
      await this.d.hud.addLine(ping, 'HQ');
      await this.sleep(800 + Math.random() * 1400);
      const reply = pickArc(HQ_REPLY_ROUTINE, this.arc);
      await this.typeAtPrompt(reply);
      await this.sleep(300);
      this.commit('CMD');
      return;
    }
    const beat = pickArc(ROUTINE_BEATS, this.arc);
    // cmd carries persona tokens ({node}/{hqlower}/{sector}) — resolve via subst, the
    // twin of native Terminal.subst (content now lives in the shared JSON SSOT).
    const cmdText = subst(this.persona, beat.cmd);
    await this.typeAtPrompt(cmdText);
    await this.sleep(180 + Math.random() * 260);
    this.commit('CMD');
    for (const r of beat.resp) {
      const text = typeof r === 'string' ? r : r.text;
      const cat: LineCategory = typeof r === 'string' ? 'RESP'
                              : (r.cat === 'OK' ? 'STATUS' : r.cat === 'WARN' ? 'WARNING' : 'RESP');
      await this.sleep(220 + Math.random() * 220);
      await this.d.hud.addLine(subst(this.persona, text), cat);
    }
  }

  // ── Intrusion: occasional quote + small reaction ───────────────────────
  private async beatIntrusion() {
    // 22% chance of mentor exchange — operator reaches out about what he's seeing
    if (this.mentorAvailable('INTRUSION') && Math.random() < 0.22) {
      await this.beatMentor('INTRUSION');
      return;
    }
    // 60% intrusion event, 40% follow-up reaction or routine command
    if (Math.random() < 0.6) {
      const ev = pickArc([...INTRUSIONS_QUOTES, ...INTRUSIONS_FRAGMENTS], this.arc);
      this.d.onIntrusion?.();
      await this.d.hud.addLine(ev.text, 'QUOTES');
      if (ev.followup) {
        await this.sleep(500);
        await this.d.hud.addLine(ev.followup, 'QUOTES');
      }
      // Operator reaction: hesitation typed-and-deleted, or a check command
      await this.sleep(900 + Math.random() * 1200);
      if (Math.random() < 0.45) {
        const h = pickArc(HESITATIONS, this.arc);
        await this.typeAndDelete(h.typed, h.replacement);
        await this.sleep(220);
        this.commit('CMD');
        const resp = pickArc(REACTIONS_FIRST_RESP, this.arc);
        const cat: LineCategory = resp.cat === 'OK' ? 'STATUS' : resp.cat === 'WARN' ? 'WARNING' : 'RESP';
        await this.sleep(420);
        await this.d.hud.addLine(resp.text, cat);
      } else {
        const cmd = pickArc(REACTIONS_FIRST, this.arc);
        await this.typeAtPrompt(cmd);
        await this.sleep(220);
        this.commit('CMD');
        const resp = pickArc(REACTIONS_FIRST_RESP, this.arc);
        const cat: LineCategory = resp.cat === 'OK' ? 'STATUS' : resp.cat === 'WARN' ? 'WARNING' : 'RESP';
        await this.sleep(420);
        await this.d.hud.addLine(resp.text, cat);
      }
    } else {
      // Routine command to "keep busy"
      await this.beatRoutine();
    }
  }

  // ── Alarm: drafts to HQ, refused commands, faster intrusions ───────────
  private async beatAlarm() {
    // 28% chance of mentor exchange — operator turns to trusted mentor
    if (this.mentorAvailable('ALARM') && Math.random() < 0.28) {
      await this.beatMentor('ALARM');
      return;
    }
    const choice = Math.random();
    if (choice < 0.35) {
      // HQ escalation reformulation — drafts then final
      const draft = pickArc(HQ_ESCALATION_DRAFTS, this.arc);
      for (const d of draft.drafts) {
        await this.typeAndDelete(d, '');
        await this.sleep(400 + Math.random() * 400);
      }
      await this.typeAtPrompt(draft.final);
      await this.sleep(280);
      this.commit('CMD');
      const resp = pickArc(HQ_NON_RESPONSES, this.arc);
      await this.sleep(700 + Math.random() * 800);
      const cat: LineCategory = resp.cat === 'AUTO' ? 'WARNING' : resp.cat === 'INFO' ? 'RESP' : 'STATUS';
      await this.d.hud.addLine(resp.text, cat);
    } else if (choice < 0.7) {
      // Reaction command, often denied
      const cmd = pickArc(REACTIONS_ALARM, this.arc);
      await this.typeAtPrompt(cmd);
      await this.sleep(280);
      this.commit('CMD');
      const resp = pickArc(REACTIONS_ALARM_RESP, this.arc);
      const cat: LineCategory = resp.cat === 'INFO' ? 'RESP' : resp.cat === 'DENY' ? 'DENY' : 'WARNING';
      await this.sleep(440);
      await this.d.hud.addLine(resp.text, cat);
    } else {
      // Intrusion event
      const ev = pickArc(INTRUSIONS_QUOTES, this.arc);
      this.d.onIntrusion?.();
      await this.d.hud.addLine(ev.text, 'QUOTES');
    }
  }

  // ── Panic: heavy backspacing, refused everything ───────────────────────
  private async beatPanic() {
    // 22% chance of mentor exchange — last attempts to reach out
    if (this.mentorAvailable('PANIC') && Math.random() < 0.22) {
      await this.beatMentor('PANIC');
      return;
    }
    const choice = Math.random();
    if (choice < 0.4) {
      // Panic draft pattern — short, getting shorter
      const p = pickArc(PANIC_DRAFTS, this.arc);
      for (const d of p.drafts) {
        await this.typeAndDelete(d, '');
        await this.sleep(250 + Math.random() * 350);
      }
      await this.typeAtPrompt(p.final);
      await this.sleep(220);
      this.commit('CMD');
      const r = pickArc(SYSTEM_FINAL, this.arc);
      await this.sleep(800 + Math.random() * 1000);
      await this.d.hud.addLine(r.text, r.cat === 'AUTO' ? 'WARNING' : 'WARNING');
    } else if (choice < 0.75) {
      const cmd = pickArc(REACTIONS_PANIC, this.arc);
      await this.typeAtPrompt(cmd);
      await this.sleep(180);
      this.commit('CMD');
      const r = pickArc(REACTIONS_PANIC_RESP, this.arc);
      await this.sleep(360);
      const cat: LineCategory = r.cat === 'DENY' ? 'DENY' : 'WARNING';
      await this.d.hud.addLine(r.text, cat);
    } else {
      // Multiple rapid intrusions
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        this.d.onIntrusion?.();
        await this.d.hud.addLine(pickArc(INTRUSIONS_QUOTES, this.arc).text, 'QUOTES');
        await this.sleep(280 + Math.random() * 220);
      }
    }
  }

  // ── Silence: final farewell, abandoned typing ──────────────────────────
  private async beatSilence() {
    // Ending resolved at SILENCE entry; `normal` (the arc-undefined case) is today's set.
    const farewells = ENDINGS.farewells[this.endingId] ?? ENDINGS.farewells.normal;
    const lastWords = ENDINGS.lastWords[this.endingId] ?? ENDINGS.lastWords.normal;
    if (Math.random() < 0.5) {
      const lw = pick(lastWords);
      // Type but never finish — just a half-thought
      await this.typeAtPrompt(lw.typed);
      // Don't commit — leave it hanging in the prompt
      await this.sleep(3000 + Math.random() * 2000);
    } else {
      const f = pick(farewells);
      await this.d.hud.addLine(f, 'QUOTES');
      await this.sleep(2400 + Math.random() * 1600);
    }
  }

  // ── Typing primitives ──────────────────────────────────────────────────
  // Typing engine writes ONLY into promptInputEl (handle is in its own span).
  // Prefix passed as '' so engine doesn't repeat the handle on every char.

  /** Get the typing profile for the current persona, modulated by current phase. */
  private profile() {
    return phaseModulate(profileFor(this.persona.trait), this.phase);
  }

  private async typeAtPrompt(text: string): Promise<void> {
    const handle = typeInto({
      el: this.d.promptInputEl,
      prefix: '',
      text,
      profile: this.profile(),
    });
    this.currentTyping = handle;
    await handle.done;
    this.currentTyping = null;
  }

  /** Type `typed`, hold, backspace, then optionally type `replacement` */
  private async typeAndDelete(typed: string, replacement: string): Promise<void> {
    const handle = typeAndErase({
      el: this.d.promptInputEl,
      prefix: '',
      text: typed,
      profile: this.profile(),
      holdMs: 350 + Math.random() * 500,
    });
    this.currentTyping = handle;
    await handle.done;
    this.currentTyping = null;
    if (replacement) {
      await this.sleep(180);
      await this.typeAtPrompt(replacement);
    }
  }

  /** Commit the current input line as a CMD entry in the terminal log, clear input. */
  private commit(category: LineCategory) {
    const txt = this.d.promptInputEl.textContent || '';
    // CMD lines render instantly inside addLine — no need to await here.
    if (txt.length > 0) void this.d.hud.addLine(txt, category);
    this.d.promptInputEl.textContent = '';
  }

  /** Update the prompt label after persona change (between shifts). */
  private refreshPrompt() {
    this.d.promptHandleEl.textContent = this.persona.prompt + ' ';
    this.d.promptInputEl.textContent = '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const id = window.setTimeout(() => {
        const ix = this.timers.indexOf(id);
        if (ix >= 0) this.timers.splice(ix, 1);
        r();
      }, ms);
      this.timers.push(id);
    });
  }
}

const PHASE_REST: Record<Phase, [number, number]> = {
  ROUTINE:   [3500, 6000],
  INTRUSION: [2200, 4500],
  ALARM:     [1400, 3200],
  PANIC:     [600, 1600],
  SILENCE:   [2500, 4500],
};
