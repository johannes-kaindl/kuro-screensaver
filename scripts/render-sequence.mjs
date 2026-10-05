// Deterministic PNG image sequence from the engine, served by this script's own Vite dev server:
//   node scripts/render-sequence.mjs --scene city --preset kuro --seed 7 --seconds 15 --fps 24
//   node scripts/render-sequence.mjs --scene city --crash forward --seconds 1.6
//   node scripts/render-sequence.mjs --scene city --seconds 2 --check   # render twice, compare
//
// How it is deterministic without touching the engine: Playwright's page.clock fakes Date,
// performance.now, timers and requestAnimationFrame (paused before the page loads, advanced by
// exactly 1000/fps ms per frame); Math.random is replaced by a seeded generator before the page
// loads; ?seed= pins settings.seedLock; ?hud=off and ?ping=off keep readouts, control bar, kanji
// and the radar ping out of the picture; the compositor's animation clock is frozen (CDP) and every
// CSS transition is seeked to the faked time per frame. Each stage was measured against two runs
// (see the commit history and ANGEBOT.md). The dev server is started here (DEV build: the crash
// hook window.__kuro exists only there) on a free port, so no foreign server can be captured.
// Output: <out>/frame-NNNN.png + bildfolge.json (written only after the last frame).
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, frameName, pageUrl, reverseFrames, buildManifest, compareManifests, bewerteDifferenzen, darfGeleertWerden, dirtyFromPorcelain, seededRandomSource, sha256 } from './lib/bildfolge.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg, code = 2) { console.error(`error: ${msg}`); process.exit(code); }

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }

// Provenance: git runs in the repo, not in whatever directory the script was started from.
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
const unsauber = dirtyFromPorcelain(porcelain);
if (unsauber.length && !opts.allowDirty) fail(`working tree is dirty, provenance would not describe the build:\n  ${unsauber.join('\n  ')}\nCommit first, or pass --allow-dirty for a measurement run.`);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const playwrightVersion = JSON.parse(readFileSync(join(REPO, 'node_modules/playwright/package.json'), 'utf8')).version;

// Everything that can refuse does so before a browser or server starts.
const outDirs = opts.check ? [resolve(opts.out + '-check-a'), resolve(opts.out + '-check-b')] : [resolve(opts.out)];
for (const d of outDirs) {
  const entries = existsSync(d) ? readdirSync(d) : null;
  if (!darfGeleertWerden(entries)) fail(`refusing to clear ${d}: it holds files that are not ours (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''}). Pick an empty --out.`);
}
if (opts.check) {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { fail('--check needs ffmpeg in PATH (pixel comparison); install it or run without --check'); }
}

/**
 * Bind CSS transitions/animations to the faked clock. page.clock fakes timers and rAF, but the
 * compositor drives CSS transitions by wall time — the crash sequence (collapse line 210 ms, flashes
 * 40/70 ms) differed between runs until the compositor clock was frozen (Animation.setPlaybackRate 0)
 * and each frame seeks every animation to the elapsed fake time since it was first seen.
 */
async function syncAnimations(page, fakeMs) {
  await page.evaluate((now) => {
    // Force a style flush first: a transition created inside the last tick does not exist until
    // styles are recalculated, and whether that happened before this call depended on real time.
    void document.documentElement.offsetHeight;
    for (const a of document.getAnimations()) {
      if (a.__fakeStart === undefined) a.__fakeStart = now;   // playback rate is 0 (CDP), nothing moved since it started
      const t = now - a.__fakeStart;
      const end = a.effect?.getComputedTiming?.().endTime ?? Infinity;
      if (t >= end) a.finish(); else a.currentTime = t;
    }
  }, fakeMs);
}

/** CDP virtual time: advance by `ms`, resolve when the budget is spent. */
async function runVirtual(cdp, ms) {
  await new Promise((resolve, reject) => {
    cdp.once('Emulation.virtualTimeBudgetExpired', resolve);
    cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms }).catch(reject);
  });
}

