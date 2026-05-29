// Phase-1 visual check: trigger the CRT crash sequence directly (via the
// DEV-only window.__kuro hook) and capture it, so we can review the loop seam
// without waiting for a full ~8-min narrative shift.
//
// Needs the dev server running (npm run dev).
// Outputs render-out/crash.webm + timed screenshots crash-NN.png.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:5173/screensaver.html?scene=city&preset=phosphor';
const OUT = 'render-out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'load' });

// Let the engine + narrative spin up.
await page.waitForTimeout(3500);

console.log('triggering playCrash()');
// Fire the crash but don't await it inside evaluate — we want to screenshot
// the sequence as it runs.
await page.evaluate(() => {
  const c = window.__kuro;
  c?.crt?.playCrash(() => {
    // blackout callback — clear marker so we can confirm timing if needed
    document.title = 'BLACKOUT';
  });
});

// Sample the ~2s sequence at fixed offsets.
const shots = [200, 500, 850, 1100, 1400, 1700, 2100, 2600];
let prev = 0;
for (let n = 0; n < shots.length; n++) {
  await page.waitForTimeout(shots[n] - prev);
  prev = shots[n];
  await page.screenshot({ path: `${OUT}/crash-${String(n).padStart(2, '0')}-${shots[n]}ms.png` });
}
console.log('screenshots written');

await page.waitForTimeout(800);
await context.close();
await browser.close();
console.log(`done — ${OUT}/crash.webm + crash-*.png`);
