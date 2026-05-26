// Realistic typing engine for the operator's input line.
//
// Renders character-level into a single DOM element representing the active
// input cursor. Supports:
//   • variable per-character speed (slows on punctuation, sensitive words)
//   • mid-word micro-pauses (operator "thinking")
//   • typos with backspace correction (chosen-then-fixed)
//   • full line abandonment (delete back to prompt, type something else)
//   • interruptible: pending typing can be aborted by the narrative driver
//
// All timing is driven by setTimeout chains; cancel via the returned handle.

import type { TraitProfile } from './persona';

export interface TypingHandle {
  /** Promise resolves when typing finishes naturally (or is aborted). */
  done: Promise<void>;
  /** Cancel pending typing immediately. */
  abort(): void;
  /** Whether the instance has finished or been aborted. */
  isFinished(): boolean;
}

export interface TypeIntoOptions {
  /** Target — text appended to this element (overwrites suffix on backspace) */
  el: HTMLElement;
  /** Prefix that stays at the start of the element (the prompt + already-confirmed input) */
  prefix: string;
  /** Final text the operator wants to end up with */
  text: string;
  /** Typing personality */
  profile: TraitProfile;
  /**
   * Optional: trigger a "line abandon" after typing this many chars (1-based).
   * The engine will type up to here, pause, backspace the entire input back to
   * the prompt, then type `replacementText` (called as the new attempt).
   */
  abandonAt?: number;
  abandonReplacement?: string;
  /**
   * Optional: a callback invoked when typing of `text` completes (after any
   * abandonment or replacement attempt).
   */
  onSettled?: () => void;
}

/** Layout for QWERTY typo neighbours — used to pick plausible typos. */
const NEIGHBOURS: Record<string, string> = {
  a:'qwsz', b:'vghn', c:'xdfv', d:'serfcx', e:'wsdr', f:'drtgcv', g:'ftyhbv',
  h:'gyujnb', i:'ujko', j:'huikmn', k:'jiolm', l:'kop', m:'njk', n:'bhjm',
  o:'iklp', p:'ol', q:'wa', r:'edft', s:'awedxz', t:'rfgy', u:'yhji',
  v:'cfgb', w:'qase', x:'zsdc', y:'tghu', z:'asx',
  ' ':' ', '0':'9', '1':'2', '2':'13', '3':'24', '4':'35', '5':'46',
  '6':'57', '7':'68', '8':'79', '9':'80',
};

function pickTypo(c: string): string {
  const k = c.toLowerCase();
  const opts = NEIGHBOURS[k];
  if (!opts) return c;
  const t = opts[Math.floor(Math.random() * opts.length)];
  return c === c.toUpperCase() && c !== c.toLowerCase() ? t.toUpperCase() : t;
}

/** Words that an operator slows down before — emotional or technical weight. */
const HEAVY_WORDS = /^(compromise|compromised|purge|abort|escalate|wraith|cipher|chrome|raven|nevermore|deny|denied|refuse|terminate|disconnect|help|urgent|fragment|cold|silence)$/i;

/** Punctuation that triggers a slight extra pause after typing. */
const PUNCT_PAUSE: Record<string, number> = { ',': 60, '.': 100, ';': 80, ':': 50, '/': 30, '-': 25, '_': 25 };

/**
 * Type `text` into `el` with realistic personality.
 * Returns a handle so the caller can wait for completion or abort early.
 */
