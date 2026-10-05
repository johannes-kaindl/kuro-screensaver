// Pure helpers for scripts/render-sequence.mjs: argument parsing, frame naming, reversal,
// manifest, determinism comparison, provenance. No browser, no filesystem — tested by
// tests/bildfolge.test.ts. The browser part lives in scripts/render-sequence.mjs.
import { createHash } from 'node:crypto';

export const SCENES = ['terrain', 'city', 'rift', 'tunnel', 'void', 'wreckage', 'matrix'];
export const CLOCKS = ['page', 'virtual'];
export const CRASHES = ['none', 'forward', 'reverse'];
export const LICENSE = 'AGPL-3.0-only';

const DEFAULTS = { preset: 'kuro', seed: 1, fps: 24, seconds: 10, width: 1920, height: 1080, clock: 'page', crash: 'none', warmup: 3, threat: null, allowDirty: false, check: false, out: null };

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
      default: throw new Error(`unknown option --${key}`);
    }
  }
  if (!o.scene) throw new Error('--scene is required (one of ' + SCENES.join(', ') + ')');
  if (!o.out) o.out = `render-out/${o.scene}-${o.preset}-s${o.seed}${o.crash === 'none' ? '' : '-crash-' + o.crash}`;
  return o;
}

export function frameName(i) { return `frame-${String(i).padStart(4, '0')}.png`; }

export function pageUrl(o) {
  const q = new URLSearchParams({ scene: o.scene, preset: o.preset, seed: String(o.seed), terminal: 'off', radar: 'off', crosshair: 'off', audio: 'off' });
  if (o.threat !== null) q.set('threat', String(o.threat));
  return `http://localhost:5173/screensaver.html?${q.toString()}`;
}

/** Reverse a captured sequence: last capture becomes frame-0000, t restarts at 0 with the same spacing. */
export function reverseFrames(frames) {
  return frames.slice().reverse().map((f, i) => ({ file: frameName(i), t: frames[i].t, sha256: f.sha256, source: f.file }));
}

export function buildManifest(o, frames, herkunft) {
  return {
    scene: o.scene, preset: o.preset, seed: o.seed, fps: o.fps, seconds: o.seconds, width: o.width, height: o.height,
    clock: o.clock, crash: o.crash, warmup_s: o.warmup, threat: o.threat, url: pageUrl(o),
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

export function dirtyFromPorcelain(text) {
  return text.split('\n').filter((l) => l.trim().length > 0).map((l) => l.slice(3));
}

/** Source of an init script that replaces Math.random with mulberry32(seed). */
export function seededRandomSource(seed) {
  return `(() => { let s = ${seed >>> 0} || 1; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })()`;
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