async function capture(outDir, base) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const stepMs = 1000 / opts.fps;
  const total = Math.max(1, Math.round(opts.seconds * opts.fps));
  const frames = [];
  // metal: headful, real GPU (same as render-proof.mjs). swiftshader: headless software rasterizer —
  // slower, no window on the desktop, measured less reproducible (1 of 48 frames identical).
  const browser = opts.renderer === 'metal'
    ? await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] })
    : await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const chromiumVersion = browser.version();
  try {
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.addInitScript(seededRandomSource(opts.seed));
    // Freeze the compositor's animation clock from the start: a CSS transition begins in real time the
    // moment a style changes, and a 40 ms flash could finish before syncAnimations() ever sees it.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    const url = pageUrl(opts, base);
    if (opts.clock === 'page') {
      // pauseAt() JUMPS to the given time: between install() and pauseAt() a few real milliseconds pass,
      // so pausing "now" would leave each run on a slightly different clock. Jumping 100 ms ahead lands
      // every run on the same one.
      const t0 = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: t0 });
      await page.clock.pauseAt(new Date(t0.getTime() + 100));
      await page.goto(url, { waitUntil: 'load' });
    } else {
      await page.goto(url, { waitUntil: 'load' });
    }
    // Let fetches (textures, fonts, modules) land before the first fake tick: an asset that arrives
    // mid-warmup shifts object creation and with it every Math.random consumer after it.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const warmupMs = Math.round(opts.warmup * 1000);
    if (opts.clock === 'page') {
      // Even with the clock paused, performance.now() reads 0 or 1 ms after load depending on the run
      // (measured: 1, 1, 0 in three headful runs). One millisecond moves timer and rAF boundaries and
      // made the crash diverge in two checks of three. Align every run to 2 ms, and refuse to go on if
      // that fails — a manifest from a misaligned run would promise a determinism it cannot have.
      const p = await page.evaluate(() => performance.now());
      await page.clock.runFor(Math.max(0, 2 - Math.round(p)));
      const p2 = await page.evaluate(() => performance.now());
      if (Math.round(p2) !== 2) throw new Error(`performance.now() is ${p2} after alignment (expected 2); the run would not be reproducible`);
      await page.clock.runFor(warmupMs);
    } else {
      await runVirtual(cdp, warmupMs);
    }
    if (opts.crash !== 'none') {
      const ok = await page.evaluate(() => { const c = window.__kuro; if (!c?.crt?.playCrash) return false; void c.crt.playCrash(); return true; });
      if (!ok) throw new Error('window.__kuro.crt.playCrash not available — the page is not the DEV build');
    }
    await syncAnimations(page, warmupMs);
    for (let i = 0; i < total; i++) {
      if (i > 0) { if (opts.clock === 'page') await page.clock.runFor(stepMs); else await runVirtual(cdp, stepMs); }
      await syncAnimations(page, warmupMs + i * stepMs);
      const png = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
      // The screenshot forces a rendering opportunity, and that is when finished transitions dispatch
      // their events. Give those tasks a moment of real time before the next fake tick.
      await page.waitForTimeout(25);
      const file = frameName(i);
      writeFileSync(join(outDir, file), png);
      frames.push({ file, t: Number((i * stepMs / 1000).toFixed(4)), sha256: sha256(png) });
      if (i % 24 === 0) process.stdout.write(`\r  frame ${i + 1}/${total}`);
    }
    process.stdout.write('\n');
  } finally {
    await browser.close();
  }
  let out = frames;
  if (opts.crash === 'reverse') {
    out = reverseFrames(frames);
    const tmp = join(outDir, '.rev'); mkdirSync(tmp);
    for (const f of out) writeFileSync(join(tmp, f.file), readFileSync(join(outDir, f.source)));
    for (const f of frames) rmSync(join(outDir, f.file));
    for (const f of out) writeFileSync(join(outDir, f.file), readFileSync(join(tmp, f.file)));
    rmSync(tmp, { recursive: true });
  }
  const manifest = buildManifest({ ...opts, seconds: total / opts.fps }, out, { commit, unsauber, playwright: playwrightVersion, chromium: chromiumVersion });
  writeFileSync(join(outDir, 'bildfolge.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Per-frame pixel difference between two runs via ffmpeg: max absolute 8-bit difference over R, G and B. */
function pixelDiff(fileA, fileB) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', fileA, '-i', fileB, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  let max = 0;
  for (const b of raw) if (b > max) max = b;
  return { max };
}

// This script serves the page itself: a dev server already on :5173 could belong to another project
// or another checkout, and the manifest would still name this repo's commit as the source.
const server = await createServer({ root: REPO, configFile: join(REPO, 'vite.config.ts'), logLevel: 'error', server: { port: 5199, strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ?? `http://127.0.0.1:${server.config.server.port}`;
try {
  if (opts.check) {
    const [dirA, dirB] = outDirs;
    const a = await capture(dirA, base);
    const b = await capture(dirB, base);
    const hashes = compareManifests(a, b);
    const differing = new Set(hashes.verschieden);
    const diffs = a.frames.map((f) => ({ file: f.file, hashGleich: !differing.has(f.file), ...pixelDiff(join(dirA, f.file), join(dirB, f.file)) }));
    const v = bewerteDifferenzen(diffs);
    console.log(`check: ${hashes.anzahl} frames, ${v.identisch} byte-identical, max pixel difference ${v.max}/255 -> ${v.stufe}${v.abweichend.length ? ' (' + v.abweichend.slice(0, 8).join(', ') + ')' : ''}`);
    process.exitCode = v.ok ? 0 : 1;
  } else {
    const m = await capture(outDirs[0], base);
    console.log(`${m.frames.length} frames (${opts.width}x${opts.height}, ${opts.fps} fps, ${m.seconds} s, clock ${opts.clock}, crash ${opts.crash}) -> ${outDirs[0]}/bildfolge.json`);
    console.log('Now LOOK at the frames — a hash proves sameness, not that the scene is there.');
  }
} finally {
  await server.close();
}
