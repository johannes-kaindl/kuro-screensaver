// Color presets — FACADE over the shared content SSOT (story-content.json).
//
// The preset literals moved into story-content.json (the single source shared with the
// native Swift twin, `Palette.swift`) in Slice 1b. They are stored there as an ordered
// ARRAY of `{ id, ...fields }` (matching the native ordered `[ColorPreset]` so Slice 1.3
// decodes it directly, and keeping order explicit rather than relying on JS object key
// order). This module rebuilds the original `Record<id, ColorPreset>` shape — stripping
// `id` back out so PRESETS is byte-identical to the old literal (guarded by
// tests/dict-presets-parity.test.ts) and `Object.keys(PRESETS)` keeps the file order the
// COLOR swatch picker iterates (controller.ts). Computed preset math (hex→rgb, dim/faint,
// aspect mapping) stays code-side in color.ts.
//
// Originally extracted from kuro-theme-settings/src/legacy.ts (lines 31-123).

import story from './story-content.json';

export interface ColorPreset {
  label: string;
  kanji: string;
  darkAccent: { color: string; rgb: string };
  lightAccent: { color: string; rgb: string };
  glowIntensity: number;
  scanlineOpacity: number;
  vignetteStrength: number;
}

export const PRESETS: Record<string, ColorPreset> = Object.fromEntries(
  (story.presets as Array<{ id: string } & ColorPreset>).map(({ id, ...rest }) => [id, rest]),
);
