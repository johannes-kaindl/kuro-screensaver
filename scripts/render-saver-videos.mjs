// Phase-3 render pipeline: one looping H.265 video per color preset, for the
// macOS video .saver builds.
//
// Approach:
//   1. headful Chromium (real Metal GPU) opens screensaver.html?preset=X with a
//      shortened story cycle (?storyScale), captured via Playwright recordVideo
//      (stable, ~25fps, full WebGL+DOM composite → WebM).
//   2. Capture spans 2+ shift cycles → 2+ diegetic CRT crashes.
//   3. Crash blackouts are found with ffmpeg `blackdetect`. We cut from the
//      MIDDLE of crash[0]'s black to the MIDDLE of crash[1]'s black — both ends
//      are pure black, so the loop seam is unseen.
//   4. The segment is resampled to 60fps and encoded to H.265 (.mov,
//      hevc_videotoolbox) for AVPlayer.
//
// Needs the dev server running (npm run dev) and ffmpeg on PATH.
//
// Usage:
//   node scripts/render-saver-videos.mjs                 # all presets
//   node scripts/render-saver-videos.mjs kuro            # one preset
//   node scripts/render-saver-videos.mjs kuro crimson    # a subset

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────
const WIDTH = 2560, HEIGHT = 1440;     // 1440p
// recordVideo captures a constant 25fps; keep the container native (25→60
// doesn't divide evenly and would judder via uneven frame duplication).
const FPS = 25;
const BITRATE = process.env.BITRATE ?? '6M';   // ~125 MB per 2.5min preset
const STORY_SCALE = Number(process.env.STORY_SCALE ?? 0.3);   // ~2.5 min shift cycle
const CAPTURE_SECONDS = Number(process.env.CAPTURE_SECONDS ?? 400); // ~2 cycles + buffer → 2 crashes
const BASE_URL = 'http://localhost:5173/screensaver.html';
const OUT_DIR = 'render-out';
const VIDEO_DIR = join(OUT_DIR, 'videos');
const SCENES = ['terrain', 'city', 'rift', 'tunnel', 'void'];

// All 13 presets (keys from src/engine/data/presets.ts).
const ALL_PRESETS = [
  'kuro', 'neural-bleed', 'rust-signal', 'toxic-haze', 'biolink',
  'ghost-protocol', 'voidwitch', 'circuit', 'crimson', 'phosphor',
  'ember', 'spectre', 'pearl',
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function ff(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.slice(-600)}`);
  return r;
}

// A scene per preset, deterministic (no Math.random — disallowed in some envs).
function sceneFor(i) { return SCENES[i % SCENES.length]; }

/**
 * Run ffmpeg blackdetect and return the crash blackouts as {start,end,mid}.
 * Drops the boot-sequence black at the very start (before the first shift).
 */
function findCrashBlacks(webm) {
  const r = spawnSync('ffmpeg', ['-i', webm, '-vf', 'blackdetect=d=0.4:pix_th=0.10', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = (r.stderr || '') + (r.stdout || '');
  const blacks = [];
  const re = /black_start:([0-9.]+)\s+black_end:([0-9.]+)/g;
  let m;
  while ((m = re.exec(out))) {
    const start = +m[1], end = +m[2];
    if (start < 3) continue; // skip boot black
    blacks.push({ start, end, mid: (start + end) / 2 });
  }
  return blacks;
}

// ── Render one preset ────────────────────────────────────────────────────────
async function renderPreset(browser, preset, idx) {
  const scene = sceneFor(idx);
  const url = `${BASE_URL}?preset=${preset}&scene=${scene}&storyScale=${STORY_SCALE}`;
  const capDir = join(OUT_DIR, `cap-${preset}`);
  rmSync(capDir, { recursive: true, force: true });
  mkdirSync(capDir, { recursive: true });

  console.log(`\n▶ ${preset} (scene ${scene}) — capturing ${CAPTURE_SECONDS}s …`);
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: capDir, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(CAPTURE_SECONDS * 1000);
  const video = page.video();
  await ctx.close();           // flushes the WebM
  const webm = await video.path();

  // Find the crash blackouts; loop segment is mid-black[0] → mid-black[1].
  const crashes = findCrashBlacks(webm);
  console.log(`  crashes detected: ${crashes.length} at ${crashes.map((c) => c.mid.toFixed(1) + 's').join(', ')}`);
  if (crashes.length < 2) throw new Error(`${preset}: need 2 crashes, found ${crashes.length} — raise CAPTURE_SECONDS`);
  const t0 = crashes[0].mid, t1 = crashes[1].mid;
  const loopDur = t1 - t0;
  console.log(`  loop segment: ${t0.toFixed(1)}s → ${t1.toFixed(1)}s  (${loopDur.toFixed(1)}s)`);

  // Trim to the segment, resample to constant FPS, encode H.265 for AVPlayer.
  mkdirSync(VIDEO_DIR, { recursive: true });
  const out = join(VIDEO_DIR, `kuro-${preset}.mov`);
  ff([
    '-y', '-ss', t0.toFixed(3), '-to', t1.toFixed(3), '-i', webm,
    '-vf', `fps=${FPS},format=yuv420p`,
    '-c:v', 'hevc_videotoolbox', '-b:v', BITRATE, '-tag:v', 'hvc1',
    out,
  ]);
  const mb = (statSync(out).size / 1e6).toFixed(1);
  console.log(`  ✓ ${out}  (${mb} MB, ${loopDur.toFixed(1)}s loop)`);

  rmSync(capDir, { recursive: true, force: true }); // reclaim disk
  return { preset, out, mb, loopDur };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const want = process.argv.slice(2);
const presets = want.length ? want : ALL_PRESETS;
mkdirSync(OUT_DIR, { recursive: true });

// headless=new renders WebGL fine via ANGLE/Metal and is far more stable for
// long captures — a headful window gets backgrounded/occluded by the OS and the
// renderer is suspended/killed within ~1-2 min, aborting the capture.
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-gpu-process-crash-limit',
  ],
});
const results = [];
for (let i = 0; i < presets.length; i++) {
  try { results.push(await renderPreset(browser, presets[i], i)); }
  catch (e) { console.error(`  ✗ ${presets[i]}: ${e.message}`); }
}
await browser.close();

console.log('\n── Summary ──');
for (const r of results) console.log(`  ${r.preset.padEnd(16)} ${r.mb} MB  ${r.loopDur.toFixed(1)}s`);
console.log(`Done: ${results.length}/${presets.length} videos in ${VIDEO_DIR}`);
