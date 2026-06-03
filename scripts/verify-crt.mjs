import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'render-out'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
// shot spec: "scene:preset" or "scene:preset:matrix" (3rd token enables ?matrix=1)
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['void:phosphor','terrain:toxic-haze'];
const wait = Number(process.env.WAIT_MS || 9000);
for (const s of shots) {
  const [scene, preset, flag] = s.split(':');
  const matrix = flag === 'matrix';
  const page = await ctx.newPage();
  const url = `http://localhost:5173/screensaver.html?scene=${scene}&preset=${preset}${matrix ? '&matrix=1' : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  const name = `crt-${scene}${matrix ? '-matrix' : ''}.png`;
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(`shot ${name} (${url})`);
  await page.close();
}
await ctx.close(); await browser.close();
