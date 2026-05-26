// CRT simulation — composite of all signal-degradation artifacts a real CRT
// monitor would produce. Replaces the simple `glitch` clip-path animation.
//
// Per tick (interval scales inversely with intensity), the runner picks ONE
// artifact at random — weighted so common subtle effects (h-tear, brightness
// flicker) fire often, while rare violent ones (v-roll, rolling band) fire
// occasionally. Both frequency and amplitude scale with intensity.
//
// Artifacts implemented:
//   • H-sync tear        — sudden horizontal slice shift
//   • V-sync roll        — image rolls vertically and snaps back
//   • Brightness flicker — luminance pulse via filter:brightness
//   • Black frame drop   — momentary opacity 0 (~30 ms)
//   • Rolling band       — VHS-style bright band sliding top → bottom
//   • Chroma spike       — chromaticAberration uniform pushed up briefly
//   • Wave distortion    — temporary skew transform
//   • Static burst       — single-frame noise overlay (separate ks-noise)
//
// Side effects only on the WebGL canvas + a small overlay div for the rolling
// band. No DOM lookups in the hot loop — refs cached at construction.

import type { ScreensaverSettings } from '../data/defaults';
import type { Engine } from '../engine/core';

export class CrtSim {
  private rafId = 0;
  private nextTickAt = 0;

  private bandEl: HTMLDivElement | null = null;

  // Track active artifact timeouts so we can clear them on dispose.
  private timeouts: number[] = [];

  // Saved baselines so we can restore cleanly when an artifact ends.
  private baseChromaOffset = 0;

  /**
   * @param scanlinesEl  optional reference to the HUD's scanline overlay div.
   *                     When provided, additional scanline-specific artifacts
   *                     fire (pulse, hum bar, interlace flicker, h-tear sync).
   */
  constructor(
    public canvas: HTMLCanvasElement,
    public overlayHost: HTMLElement,
    public engine: Engine,
    public settings: ScreensaverSettings,
    public scanlinesEl: HTMLElement | null = null,
  ) {
    this.baseChromaOffset = engine.chromaPass.uniforms.offset.value;
  }

  private humBarEl: HTMLDivElement | null = null;

  start() {
    this.nextTickAt = performance.now() + 600;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.timeouts.splice(0).forEach((id) => clearTimeout(id));
  }

  dispose() {
    this.stop();
    this.bandEl?.remove();
    this.bandEl = null;
    this.humBarEl?.remove();
    this.humBarEl = null;
    // Reset any lingering canvas styles
    this.canvas.style.transform = '';
    this.canvas.style.filter = '';
    this.canvas.style.opacity = '';
    this.canvas.style.transition = '';
    // Reset scanline element styles we may have touched
    if (this.scanlinesEl) {
      this.scanlinesEl.style.transform = '';
      this.scanlinesEl.style.transition = '';
      this.scanlinesEl.style.backgroundPositionY = '';
    }
    // Reset chroma uniform if we changed it
    this.engine.chromaPass.uniforms.offset.value = this.baseChromaOffset;
  }

  /** Update settings ref (live tuning while screensaver is open). */
  setSettings(s: ScreensaverSettings) { this.settings = s; }

  // ── Tick scheduler ─────────────────────────────────────────────────────

  private tick = (now: number) => {
    this.rafId = requestAnimationFrame(this.tick);
    if (!this.settings.crtSim.on) return;
    if (now < this.nextTickAt) return;

    const i = Math.max(0, Math.min(1, this.settings.crtSim.intensity));
    // Tick interval: high intensity = frequent (≈400 ms), low = sparse (≈3500 ms).
    const baseInterval = 3500 - i * 3000;
    const jitter = baseInterval * 0.6;
    this.nextTickAt = now + baseInterval + Math.random() * jitter;

    this.fireOneArtifact(i);
  };

