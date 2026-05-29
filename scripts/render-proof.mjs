// Phase-0 render proof: does headful Chromium render the FULL screensaver
// (WebGL canvas + CRT/HUD/terminal DOM overlays) to a video file?
//
// Run the dev server first (npm run dev), then: node scripts/render-proof.mjs
// Outputs to render-out/proof.webm and a mid-capture proof.png screenshot.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:5173/screensaver.html?scene=city&preset=toxic-haze';
const OUT = 'render-out';
const SECONDS = 15;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: false, // real Metal GPU — avoids SwiftShader + compositing limits
  args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});

const page = await context.newPage();
console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: 'load' });

// Let the engine spin up, then screenshot mid-capture to prove pixels are live.
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/proof.png` });
console.log('mid-capture screenshot written');

await page.waitForTimeout((SECONDS - 5) * 1000);

await context.close(); // flushes the .webm
await browser.close();
console.log(`done — ${OUT}/proof.webm`);
