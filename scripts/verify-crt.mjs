import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'render-out'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['void:phosphor','terrain:toxic-haze'];
for (const s of shots) {
  const [scene, preset] = s.split(':');
  const page = await ctx.newPage();
  await page.goto(`http://localhost:5173/screensaver.html?scene=${scene}&preset=${preset}`, { waitUntil: 'load' });
  await page.waitForTimeout(13000);
  await page.screenshot({ path: `${OUT}/crt-${scene}.png` });
  console.log(`shot ${scene}/${preset}`);
  await page.close();
}
await ctx.close(); await browser.close();