  /** Pick one artifact based on weighted probabilities, fire it. */
  private fireOneArtifact(i: number) {
    // Weights — common subtle effects high, rare violent ones low.
    // Scanline-targeted artifacts only contribute weight if scanlinesEl exists.
    const hasScan = this.scanlinesEl != null;
    const weights: Array<[() => void, number]> = [
      [() => this.fireHTear(i),                28],
      [() => this.fireBrightnessFlicker(i),    20],
      [() => this.fireChromaSpike(i),          12],
      [() => this.fireWaveDistort(i),          10],
      [() => this.fireBlackFrame(i),            8],
      [() => this.fireStaticBurst(i),           7],
      [() => this.fireRollingBand(i),           5],
      [() => this.fireVRoll(i),                 4],
      // Scanline-specific artifacts
      [() => this.fireScanlinePulse(i),         hasScan ? 14 : 0],
      [() => this.fireHumBar(i),                hasScan ? 7  : 0],
      [() => this.fireInterlaceFlicker(i),      hasScan ? 9  : 0],
      [() => this.fireScanlineHTear(i),         hasScan ? 6  : 0],
    ];
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [fn, w] of weights) {
      r -= w;
      if (r <= 0) { fn(); return; }
    }
  }

  private after(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      const ix = this.timeouts.indexOf(id);
      if (ix >= 0) this.timeouts.splice(ix, 1);
      fn();
    }, ms);
    this.timeouts.push(id);
  }

  // ── Artifacts ──────────────────────────────────────────────────────────

  /** Sudden horizontal shift simulating loss of horizontal sync. */
  private fireHTear(i: number) {
    const dx = (Math.random() - 0.5) * (8 + i * 32);
    this.canvas.style.transition = 'none';
    this.canvas.style.transform = `translateX(${dx.toFixed(1)}px)`;
    this.after(40 + Math.random() * 80, () => {
      this.canvas.style.transform = '';
    });
  }

  /** Image rolls vertically attempting to re-lock, then snaps back. */
  private fireVRoll(i: number) {
    const dy = (40 + Math.random() * 60) * i;
    this.canvas.style.transition = 'transform .15s ease-out';
    this.canvas.style.transform = `translateY(${dy.toFixed(1)}px)`;
    this.after(150, () => {
      this.canvas.style.transition = 'transform .35s ease-in';
      this.canvas.style.transform = '';
      this.after(380, () => { this.canvas.style.transition = ''; });
    });
  }

  /** Luminance pulse — image brightens or dims briefly. */
  private fireBrightnessFlicker(i: number) {
    const direction = Math.random() < 0.6 ? 'down' : 'up';
    const b = direction === 'down' ? 1 - 0.3 * i - Math.random() * 0.2 : 1 + 0.3 * i + Math.random() * 0.4;
    this.canvas.style.filter = `brightness(${b.toFixed(2)})`;
    this.after(60 + Math.random() * 90, () => {
      this.canvas.style.filter = '';
    });
  }

  /** Single-frame blackout — sync drop. */
  private fireBlackFrame(_i: number) {
    this.canvas.style.opacity = '0';
    this.after(20 + Math.random() * 30, () => {
      this.canvas.style.opacity = '';
    });
  }

  /** VHS-style bright band sliding top → bottom across the image. */
  private fireRollingBand(i: number) {
    if (!this.bandEl) {
      this.bandEl = document.createElement('div');
      this.bandEl.setAttribute('style',
        'position:absolute;left:0;right:0;height:80px;z-index:32;pointer-events:none;' +
        'background:linear-gradient(to bottom, transparent 0%, rgba(255,255,255,.18) 50%, transparent 100%);' +
        'mix-blend-mode:screen;top:-100px;opacity:0');
      this.overlayHost.appendChild(this.bandEl);
    }
    const el = this.bandEl;
    const dur = 1.2 + Math.random() * 1.0;
    const opacity = 0.35 + Math.random() * 0.4 * i;
    el.style.transition = 'none';
    el.style.top = '-100px';
    el.style.opacity = String(opacity);
    requestAnimationFrame(() => {
      el.style.transition = `top ${dur}s linear`;
      el.style.top = '110%';
      this.after(dur * 1000, () => { el.style.opacity = '0'; });
    });
  }

  /** Chromatic aberration uniform spikes briefly — RGB channels tear apart. */
  private fireChromaSpike(i: number) {
    const spike = this.baseChromaOffset + (0.003 + Math.random() * 0.006) * i;
    this.engine.chromaPass.uniforms.offset.value = spike;
    // Force pass on if intensity is meaningful enough to be visible
    const wasEnabled = this.engine.chromaPass.enabled;
    this.engine.chromaPass.enabled = true;
    this.after(80 + Math.random() * 120, () => {
      this.engine.chromaPass.uniforms.offset.value = this.baseChromaOffset;
      this.engine.chromaPass.enabled = wasEnabled;
    });
  }

  /** Skew distortion — magnetic interference / signal warp. */
  private fireWaveDistort(i: number) {
    const skewX = (Math.random() - 0.5) * 4 * i;
    const skewY = (Math.random() - 0.5) * 1.2 * i;
    this.canvas.style.transition = 'none';
    this.canvas.style.transform = `skew(${skewX.toFixed(2)}deg, ${skewY.toFixed(2)}deg)`;
    this.after(80 + Math.random() * 100, () => {
      this.canvas.style.transform = '';
    });
  }

  // ── Scanline-specific artifacts (only when scanlinesEl provided) ──────

  /** Scanline opacity briefly spikes — like the CRT phosphors flaring. */
  private fireScanlinePulse(i: number) {
    if (!this.scanlinesEl) return;
    const cur = this.scanlinesEl.style.opacity;
    const baseOp = parseFloat(cur || '0.5') || 0.5;
    const spike = Math.min(1.0, baseOp * (1.4 + i * 1.2));
    this.scanlinesEl.style.opacity = spike.toFixed(3);
    this.after(140 + Math.random() * 220, () => {
      if (this.scanlinesEl) this.scanlinesEl.style.opacity = cur;
    });
  }

  /**
   * VHS / electrical hum bar — thin band of darker scanlines slowly traveling
   * top → bottom. Distinct from the white rolling band: this one DARKENS.
   */
  private fireHumBar(i: number) {
    if (!this.humBarEl) {
      this.humBarEl = document.createElement('div');
      this.humBarEl.setAttribute('style',
        'position:absolute;left:0;right:0;height:48px;z-index:30;pointer-events:none;' +
        'background:repeating-linear-gradient(' +
          'to bottom,' +
          'transparent 0px, transparent 1px,' +
          'rgba(0,0,0,.45) 1px, rgba(0,0,0,.45) 2px,' +
          'transparent 2px, transparent 4px' +
        ');' +
        'mix-blend-mode:multiply;top:-60px;opacity:0');
      this.overlayHost.appendChild(this.humBarEl);
    }
    const el = this.humBarEl;
    const dur = 2.5 + Math.random() * 2.5;
    const opacity = 0.45 + Math.random() * 0.4 * i;
    el.style.transition = 'none';
    el.style.top = '-60px';
    el.style.opacity = opacity.toFixed(3);
    requestAnimationFrame(() => {
      el.style.transition = `top ${dur}s linear`;
      el.style.top = '110%';
      this.after(dur * 1000, () => { el.style.opacity = '0'; });
    });
  }

  /**
   * Interlace flicker — rapid toggle of scanline pattern offset, simulating
   * a 60-Hz CRT showing alternating odd/even scan fields out of phase.
   */
  private fireInterlaceFlicker(i: number) {
    if (!this.scanlinesEl) return;
    const flicks = 5 + Math.floor(i * 8);
    let count = 0;
    let toggle = false;
    const flick = () => {
      if (count >= flicks || !this.scanlinesEl) return;
      this.scanlinesEl.style.backgroundPositionY = toggle ? '0px' : '2px';
      toggle = !toggle;
      count++;
      this.after(35 + Math.random() * 25, flick);
    };
    flick();
  }

  /** Coordinated horizontal tear on canvas + scanline pattern (sync glitch). */
  private fireScanlineHTear(i: number) {
    this.fireHTear(i);
    if (!this.scanlinesEl) return;
    const dx = (Math.random() - 0.5) * (6 + 18 * i);
    const prevTrans = this.scanlinesEl.style.transition;
    const prevTransform = this.scanlinesEl.style.transform;
    this.scanlinesEl.style.transition = 'none';
    this.scanlinesEl.style.transform = `translateX(${dx.toFixed(1)}px)`;
    this.after(50 + Math.random() * 70, () => {
      if (!this.scanlinesEl) return;
      this.scanlinesEl.style.transform = prevTransform;
      this.scanlinesEl.style.transition = prevTrans;
    });
  }

  /** Single-frame static burst — random pixel noise overlay. */
  private fireStaticBurst(i: number) {
    const c = document.createElement('canvas');
    const W = 240, H = 140;
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    if (!cx) return;
    const img = cx.createImageData(W, H);
    const density = 0.35 + 0.55 * i;
    for (let p = 0; p < img.data.length; p += 4) {
      const v = Math.random() < density ? 255 : 0;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = Math.random() * 110 * i;
    }
    cx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    const overlay = document.createElement('div');
    overlay.setAttribute('style',
      `position:absolute;inset:0;z-index:33;pointer-events:none;background:url(${url});` +
      'mix-blend-mode:screen;opacity:0.55;background-size:cover');
    this.overlayHost.appendChild(overlay);
    this.after(40 + Math.random() * 50, () => overlay.remove());
  }
}
