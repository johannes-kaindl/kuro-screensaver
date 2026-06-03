// Cinematic "digital rain" — a faithful TypeScript/Canvas-2D port of the native
// Metal MatrixRain.swift (KuroNativeSaver/Core/MatrixRain.swift). Smoothness comes
// from CONTINUOUS sub-pixel fall (no integer-row snapping → no stutter); 3D depth
// comes from 5 layers whose size/brightness/speed/tail/density grade FAR (small,
// dim, slow, soft, dense) → NEAR (large, bright, fast, glowing, sparse). Near-white
// heads cross the composer bloom threshold (0.05 luma) and glow; long green tails
// fade quadratically; glyphs mutate at scattered per-glyph rates (shimmer, not
// per-frame noise). Drawn back→front so near streams composite over distant ones.
//
// The Engine renders this onto an OFFSCREEN canvas and feeds it as a CanvasTexture
// into a ShaderPass *before* UnrealBloomPass (see fx/matrix-pass.ts), so the rain is
// bloomed + warped by the CRT curvature pass exactly like the native in-monitor
// rain — not a flat DOM overlay (which is what the old web matrix was).
//
// Pure deterministic function of (t, w, h): motion depends only on wall-clock t in
// seconds (never a frame counter), so it is frame-rate independent + reproducible.

const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー';
const GLYPHS = (KATA + KATA + '0123456789' + '=+-*<>:.?').split('');   // 113 glyphs (47 katakana × 2 + 10 digits + 9 symbols), katakana-dominant

