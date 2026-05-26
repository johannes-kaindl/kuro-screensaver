// Color resolver — reads from Kuro plugin's CSS variables (when present) or settings overrides.
// In a non-Obsidian host, the kuro-auto mode falls back to FALLBACK if the CSS vars
// are not set on document.body.
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

export function resolveColor(s: ScreensaverSettings): ResolvedColor {
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
