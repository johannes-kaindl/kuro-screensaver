// Color presets — extracted from kuro-theme-settings/src/legacy.ts (lines 31-123).
// Pure data: theme accent presets used by the screensaver color resolver and
// the control-bar's preset picker. No DOM/Obsidian dependencies.

export interface ColorPreset {
  label: string;
  kanji: string;
  darkAccent: { color: string; rgb: string };
  lightAccent: { color: string; rgb: string };
  glowIntensity: number;
  scanlineOpacity: number;
  vignetteStrength: number;
}

export const PRESETS: Record<string, ColorPreset> = {
  'kuro': {
    label: 'Kuro', kanji: '黒',
    darkAccent:  { color: '#c4c0b4', rgb: '196, 192, 180' },
    lightAccent: { color: '#6B6761', rgb: '107, 103, 97' },
    glowIntensity: 0.15, scanlineOpacity: 0.01, vignetteStrength: 0,
  },
  'neural-bleed': {
    label: 'Neural Bleed', kanji: '脳',
    darkAccent:  { color: '#E8A5A5', rgb: '232, 165, 165' },
    lightAccent: { color: '#B54545', rgb: '181, 69, 69' },
    glowIntensity: 0.2, scanlineOpacity: 0.01, vignetteStrength: 0,
  },
  'rust-signal': {
    label: 'Rust Signal', kanji: '鉄',
    darkAccent:  { color: '#E8B979', rgb: '232, 185, 121' },
    lightAccent: { color: '#B87333', rgb: '184, 115, 51' },
    glowIntensity: 0.35, scanlineOpacity: 0.025, vignetteStrength: 0.1,
  },
  'toxic-haze': {
    label: 'Toxic Haze', kanji: '毒',
    darkAccent:  { color: '#D9C566', rgb: '217, 197, 102' },
    lightAccent: { color: '#9A8A1F', rgb: '154, 138, 31' },
    glowIntensity: 0.3, scanlineOpacity: 0.02, vignetteStrength: 0,
  },
  'biolink': {
    label: 'Biolink', kanji: '命',
    darkAccent:  { color: '#8BBF87', rgb: '139, 191, 135' },
    lightAccent: { color: '#4A8C54', rgb: '74, 140, 84' },
    glowIntensity: 0.25, scanlineOpacity: 0.015, vignetteStrength: 0,
  },
  'ghost-protocol': {
    label: 'Ghost Protocol', kanji: '霊',
    darkAccent:  { color: '#7AB8C4', rgb: '122, 184, 196' },
    lightAccent: { color: '#3A7A8C', rgb: '58, 122, 140' },
    glowIntensity: 0.3, scanlineOpacity: 0.02, vignetteStrength: 0,
  },
  'voidwitch': {
    label: 'Voidwitch', kanji: '魔',
    darkAccent:  { color: '#B49BD1', rgb: '180, 155, 209' },
    lightAccent: { color: '#6B4F9E', rgb: '107, 79, 158' },
    glowIntensity: 0.4, scanlineOpacity: 0.03, vignetteStrength: 0.2,
  },
  'circuit': {
    label: 'Circuit', kanji: '電',
    darkAccent:  { color: '#4ac8d8', rgb: '74, 200, 216' },
    lightAccent: { color: '#3A7A8C', rgb: '58, 122, 140' },
    glowIntensity: 0.44, scanlineOpacity: 0.035, vignetteStrength: 0,
  },
  'crimson': {
    label: 'Crimson', kanji: '紅',
    darkAccent:  { color: '#d4203a', rgb: '212, 32, 58' },
    lightAccent: { color: '#B54545', rgb: '181, 69, 69' },
    glowIntensity: 0.5, scanlineOpacity: 0.04, vignetteStrength: 0.25,
  },
  'phosphor': {
    label: 'Phosphor', kanji: '光',
    darkAccent:  { color: '#39ff7a', rgb: '57, 255, 122' },
    lightAccent: { color: '#4A8C54', rgb: '74, 140, 84' },
    glowIntensity: 0.7, scanlineOpacity: 0.06, vignetteStrength: 0,
  },
  'ember': {
    label: 'Ember', kanji: '炎',
    darkAccent:  { color: '#ffb442', rgb: '255, 180, 66' },
    lightAccent: { color: '#B87333', rgb: '184, 115, 51' },
    glowIntensity: 0.5, scanlineOpacity: 0.04, vignetteStrength: 0.15,
  },
  'spectre': {
    label: 'Spectre', kanji: '幻',
    darkAccent:  { color: '#a878ff', rgb: '168, 120, 255' },
    lightAccent: { color: '#6B4F9E', rgb: '107, 79, 158' },
    glowIntensity: 0.45, scanlineOpacity: 0.03, vignetteStrength: 0.2,
  },
  'pearl': {
    label: 'Pearl', kanji: '珠',
    darkAccent:  { color: '#e8e4d8', rgb: '232, 228, 216' },
    lightAccent: { color: '#9A958C', rgb: '154, 149, 140' },
    glowIntensity: 0.1, scanlineOpacity: 0, vignetteStrength: 0,
  },
};
