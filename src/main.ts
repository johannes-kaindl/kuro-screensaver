// Standalone entry — runs when the user opens index.html in a browser.
//
// Sensible defaults for non-Obsidian context (colorMode 'kuro-preset', vault kanji
// '黒'). Honours shared-URL params so links like
//   index.html?scene=void&preset=ember&threat=0.8
// open the right scene/preset/threat (the same params screensaver.html accepts).

import { mountScreensaver } from './host-web/mount';
import { SCENES, type SceneId, type ScreensaverSettings } from './engine/data/defaults';
import { PRESETS } from './engine/data/presets';

const params = new URLSearchParams(location.search);

const sceneParam = params.get('scene') ?? '';
const scene: SceneId | undefined =
  SCENES.includes(sceneParam as SceneId) ? (sceneParam as SceneId) : undefined;

const presetParam = params.get('preset') ?? '';
const hasPreset = presetParam in PRESETS;
const preset = hasPreset ? presetParam : 'toxic-haze';

const threatRaw = parseFloat(params.get('threat') ?? '');
const reactiveThreat = Number.isFinite(threatRaw)
  ? Math.min(1, Math.max(0, threatRaw)) : undefined;

const overrides: Partial<ScreensaverSettings> = {
  colorMode: 'kuro-preset',
  colorPreset: preset as ScreensaverSettings['colorPreset'],
  // Only pin the palette when the user explicitly chose a preset — otherwise keep
  // the default aspect/time-of-day matching the demo has always used.
  ...(hasPreset ? { aspectPaletteMode: 'inherit' as const } : {}),
  ...(scene ? { defaultScene: scene } : {}),
};

mountScreensaver({
  vaultKanji: '黒',
  activePreset: preset,
  overrides,
  openOpts: { scene, reactiveThreat },
});
