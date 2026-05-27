// Color resolver — reads from Kuro plugin's CSS variables or settings overrides.
import { PRESETS } from '../data/presets';
import type { ScreensaverSettings } from '../data/defaults';

export interface ResolvedColor {
  hex: number;
  css: string;
  dim: string;
  faint: string;
  rgb: [number, number, number];
}

const FALLBACK: ResolvedColor = {
  hex: 0x00ff41, css: '#00ff41', dim: '#00b82e', faint: '#003d10',
  rgb: [0, 255, 65],
};

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = parseInt(m, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function dimOf(rgb: [number, number, number], factor = 0.72): string {
  return `rgb(${Math.round(rgb[0] * factor)},${Math.round(rgb[1] * factor)},${Math.round(rgb[2] * factor)})`;
}

function faintOf(rgb: [number, number, number], factor = 0.24): string {
  return `rgb(${Math.round(rgb[0] * factor)},${Math.round(rgb[1] * factor)},${Math.round(rgb[2] * factor)})`;
}

function fromHex(hex: string): ResolvedColor {
  const rgb = hexToRgb(hex);
  return {
    hex: parseInt(hex.replace('#', ''), 16),
    css: hex,
    dim: dimOf(rgb),
    faint: faintOf(rgb),
    rgb,
  };
}

/**
 * v1.1 — Live-Test 2026-05-11. Maps a vault aspect to the KSP signal
 * preset whose accent matches the aspect's role. The screensaver uses
 * this when `aspectPaletteMode === 'matchAspect'` so the idle palette
 * tracks whichever aspect is currently driving the vault chrome.
 */
const ASPECT_TO_PRESET: Record<'shugo' | 'gunshi' | 'kantoku' | 'sensei', string> = {
  shugo:   'phosphor',
  gunshi:  'spectre',
  kantoku: 'crimson',
  sensei:  'ember',
};

function colorFromAspect(aspect: 'shugo' | 'gunshi' | 'kantoku' | 'sensei'): ResolvedColor | null {
  const key = ASPECT_TO_PRESET[aspect];
  const p = (PRESETS as any)[key];
  return p ? fromHex(p.darkAccent.color) : null;
}

/**
 * v1.2 — Time-of-day aspect mood mapping (Live-Test 2026-05-13).
 * Used when aspectPaletteMode === 'matchAspect' but no data-aspect is set
 * on <html>: instead of always falling to aspectPaletteFixed, pick an
 * aspect that matches the wall-clock hour. Gives the screensaver a
 * subtle natural rhythm across the day even on vaults that don't drive
 * the aspect attribute themselves.
 */
function timeOfDayAspect(): 'shugo' | 'gunshi' | 'kantoku' | 'sensei' {
  const h = new Date().getHours();
  if (h >= 6  && h < 10) return 'shugo';   // Morning — fresh phosphor
  if (h >= 10 && h < 17) return 'gunshi';  // Day — neutral spectre
  if (h >= 17 && h < 22) return 'kantoku'; // Evening — intense crimson
  return 'sensei';                          // Night — warm ember
}

export function resolveColor(s: ScreensaverSettings): ResolvedColor {
  // 1. Aspect-palette override (new in v1.1, default for fresh installs).
  if (s.aspectPaletteMode === 'matchAspect') {
    const live = (document.documentElement.getAttribute('data-aspect') || '').toLowerCase();
    if (live === 'shugo' || live === 'gunshi' || live === 'kantoku' || live === 'sensei') {
      const c = colorFromAspect(live);
      if (c) return c;
    }
    // v1.2 — No vault aspect set: use time-of-day mood instead of the
    // hardcoded fixed default. Falls back to aspectPaletteFixed only if
    // the time-of-day resolution somehow fails.
    const tod = timeOfDayAspect();
    const ctod = colorFromAspect(tod);
    if (ctod) return ctod;
    const c = colorFromAspect(s.aspectPaletteFixed);
    if (c) return c;
  }
  if (s.aspectPaletteMode === 'pickFixed') {
    const c = colorFromAspect(s.aspectPaletteFixed);
    if (c) return c;
  }

  // 2. Legacy v1.0 paths — used when aspectPaletteMode === 'inherit' or
  //    when the aspect path failed to resolve.
  if (s.colorMode === 'custom') {
    try { return fromHex(s.colorCustom); } catch { /* fall through */ }
  }

  if (s.colorMode === 'kuro-preset') {
    const p = (PRESETS as any)[s.colorPreset];
    if (p) return fromHex(p.darkAccent.color);
  }

  // 'kuro-auto' — read live from document.body
  const cs = getComputedStyle(document.body);
  const accentHex = cs.getPropertyValue('--kuro-circuit').trim();
  if (accentHex && /^#[0-9a-f]{6}$/i.test(accentHex)) {
    return fromHex(accentHex);
  }
  // Fallback: try --interactive-accent
  const ia = cs.getPropertyValue('--interactive-accent').trim();
  if (ia && /^#[0-9a-f]{6}$/i.test(ia)) {
    return fromHex(ia);
  }
  return FALLBACK;
}

export function readKuroFxDefaults(): {
  glowIntensity: number;
  scanlineOpacity: number;
  vignetteStrength: number;
} {
  const cs = getComputedStyle(document.body);
  const num = (k: string, fb: number) => {
    const v = parseFloat(cs.getPropertyValue(k));
    return Number.isFinite(v) ? v : fb;
  };
  return {
    glowIntensity:    num('--kuro-glow-intensity', 0.3),
    scanlineOpacity:  num('--kuro-scanline-opacity', 0.02),
    vignetteStrength: num('--kuro-vignette', 0.0),
  };
}
