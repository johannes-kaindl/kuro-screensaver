// Records the README motion GIF (docs/images/motion.gif) from the live engine.
//
// Run the dev server first (npm run dev), then: node scripts/render-motion-gif.mjs
// Needs ffmpeg on PATH. Headful on purpose — the terrain needs a real GPU;
// SwiftShader drops the wireframe to a crawl and the capture goes choppy.
//
// Contract for the output (workspace README image standard, _docs/readme):
//   - <= 2048 KB (gif budget)
//   - embedded at width="320" — half the file width, because the standard reads a
//     capture as retina (dpr 2) and caps the display width at half the pixels
// Length and palette below are tuned to sit under the budget (~1.75 MB);
// the script exits non-zero if a change pushes it over.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = 'docs/images/motion.gif';
const SETTLE_MS = 6000;   // boot + first banking turn
const RECORD_MS = 6000;
const SECONDS = 4.0;      // GIF length cut from the settled part of the capture
const FPS = 8;
const WIDTH = 640;
const COLORS = 16;

// fog/weather/bloom are pinned: the default reactive world drifts with the
// narrative threat level, and at full bloom the toxic-haze phosphor blows out
// into a flat sheet — the wireframe, which is the point of the shot, disappears.
const url = `${BASE}/screensaver.html?scene=terrain&preset=toxic-haze`
  + '&terminal=0&radar=0&crosshair=0&boot=0&kiosk=1'
  + '&threat=0&fog=clear&weather=clear&bloomstrength=0.3&altitude=mid';

// WEBM=<file> reuses an earlier capture, so palette/frame tuning below can be
// iterated without re-rendering (and without a browser window popping up).
const work = mkdtempSync(join(tmpdir(), 'kuro-gif-'));
let webm = process.env.WEBM;
if (!webm) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: work, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS + RECORD_MS);
  await ctx.close();
  await browser.close();
  webm = join(work, execFileSync('ls', [work]).toString().trim().split('\n')[0]);
  if (process.env.KEEP_WEBM) execFileSync('cp', [webm, process.env.KEEP_WEBM]);
}
const palette = join(work, 'palette.png');
const filters = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`;
const cut = ['-ss', String(SETTLE_MS / 1000), '-t', String(SECONDS)];

// Dithering is off and the palette is small on purpose: the CRT grain turns
// every dither pattern into per-frame noise, and noise is what a GIF pays for.
// Measured on this clip — 10 fps/4.5 s/32 colours with dithering: 3.7 MB;
// the settings below: ~1.8 MB. The phosphor is near-monochrome, so 16 colours
// cost no visible banding.
execFileSync('ffmpeg', ['-v', 'error', ...cut, '-i', webm,
  '-vf', `${filters},palettegen=max_colors=${COLORS}:stats_mode=diff`, '-y', palette]);
execFileSync('ffmpeg', ['-v', 'error', ...cut, '-i', webm, '-i', palette,
  '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=none`,
  '-loop', '0', '-y', OUT]);

rmSync(work, { recursive: true, force: true });
const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${OUT} — ${kb} KB (budget 2048 KB)`);
if (kb > 2048) process.exitCode = 1;
