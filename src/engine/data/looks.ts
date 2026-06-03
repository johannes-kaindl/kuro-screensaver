// Looks — one-click "vibe" bundles that set the color preset + every CRT knob at
// once. Ported from the native app (Looks.swift). Distinct from the 13 COLOR
// presets (which only set hue/glow/scanline/vignette). applyLook() mutates the
// live settings; the caller then re-applies color + fx as usual.
import type { ScreensaverSettings } from './defaults';

export interface Look {
  label: string;
  preset: string;     // color preset id
  curvature: number;  // 0..~0.25
  aperture: number;   // grille strength 0..~0.5
  trails: number;     // 0..~0.9 (mapped to afterimage damp)
  ntsc: number;       // 0..1
  halation: number;   // 0..~0.6
  bloom: number;      // bloom strength (web absolute, default ~1.4)
  intensity: number;  // crtSim glitch cadence 0..1
  matrix: boolean;
}

export const LOOKS: Record<string, Look> = {
  clean:  { label: 'Clean',           preset: 'kuro',     curvature: 0.04, aperture: 0.06, trails: 0.10, ntsc: 0.0, halation: 0.05, bloom: 0.9, intensity: 0.10, matrix: false },
  heavy:  { label: 'Heavy CRT',       preset: 'phosphor', curvature: 0.22, aperture: 0.45, trails: 0.50, ntsc: 0.6, halation: 0.40, bloom: 1.6, intensity: 0.50, matrix: false },
  broken: { label: 'Broken Terminal', preset: 'crimson',  curvature: 0.17, aperture: 0.32, trails: 0.42, ntsc: 0.9, halation: 0.50, bloom: 1.4, intensity: 0.85, matrix: false },
  vapor:  { label: 'Vaporwave',       preset: 'spectre',  curvature: 0.14, aperture: 0.18, trails: 0.70, ntsc: 0.4, halation: 0.60, bloom: 1.9, intensity: 0.20, matrix: false },
  matrix: { label: 'Matrix',          preset: 'phosphor', curvature: 0.12, aperture: 0.22, trails: 0.45, ntsc: 0.3, halation: 0.35, bloom: 1.4, intensity: 0.25, matrix: true },
};

/** Apply a Look in place onto the live settings (color preset + all CRT knobs). */
export function applyLook(s: ScreensaverSettings, key: string): void {
  const L = LOOKS[key];
  if (!L) return;
  s.aspectPaletteMode = 'inherit';            // explicit pick wins over aspect-match
  s.colorMode = 'kuro-preset';
  s.colorPreset = L.preset as ScreensaverSettings['colorPreset'];
  s.fx.curvature = { on: L.curvature > 0.001, amount: L.curvature };
  s.fx.aperture  = { on: L.aperture > 0.001, strength: L.aperture };
  s.fx.ntsc      = { on: L.ntsc > 0.001, amount: L.ntsc };
  s.fx.halation  = { on: L.halation > 0.001, amount: L.halation };
  s.fx.trails    = { on: L.trails > 0.001, damp: 0.5 + L.trails * 0.45 };   // 0..0.9 → damp 0.5..0.9
  s.fx.bloom     = { on: true, strength: L.bloom };
  s.fx.matrix    = { on: L.matrix, density: s.fx.matrix.density };
  s.crtSim.intensity = L.intensity;
  if (L.intensity > 0.001) s.crtSim.on = true;
}
