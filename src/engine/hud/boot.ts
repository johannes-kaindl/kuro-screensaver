// @ts-nocheck
// Boot sequence overlay — VT323 with [ OK ] right-aligned per line.
import { DICT, pickFrom } from '../data/dictionary';
import type { SceneId } from '../data/defaults';

const SPEED_MAP = {
  fast:      { line: 30,  hold: 100 },
  normal:    { line: 90,  hold: 280 },
  cinematic: { line: 200, hold: 600 },
} as const;

export function showBoot(host: HTMLElement, scene: SceneId, speedKey: 'fast' | 'normal' | 'cinematic'): Promise<void> {
  return new Promise((resolve) => {
    const speed = SPEED_MAP[speedKey];
    // v1.2 — Mobile-friendly boot sizing (Live-Test 2026-05-13). The fixed
    //   23px font wrapped every BIOS line into 2-3 phone-portrait rows.
    //   `clamp(13px, 3.6vw, 23px)` scales between 13px on narrow phones
    //   and 23px on desktop without media-query branching. Width clamp
    //   similar: stays under 92vw on phone, hits the 580px reading width
    //   ceiling on desktop.
    const overlay = document.createElement('div');
    overlay.setAttribute('style',
      'position:absolute;inset:0;z-index:200;background:#000;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;font-family:VT323,monospace;' +
      'font-size:clamp(13px, 3.6vw, 23px);' +
      'color:var(--ks-p,#00ff41);text-shadow:0 0 10px var(--ks-p,#00ff41);letter-spacing:.07em');
    const inner = document.createElement('div');
    inner.setAttribute('style', 'width:min(92vw, 580px);line-height:1.7;padding:0 8px');
    overlay.appendChild(inner);
    host.appendChild(overlay);

    const lines = [...DICT.BOOT_LINES].sort(() => Math.random() - 0.5).slice(0, 7).map(l => [l, 'OK'] as const);
    lines.push(['', '']);
    lines.push([DICT.BOOT_HEADERS[scene], '']);
    let i = 0;
    const next = () => {
      if (i >= lines.length) {
        setTimeout(() => { overlay.remove(); resolve(); }, speed.hold);
        return;
      }
      const [tx, st] = lines[i++];
      const sp = document.createElement('span');
      sp.style.display = 'block';
      if (!tx && !st) { sp.innerHTML = '&nbsp;'; inner.appendChild(sp); setTimeout(next, speed.line / 2); return; }
      sp.textContent = tx;
      if (st) {
        const ok = document.createElement('span');
        ok.setAttribute('style', 'float:right');
        ok.textContent = `[ ${st} ]`;
        sp.appendChild(ok);
      }
      inner.appendChild(sp);
      setTimeout(next, tx.startsWith('>>') ? speed.hold : speed.line);
    };
    next();
  });
}
