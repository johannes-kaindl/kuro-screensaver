import { describe, it, expect } from 'vitest';
import {
  parseArgs, frameName, reverseFrames, buildManifest, compareManifests, bewerteDifferenzen, darfGeleertWerden, dirtyFromPorcelain, pageUrl, seededRandomSource, sha256,
} from '../scripts/lib/bildfolge.mjs';

describe('parseArgs', () => {
  it('applies defaults', () => {
    const o = parseArgs(['--scene', 'city']);
    expect(o).toMatchObject({ scene: 'city', preset: 'kuro', seed: 1, fps: 24, seconds: 10, width: 1920, height: 1080, clock: 'page', crash: 'none', warmup: 3, allowDirty: false, check: false });
    expect(o.out).toBe('render-out/city-kuro-s1');
  });
  it('rejects an unknown scene naming the allowed ones', () => {
    expect(() => parseArgs(['--scene', 'bogus'])).toThrow(/scene.*terrain, city, rift, tunnel, void, wreckage, matrix, metro/);
    expect(parseArgs(['--scene', 'metro']).scene).toBe('metro');
  });
  it('rejects fps, seconds, crash and clock out of range (Review Focus 1)', () => {
    expect(() => parseArgs(['--scene', 'city', '--fps', '0'])).toThrow(/fps/);
    expect(() => parseArgs(['--scene', 'city', '--seconds', '-1'])).toThrow(/seconds/);
    expect(() => parseArgs(['--scene', 'city', '--crash', 'sideways'])).toThrow(/crash.*none, forward, reverse/);
    expect(() => parseArgs(['--scene', 'city', '--clock', 'wall'])).toThrow(/clock.*page, virtual/);
    expect(() => parseArgs(['--scene', 'city', '--renderer', 'cuda'])).toThrow(/renderer.*metal, swiftshader/);
  });
  it('passes --extra through to the page URL and rejects junk', () => {
    const o = parseArgs(['--scene', 'city', '--extra', 'crt=off&bloom=off']);
    expect(o.extra).toBe('crt=off&bloom=off');
    expect(() => parseArgs(['--scene', 'city', '--extra', 'crt=off; rm'])).toThrow(/--extra/);
    // reserved keys would make the manifest lie about scene, seed, preset, hud or audio
    expect(() => parseArgs(['--scene', 'city', '--extra', 'seed=9'])).toThrow(/--extra.*seed/);
    expect(() => parseArgs(['--scene', 'city', '--extra', 'scene=void&crt=off'])).toThrow(/--extra.*scene/);
  });
  it('requires --scene', () => {
    expect(() => parseArgs([])).toThrow(/--scene/);
  });
});

describe('frameName', () => {
  it('is four digits from 0000', () => {
    expect(frameName(0)).toBe('frame-0000.png');
    expect(frameName(1234)).toBe('frame-1234.png');
  });
});

describe('reverseFrames (Review Focus 2)', () => {
  it('reverses order, renumbers files and restarts t at 0 with the same spacing', () => {
    const frames = [
      { file: 'frame-0000.png', t: 0, sha256: 'a' },
      { file: 'frame-0001.png', t: 0.5, sha256: 'b' },
      { file: 'frame-0002.png', t: 1, sha256: 'c' },
    ];
    expect(reverseFrames(frames)).toEqual([
      { file: 'frame-0000.png', t: 0, sha256: 'c', source: 'frame-0002.png' },
      { file: 'frame-0001.png', t: 0.5, sha256: 'b', source: 'frame-0001.png' },
      { file: 'frame-0002.png', t: 1, sha256: 'a', source: 'frame-0000.png' },
    ]);
  });
});

describe('buildManifest', () => {
  it('carries parameters, frames and provenance', () => {
    const opts = parseArgs(['--scene', 'tunnel', '--seed', '7', '--fps', '20', '--seconds', '2']);
    const m = buildManifest(opts, [{ file: 'frame-0000.png', t: 0, sha256: 'x' }], { commit: 'abc', unsauber: [], playwright: '1.60.0', chromium: '140' });
    expect(m.scene).toBe('tunnel');
    expect(m.seed).toBe(7);
    expect(m.url).toContain('scene=tunnel&preset=kuro&seed=7');
    expect(buildManifest(parseArgs(['--scene', 'city', '--extra', 'crt=off']), [], { commit: 'a', unsauber: [], playwright: '1', chromium: '1' }).url).toContain('&crt=off');
    expect(m.herkunft).toEqual({ repo: 'kuro-screensaver', commit: 'abc', unsauber: [], license: 'AGPL-3.0-only', playwright: '1.60.0', chromium: '140' });
    expect(m.frames).toHaveLength(1);
  });
});