// 32-bit integer hash (Knuth multiplicative). The native uses 64-bit wrapping
// arithmetic, but only the *distribution* matters for the rain's look, not a
// bit-exact match — this produces statistically equivalent pseudo-randomness.
// Math.imul applies ToUint32 to its args, so large inputs (slot, mstep*7919) fold
// in correctly without overflow.
function hash(x: number): number {
  let v = Math.imul(x, 2654435761) >>> 0;
  v ^= v >>> 15;
  v = Math.imul(v, 2246822519) >>> 0;
  v ^= v >>> 13;
  return v & 0x7fffffff;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const LAYERS = 5;
const FONT = '"Share Tech Mono", "Menlo", monospace';

export class MatrixRain {
  private aspect = 0.5;          // glyph advance ÷ fontSize for the chosen monospace font
  private aspectMeasured = false;

  /** Measure the monospace advance ratio once (constant across sizes for a mono font). */
  private charAspect(ctx: CanvasRenderingContext2D): number {
    if (!this.aspectMeasured) {
      const prev = ctx.font;
      ctx.font = `100px ${FONT}`;
      const w = ctx.measureText('M').width;
      if (w > 0) { this.aspect = w / 100; this.aspectMeasured = true; }
      ctx.font = prev;
    }
    return this.aspect;
  }

  /**
   * Render one frame of rain onto `ctx` (the offscreen canvas is `w`×`h`).
   * `accent` is the theme colour as 0..1 RGB; `opacity` scales the whole effect
   * (kept a background); `density` (0..1) scales the per-layer column count — a web
   * perf knob, since Canvas-2D fillText is far costlier than the native batched
   * quads (the native rain is always full density).
   */
  render(ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
         accent: [number, number, number], opacity: number, density: number): void {
    // Clear to black each frame — the trail is the analytic per-glyph tail (native
    // computes the whole stream every frame), NOT an accumulating fade buffer.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const W = w, H = h;
    const baseCell = H / 42;
    const leadIn = 2.0;
    const aspect = this.charAspect(ctx);
    const hb: [number, number, number] = [          // headBase = mix(accent, white, 0.72)
      lerp(accent[0], 1, 0.72), lerp(accent[1], 1, 0.72), lerp(accent[2], 1, 0.72),
    ];
    // Long-idle guard: bound the time magnitude before ×speed so the per-frame delta
    // keeps sub-pixel resolution even after hours of uptime.
    const tw = t % 100000;
    const colFactor = 0.5 + 0.5 * Math.min(1, Math.max(0, density));   // density 0.5 → 75% of native columns

    for (let L = 0; L < LAYERS; L++) {              // BACK → FRONT (overdraw = depth)
      const zf = L / (LAYERS - 1);
      const cell = baseCell * lerp(0.62, 1.5, zf);
      const cw = cell * aspect;
      const bright = lerp(0.34, 0.98, zf);
      const tailN = Math.max(8, Math.floor(lerp(15, 30, zf)));
      const colGap = lerp(1.4, 2.1, zf);            // ≥ ~1 + 2·jitter → no in-layer overlap
      const maxCols = Math.floor(lerp(170, 64, zf));
      const nCols = Math.min(maxCols, Math.max(1, Math.floor((W / (cw * colGap)) * colFactor)));
      const colW = W / nCols;
      const spMin = lerp(20, 80, zf), spMax = lerp(46, 168, zf);
      const span = H + (tailN + leadIn) * cell;
      const fadeBand = 2 * cell;
      const mutPerMille = Math.floor(lerp(120, 240, zf));
      ctx.font = `${cell}px ${FONT}`;

      for (let c = 0; c < nCols; c++) {
        const key = L * 100003 + c;
        const h0 = hash(key), h1 = hash(key ^ 0x9e3779b9), h2 = hash(key * 131 + 7);
        const speed = spMin + (h0 % 1000) / 1000 * (spMax - spMin);
        const phase = (h1 % 100000) / 100000 * span;
        const jitter = ((h2 % 1000) / 1000 - 0.5) * cw * 0.4;   // ±0.2·cw
        const x = (c + 0.5) * colW - cw * 0.5 + jitter;

        // Continuous head position (no integer-row quantization).
        const p = tw * speed + phase;
        const headY = p - Math.floor(p / span) * span - leadIn * cell;
        const slotHead = Math.floor(p / cell);      // monotone identity index

        for (let k = 0; k < tailN; k++) {
          const y = headY - k * cell;               // continuous sub-pixel y
          if (y <= -cell || y >= H) continue;

          // Identity keyed by the absolute cell slot: a physical glyph keeps its
          // character as it scrolls, re-rolling once per cell crossed.
          const slot = slotHead - k;
          const baseKey = key * 977 + slot * 131;
          let idx = hash(baseKey) % GLYPHS.length;
          // Scattered in-place mutation: only some glyphs ever flip, each on its own
          // phase, at quantized time steps → shimmer, not per-frame noise.
          const mh = hash(key * 40009 + slot * 89);
          if (mh % 1000 < mutPerMille) {
            const mstep = Math.floor(tw * 5.5 + (mh % 1000) / 1000 * 17);
            idx = hash(baseKey + mstep * 7919) % GLYPHS.length;
          }
          const g = GLYPHS[idx];

          // Shade: white-hot head → green neck → long quadratic green fade.
          let r: number, gg: number, b: number, op: number;
          if (k === 0) {
            r = hb[0] * bright; gg = hb[1] * bright; b = hb[2] * bright;
            op = Math.min(1, 0.95 * bright);
          } else if (k <= 2) {
            const m = k / 3;
            r = lerp(hb[0], accent[0], m) * bright;
            gg = lerp(hb[1], accent[1], m) * bright;
            b = lerp(hb[2], accent[2], m) * bright;
            op = Math.min(1, lerp(0.9, 0.7, m) * bright);
          } else {
            const f = 1 - (k - 2) / (tailN - 2);     // 1 → 0 down the tail
            const fade = f * f;                       // quadratic → long dark fade
            const s = 0.30 + 0.70 * fade;
            r = accent[0] * s; gg = accent[1] * s; b = accent[2] * s;
            op = 0.62 * fade * bright;
          }
          // Rare bright sparkle in the tail (deterministic, frame-rate independent).
          if (k >= 3) {
            const sk = key * 60013 + slot * 97 + Math.floor(tw * 3);
            if (hash(sk) % 1000 < 6) { r *= 1.9; gg *= 1.9; b *= 1.9; op = Math.min(1, op * 2 + 0.3); }
          }
          // Soft fade-in at the top + fade-out at the bottom (kills the head pop on exit).
          const eIn = Math.min(1, Math.max(0, (y + cell) / (leadIn * cell)));
          const eOut = Math.min(1, Math.max(0, (H - y) / fadeBand));
          op *= eIn * eOut * opacity;
          if (op <= 0.003) continue;

          const cr = Math.min(255, Math.round(r * 255));
          const cg = Math.min(255, Math.round(gg * 255));
          const cb = Math.min(255, Math.round(b * 255));
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${op.toFixed(3)})`;
          // maxWidth=cw condenses full-width katakana to the (narrow) cell width,
          // matching the native FontAtlas's half-width cells.
          ctx.fillText(g, x, y, cw);
        }
      }
    }
  }
}
