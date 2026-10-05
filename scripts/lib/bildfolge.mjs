// Pure helpers for scripts/render-sequence.mjs: argument parsing, frame naming, reversal,
// manifest, determinism comparison, provenance. No browser, no filesystem — tested by
// tests/bildfolge.test.ts. The browser part lives in scripts/render-sequence.mjs.
import { createHash } from 'node:crypto';

export const SCENES = ['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage', 'matrix', 'metro'];
/** Query keys the script sets itself; --extra must not override them or the manifest would lie. */
export const RESERVIERT = ['scene', 'preset', 'seed', 'hud', 'ping', 'audio', 'threat'];
export const CLOCKS = ['page', 'virtual'];
export const CRASHES = ['none', 'forward', 'reverse'];
export const RENDERERS = ['metal', 'swiftshader'];
export const LICENSE = 'AGPL-3.0-only';

const DEFAULTS = { preset: 'kuro', seed: 1, fps: 24, seconds: 10, width: 1920, height: 1080, clock: 'page', crash: 'none', renderer: 'metal', warmup: 3, threat: null, extra: '', allowDirty: false, check: false, out: null };

function num(name, raw, lo, hi, integer = false) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) {
    throw new Error(`--${name}: expected ${integer ? 'an integer' : 'a number'} in [${lo}, ${hi}], got ${JSON.stringify(raw)}`);
  }
  return v;
}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, scene: null };
  const flags = new Set(['--allow-dirty', '--check']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) { o[a === '--check' ? 'check' : 'allowDirty'] = true; continue; }
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(a)}`);
    const key = a.slice(2); const raw = argv[++i];
    if (raw === undefined) throw new Error(`--${key}: missing value`);
    switch (key) {
      case 'scene': if (!SCENES.includes(raw)) throw new Error(`--scene: expected one of ${SCENES.join(', ')}, got ${JSON.stringify(raw)}`); o.scene = raw; break;
      case 'preset': if (!/^[a-z][a-z0-9-]*$/.test(raw)) throw new Error(`--preset: expected a preset id, got ${JSON.stringify(raw)}`); o.preset = raw; break;
      case 'seed': o.seed = num(key, raw, 0, 2 ** 31 - 1, true); break;
      case 'fps': o.fps = num(key, raw, 1, 60, true); break;
      case 'seconds': o.seconds = num(key, raw, 0.04, 600); break;
      case 'width': o.width = num(key, raw, 16, 7680, true); break;
      case 'height': o.height = num(key, raw, 16, 4320, true); break;
      case 'warmup': o.warmup = num(key, raw, 0, 60); break;
      case 'threat': o.threat = num(key, raw, 0, 1); break;
      case 'clock': if (!CLOCKS.includes(raw)) throw new Error(`--clock: expected one of ${CLOCKS.join(', ')}, got ${JSON.stringify(raw)}`); o.clock = raw; break;
      case 'crash': if (!CRASHES.includes(raw)) throw new Error(`--crash: expected one of ${CRASHES.join(', ')}, got ${JSON.stringify(raw)}`); o.crash = raw; break;
      case 'out': o.out = raw; break;
      case 'renderer': if (!RENDERERS.includes(raw)) throw new Error(`--renderer: expected one of ${RENDERERS.join(', ')}, got ${JSON.stringify(raw)}`); o.renderer = raw; break;
      case 'extra': {
        if (!/^[A-Za-z0-9_=&.-]*$/.test(raw)) throw new Error(`--extra: expected a query string like crt=off&bloom=off, got ${JSON.stringify(raw)}`);
        const doppelt = [...new URLSearchParams(raw).keys()].filter((k) => RESERVIERT.includes(k));
        if (doppelt.length) throw new Error(`--extra: ${doppelt.join(', ')} is set by the script itself (use --scene/--preset/--seed/--threat)`);
        o.extra = raw; break;
      }
      default: throw new Error(`unknown option --${key}`);
    }
  }
  if (!o.scene) throw new Error('--scene is required (one of ' + SCENES.join(', ') + ')');
  if (!o.out) o.out = `render-out/${o.scene}-${o.preset}-s${o.seed}${o.crash === 'none' ? '' : '-crash-' + o.crash}`;
  return o;
}

export function frameName(i) { return `frame-${String(i).padStart(4, '0')}.png`; }

export function pageUrl(o, base = 'http://localhost:5173') {
  const q = new URLSearchParams({ scene: o.scene, preset: o.preset, seed: String(o.seed), hud: 'off', ping: 'off', audio: 'off' });
  if (o.threat !== null) q.set('threat', String(o.threat));
  for (const [k, v] of new URLSearchParams(o.extra)) q.set(k, v);   // pass-through engine params (crt=off, altitude=high, …)
  return `${base}/screensaver.html?${q.toString()}`;
}

/** Reverse a captured sequence: last capture becomes frame-0000, t restarts at 0 with the same spacing. */
export function reverseFrames(frames) {
  return frames.slice().reverse().map((f, i) => ({ file: frameName(i), t: frames[i].t, sha256: f.sha256, source: f.file }));
}

export function buildManifest(o, frames, herkunft) {
  return {
    scene: o.scene, preset: o.preset, seed: o.seed, fps: o.fps, seconds: o.seconds, width: o.width, height: o.height,
    clock: o.clock, crash: o.crash, renderer: o.renderer, warmup_s: o.warmup, threat: o.threat, extra: o.extra, url: pageUrl(o, o.base),
    frames,
    herkunft: { repo: 'kuro-screensaver', commit: herkunft.commit, unsauber: herkunft.unsauber, license: LICENSE, playwright: herkunft.playwright, chromium: herkunft.chromium },
  };
}

export function compareManifests(a, b) {
  const verschieden = [];
  const n = Math.max(a.frames.length, b.frames.length);
  for (let i = 0; i < n; i++) {
    const x = a.frames[i], y = b.frames[i];
    if (!x || !y || x.sha256 !== y.sha256) verschieden.push((x ?? y).file);
  }
  return { gleich: verschieden.length === 0, verschieden, anzahl: n };
}

/**
 * Verdict over per-frame comparisons of two runs: `hashGleich` says whether the PNG bytes matched,
 * `max` is the largest absolute 8-bit difference over R, G and B. Byte-identical frames are the goal
 * and the measured norm (2026-10-05, CITY/TUNNEL in kuro, Chromium 148 via Metal: 45 to 48 of 48
 * frames byte-identical, the rest within 2 of 255 — GPU rounding in the post-FX chain). `noiseMax`
 * (8) is the tolerance for that; above it something in the timeline differed (a crash flash that
 * came late in one run showed 241).
 */
export function bewerteDifferenzen(diffs, noiseMax = 8) {
  const max = diffs.reduce((m, d) => Math.max(m, d.max), 0);
  const identisch = diffs.filter((d) => d.hashGleich).length;
  const stufe = diffs.length === 0 ? 'leer' : identisch === diffs.length ? 'byte-gleich' : max <= noiseMax ? 'gleich bis auf Rauschen' : 'verschieden';
  const abweichend = diffs.filter((d) => d.max > noiseMax).map((d) => d.file);
  return { stufe, max, identisch, anzahl: diffs.length, abweichend, ok: stufe !== 'verschieden' && stufe !== 'leer' };
}

/** May `--out` be cleared? Only when it does not exist, is empty, or holds nothing but our own output. */
export function darfGeleertWerden(entries) {
  if (entries === null) return true;
  return entries.every((e) => /^frame-\d{4}\.png$/.test(e) || e === 'bildfolge.json' || e === '.rev' || e === 'konkat.txt');
}

export function dirtyFromPorcelain(text) {
  return text.split('\n').filter((l) => l.trim().length > 0).map((l) => l.slice(3));
}

/** Source of an init script that replaces Math.random with mulberry32(seed). */
export function seededRandomSource(seed) {
  return `(() => { let s = ${seed >>> 0} || 1; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })()`;
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