describe('compareManifests (Review Focus 3)', () => {
  const a = { frames: [{ file: 'frame-0000.png', sha256: '1' }, { file: 'frame-0001.png', sha256: '2' }] };
  it('reports identical manifests as equal', () => {
    expect(compareManifests(a, a)).toEqual({ gleich: true, verschieden: [], anzahl: 2 });
  });
  it('names exactly the differing frames', () => {
    const b = { frames: [{ file: 'frame-0000.png', sha256: '1' }, { file: 'frame-0001.png', sha256: '9' }] };
    expect(compareManifests(a, b)).toEqual({ gleich: false, verschieden: ['frame-0001.png'], anzahl: 2 });
  });
  it('treats a different frame count as different', () => {
    expect(compareManifests(a, { frames: a.frames.slice(0, 1) }).gleich).toBe(false);
  });
});

describe('bewerteDifferenzen (Review Focus 3, Toleranz)', () => {
  it('is byte-identical only when every hash matches (not when the luma difference happens to be 0)', () => {
    expect(bewerteDifferenzen([{ file: 'a', max: 0, hashGleich: true }, { file: 'b', max: 0, hashGleich: true }])).toMatchObject({ stufe: 'byte-gleich', max: 0, identisch: 2, anzahl: 2, abweichend: [], ok: true });
    expect(bewerteDifferenzen([{ file: 'a', max: 0, hashGleich: false }])).toMatchObject({ stufe: 'gleich bis auf Rauschen', identisch: 0 });
  });
  it('tolerates rendering noise up to noiseMax, counts identical frames by hash', () => {
    expect(bewerteDifferenzen([{ file: 'a', max: 7, hashGleich: false }, { file: 'b', max: 0, hashGleich: true }])).toMatchObject({ stufe: 'gleich bis auf Rauschen', max: 7, identisch: 1, abweichend: [], ok: true });
  });
  it('names the frames above the tolerance and fails', () => {
    expect(bewerteDifferenzen([{ file: 'a', max: 3, hashGleich: false }, { file: 'b', max: 90, hashGleich: false }])).toMatchObject({ stufe: 'verschieden', max: 90, abweichend: ['b'], ok: false });
  });
  it('treats an empty list as not ok', () => {
    expect(bewerteDifferenzen([]).ok).toBe(false);
  });
});

describe('darfGeleertWerden (Review C1: --out must not wipe foreign directories)', () => {
  it('allows a missing or empty directory and one holding only our own output', () => {
    expect(darfGeleertWerden(null)).toBe(true);
    expect(darfGeleertWerden([])).toBe(true);
    expect(darfGeleertWerden(['frame-0000.png', 'frame-0001.png', 'bildfolge.json', '.rev', 'konkat.txt'])).toBe(true);
  });
  it('refuses a directory with anything else in it', () => {
    expect(darfGeleertWerden(['frame-0000.png', 'notes.md'])).toBe(false);
    expect(darfGeleertWerden(['.git'])).toBe(false);
  });
});

describe('pageUrl', () => {
  it('switches HUD and radar ping off and takes the server base', () => {
    const u = pageUrl(parseArgs(['--scene', 'city']), 'http://127.0.0.1:5199');
    expect(u.startsWith('http://127.0.0.1:5199/screensaver.html?')).toBe(true);
    expect(u).toContain('hud=off');
    expect(u).toContain('ping=off');
  });
});

describe('dirtyFromPorcelain (Review Focus 5)', () => {
  it('lists changed paths and ignores blank lines', () => {
    expect(dirtyFromPorcelain(' M src/a.ts\n?? scripts/x.mjs\n\n')).toEqual(['src/a.ts', 'scripts/x.mjs']);
    expect(dirtyFromPorcelain('')).toEqual([]);
  });
});

describe('seededRandomSource', () => {
  it('yields a deterministic Math.random replacement', () => {
    const original = Math.random;   // the source replaces the global; restore it for the other tests
    try {
      const src = seededRandomSource(42);
      const a = new Function(`${src}; return [Math.random(), Math.random()];`)();
      const b = new Function(`${src}; return [Math.random(), Math.random()];`)();
      expect(a).toEqual(b);
      expect(a[0]).not.toEqual(a[1]);
      expect(a[0]).toBeGreaterThanOrEqual(0);
      expect(a[0]).toBeLessThan(1);
    } finally {
      Math.random = original;
    }
  });
});

describe('sha256', () => {
  it('hashes bytes', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