export function typeInto(opts: TypeIntoOptions): TypingHandle {
  const { el, prefix, text, profile, abandonAt, abandonReplacement } = opts;
  let aborted = false;
  let finished = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => { resolveDone = res; });
  const timers: number[] = [];

  const wait = (ms: number) => new Promise<void>((r) => {
    if (aborted) return r();
    const id = window.setTimeout(() => {
      const ix = timers.indexOf(id);
      if (ix >= 0) timers.splice(ix, 1);
      r();
    }, ms);
    timers.push(id);
  });

  const setBuffer = (buf: string) => { el.textContent = prefix + buf; };

  // Base per-char delay before applying jitter + situational adjustments.
  const baseDelay = 38 * profile.baseSpeed;

  // Word boundaries help us bias pauses + typo chance per-word.
  const isWordBoundary = (c: string) => /[\s/-]/.test(c);

  async function typeChars(target: string, fromPosition = 0): Promise<void> {
    let buf = target.slice(0, fromPosition);
    setBuffer(buf);

    let wordStart = fromPosition;
    let typoApplied = false;     // track per word
    for (let i = fromPosition; i < target.length; i++) {
      if (aborted) return;
      const c = target[i];
      const atBoundary = i === target.length - 1 || isWordBoundary(target[i + 1] ?? '');

      // Typo logic — once per word, with chance scaled by trait
      if (!typoApplied && /[a-z0-9]/i.test(c) && Math.random() < profile.typoChance / 6) {
        const wrong = pickTypo(c);
        if (wrong !== c) {
          buf += wrong; setBuffer(buf);
          // Brief delay before noticing
          await wait(140 + Math.random() * 120);
          if (aborted) return;
          // Backspace the wrong char (sometimes a couple more for "scrub")
          const scrub = 1 + (Math.random() < 0.4 ? 1 : 0);
          for (let k = 0; k < scrub; k++) {
            if (aborted) return;
            buf = buf.slice(0, -1); setBuffer(buf);
            await wait(80 + Math.random() * 60);
          }
          // Re-type any scrubbed-away (correct) chars + this one correctly
          if (scrub > 1) {
            const restore = target.slice(i - (scrub - 1), i);
            for (const r of restore) {
              if (aborted) return;
              buf += r; setBuffer(buf);
              await wait(baseDelay + Math.random() * baseDelay * profile.jitter);
            }
          }
          typoApplied = true;
          // continue loop, this i now gets typed correctly
        }
      }

      // Heavy-word pre-pause
      if (i === wordStart && profile.pauseLengthMs > 0) {
        const remaining = target.slice(i).split(/[\s/-]/, 1)[0];
        if (HEAVY_WORDS.test(remaining)) {
          await wait(profile.pauseLengthMs + Math.random() * profile.pauseLengthMs);
        }
      }

      // Mid-word micro-pause
      if (Math.random() < profile.pauseChance && !atBoundary) {
        await wait(120 + Math.random() * 200);
      }

      // The actual keystroke
      buf += c; setBuffer(buf);
      const jitter = baseDelay * profile.jitter * Math.random();
      let delay = baseDelay + jitter;
      const pp = PUNCT_PAUSE[c];
      if (pp) delay += pp;
      await wait(delay);

      if (atBoundary) { wordStart = i + 1; typoApplied = false; }

      // Abandonment: typed enough to give up, scrub everything, retype.
      if (abandonAt != null && abandonReplacement && i + 1 === abandonAt) {
        await wait(420 + Math.random() * 380);
        // Backspace the whole input
        while (buf.length > 0) {
          if (aborted) return;
          buf = buf.slice(0, -1); setBuffer(buf);
          await wait(45 + Math.random() * 30);
        }
        // Brief reflective pause, then type replacement
        await wait(280 + Math.random() * 220);
        return typeChars(abandonReplacement, 0);
      }
    }
  }

  (async () => {
    try {
      await typeChars(text, 0);
    } finally {
      finished = true;
      opts.onSettled?.();
      resolveDone();
    }
  })();

  return {
    done,
    abort() {
      aborted = true;
      timers.splice(0).forEach((id) => clearTimeout(id));
      finished = true;
      resolveDone();
    },
    isFinished: () => finished,
  };
}

/**
 * Type-and-erase utility: types a string, holds, then backspaces it all.
 * Useful for "wrong word, deleted" beats: the operator types something, hesitates,
 * deletes it, types something else.
 */
export function typeAndErase(opts: TypeIntoOptions & { holdMs?: number }): TypingHandle {
  const hold = opts.holdMs ?? 500;
  const el = opts.el;
  let aborted = false;
  let finished = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => { resolveDone = res; });

  (async () => {
    const h1 = typeInto({ ...opts });
    await h1.done;
    if (aborted) { finished = true; resolveDone(); return; }
    await new Promise<void>((r) => setTimeout(r, hold));
    if (aborted) { finished = true; resolveDone(); return; }
    let buf = el.textContent || '';
    while (buf.length > opts.prefix.length) {
      if (aborted) break;
      buf = buf.slice(0, -1);
      el.textContent = buf;
      await new Promise<void>((r) => setTimeout(r, 50 + Math.random() * 30));
    }
    finished = true; resolveDone();
  })();

  return { done, abort() { aborted = true; finished = true; resolveDone(); }, isFinished: () => finished };
}
