// Deterministic PNG image sequence from the running engine (dev server on :5173):
//   node scripts/render-sequence.mjs --scene city --preset kuro --seed 7 --seconds 15 --fps 24
//   node scripts/render-sequence.mjs --scene city --crash forward --seconds 4
//   node scripts/render-sequence.mjs --scene city --seconds 2 --check   # render twice, compare hashes
//
// How it is deterministic without touching the engine: Playwright's page.clock fakes Date,
// performance.now, timers and requestAnimationFrame, so each frame advances the engine by
// exactly 1000/fps ms; Math.random is replaced by a seeded generator before the page loads;
// ?seed= pins settings.seedLock. `--clock virtual` is the alternative measured in the plan
// (CDP Emulation.setVirtualTimePolicy); the default is whatever the measurement picked.
// Output: <out>/frame-NNNN.png + bildfolge.json (written only after the last frame).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, frameName, pageUrl, reverseFrames, buildManifest, compareManifests, bewerteDifferenzen, dirtyFromPorcelain, seededRandomSource, sha256 } from './lib/bildfolge.mjs';

const DEV_URL = 'http://localhost:5173/';

function fail(msg, code = 2) { console.error(`error: ${msg}`); process.exit(code); }

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }

const porcelain = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
const unsauber = dirtyFromPorcelain(porcelain);
if (unsauber.length && !opts.allowDirty) fail(`working tree is dirty, provenance would not describe the build:\n  ${unsauber.join('\n  ')}\nCommit first, or pass --allow-dirty for a measurement run.`);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const playwrightVersion = JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version;

try { await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) }); } catch { fail(`dev server not reachable at ${DEV_URL} — run \`npm run dev\` first (the crash hook window.__kuro exists only in DEV)`); }

/**
 * Bind CSS transitions/animations to the faked clock. page.clock fakes timers and rAF, but the
 * compositor drives CSS transitions by wall time — the crash sequence (collapse line 210 ms, flashes
 * 40/70 ms) therefore differed between runs (measured 2026-10-05: 13 of 72 frames identical, max
 * difference 241/255). Each frame we pause every running animation and seek it to the elapsed fake
 * time since we first saw it; finished ones drop out of getAnimations() on their own.
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

async function capture(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // metal: headful, real GPU (same as render-proof.mjs). swiftshader: headless software rasterizer —
  // slower, no window on the desktop, and the candidate for byte-identical output (measured in the plan).
  const browser = opts.renderer === 'metal'
    ? await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] })
    : await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const chromiumVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.addInitScript(seededRandomSource(opts.seed));
  const stepMs = 1000 / opts.fps;
  const total = Math.round(opts.seconds * opts.fps);
  const frames = [];
  // Freeze the compositor's animation clock from the start: a CSS transition begins in real time the
  // moment a style changes, and a 40 ms flash could finish before syncAnimations() ever sees it — in one
  // run but not the other (measured 2026-10-05: every eighth TUNNEL frame differed by 244/255). With the
  // playback rate at 0 nothing advances by itself; syncAnimations() seeks each animation to fake time.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  try {
    if (opts.clock === 'page') {
      // install() alone keeps the clock ticking in real time (measured 2026-10-05: the HUD showed the
      // wall clock and two runs differed in every frame); pauseAt() BEFORE navigation makes the page
      // load with a stopped clock, and runFor() then advances it deterministically.
      // pauseAt() JUMPS to the given time: between install() and pauseAt() a few real milliseconds pass,
      // and pausing "now" would make performance.now() differ by a millisecond between runs — enough to
      // shift timer and rAF boundaries (measured 2026-10-05: perf 3589 vs 3588, crash diverged at frame 21).
      // Jumping to a fixed time 100 ms later lands every run on the same clock.
      const t0 = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: t0 });
      await page.clock.pauseAt(new Date(t0.getTime() + 100));
      await page.goto(pageUrl(opts), { waitUntil: 'load' });
      // Let fetches (textures, fonts, modules) land before the first fake tick: an asset that arrives
      // mid-warmup shifts object creation and with it every Math.random consumer after it.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      // Even with the clock paused, performance.now() reads 0 or 1 ms after load depending on the
      // run (measured 2026-10-05, three headful runs: 1, 1, 0). One millisecond moves timer and rAF
      // boundaries and made the crash diverge in two of three checks. Align every run to 2 ms.
      const p = await page.evaluate(() => performance.now());
      await page.clock.runFor(Math.max(0, 2 - Math.round(p)));
      const p2 = await page.evaluate(() => performance.now());
      if (Math.round(p2) !== 2) console.warn(`  warning: performance.now() is ${p2} after alignment (expected 2) — runs may differ`);
      await page.clock.runFor(Math.round(opts.warmup * 1000));
    } else {
      await page.goto(pageUrl(opts), { waitUntil: 'load' });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      await runVirtual(cdp, Math.round(opts.warmup * 1000));
    }
    if (opts.crash !== 'none') {
      const ok = await page.evaluate(() => { const c = window.__kuro; if (!c?.crt?.playCrash) return false; void c.crt.playCrash(); return true; });
      if (!ok) throw new Error('window.__kuro.crt.playCrash not available — is this the DEV build on :5173?');
    }
    const warmupMs = Math.round(opts.warmup * 1000);
    await syncAnimations(page, warmupMs);
    for (let i = 0; i < total; i++) {
      if (i > 0) { if (opts.clock === 'page') await page.clock.runFor(stepMs); else await runVirtual(cdp, stepMs); }
      await syncAnimations(page, warmupMs + i * stepMs);
      const png = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
      // The screenshot forces a rendering opportunity, and that is when finished transitions dispatch
      // their transitionend tasks (the crash overlays clean up on them). Give those tasks a moment of
      // real time before the next fake tick, or their order against the next timers depends on luck
      // (measured 2026-10-05: the crash matched in one check of two until this settle was added).
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
  const manifest = buildManifest(opts, out, { commit, unsauber, playwright: playwrightVersion, chromium: chromiumVersion });
  writeFileSync(join(outDir, 'bildfolge.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Per-frame pixel difference between two runs via ffmpeg: max absolute 8-bit luma difference and fraction. */
function pixelDiff(fileA, fileB) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', fileA, '-i', fileB, '-filter_complex', '[0:v][1:v]blend=all_mode=difference,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 });
  let max = 0, n = 0;
  for (const b of raw) { if (b > 0) { n++; if (b > max) max = b; } }
  return { max, fraction: raw.length ? n / raw.length : 0 };
}

if (opts.check) {
  const dirA = opts.out + '-check-a', dirB = opts.out + '-check-b';
  const a = await capture(dirA);
  const b = await capture(dirB);
  const hashes = compareManifests(a, b);
  const diffs = a.frames.map((f) => ({ file: f.file, ...pixelDiff(join(dirA, f.file), join(dirB, f.file)) }));
  const v = bewerteDifferenzen(diffs);
  console.log(`check: ${hashes.anzahl} frames, ${v.identisch} byte-identical, max pixel difference ${v.max}/255 -> ${v.stufe}${v.abweichend.length ? ' (' + v.abweichend.slice(0, 8).join(', ') + ')' : ''}`);
  process.exit(v.ok ? 0 : 1);
} else {
  const m = await capture(opts.out);
  console.log(`${m.frames.length} frames (${opts.width}x${opts.height}, ${opts.fps} fps, ${opts.seconds} s, clock ${opts.clock}, crash ${opts.crash}) -> ${opts.out}/bildfolge.json`);
  console.log('Now LOOK at the frames — a hash proves sameness, not that the scene is there.');
}
