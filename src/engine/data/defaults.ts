// Default settings for the screensaver subsystem.
// Additive merge into legacy DEFAULT_SETTINGS via main.ts.

export interface ScreensaverSettings {
  defaultScene: 'terrain' | 'city' | 'rift' | 'tunnel' | 'void';
  speed: 'slow' | 'norm' | 'fast';
  cityAltitude: 'low' | 'mid' | 'high';
  tunnelAutoBoost: boolean;
  seedLock: number | null;

  colorMode: 'kuro-auto' | 'kuro-preset' | 'custom';
  colorPreset: string;
  colorCustom: string;

  /**
   * v1.1 — Live-Test 2026-05-11. Determines how the screensaver picks its
   * primary palette tone.
   *
   *  'matchAspect' (default)
   *      The screensaver reads `html[data-aspect]` on open and maps the
   *      aspect to its KSP signal preset (shugo → phosphor, gunshi →
   *      spectre, kantoku → crimson, sensei → ember). Idle mode feels
   *      like a natural extension of the active Vault persona.
   *
   *  'pickFixed'
   *      Use the aspect stored in `aspectPaletteFixed` regardless of which
   *      aspect is active in the vault.
   *
   *  'inherit' (v1.0 behaviour)
   *      Defer to `colorMode` / `colorPreset` / `colorCustom`. Kept so
   *      users who explicitly liked the old behaviour can opt back in.
   */
  aspectPaletteMode: 'matchAspect' | 'pickFixed' | 'inherit';
  aspectPaletteFixed: 'shugo' | 'gunshi' | 'kantoku' | 'sensei';

  fx: {
    bloom:               { on: boolean; strength: number };
    trails:              { on: boolean; damp: number };
    matrix:              { on: boolean; density: number };
    scan:                { on: boolean; opacity: number };
    glitch:              { on: boolean; freq: number };       // deprecated — superseded by crtSim
    vignette:            { on: boolean; strength: number };
    scanlineDrift:       { on: boolean; speed: number };
    radarPing:           { on: boolean; interval: number };
    burnDecay:           { on: boolean; strength: number };
    chromaticAberration: { on: boolean; offset: number };
    noiseBursts:         { on: boolean; freq: number };
    powerOn:             { on: boolean };
  };

  /**
   * CRT simulation: aggregates all signal-degradation artifacts that a real CRT
   * monitor produces — h-sync tear, v-roll attempts, brightness flicker, black
   * frame drops, rolling brightness bands (VHS-style), chromatic aberration
   * spikes, wave distortion. Single intensity controls both frequency and
   * amplitude. Replaces the old `fx.glitch` toggle.
   */
  crtSim: {
    on: boolean;
    intensity: number;       // 0..1
  };

  fxInheritFromTheme: boolean;

  hudPreset: 'minimal' | 'tactical' | 'full' | 'off' | 'custom';
  hud: {
    left: boolean; right: boolean; radar: boolean; terminal: boolean;
    crosshair: boolean; vaultKanji: boolean; realtime: boolean;
    controlBar: boolean;
  };

  bootEnabled: boolean;
  bootSpeed: 'fast' | 'normal' | 'cinematic';

  loreIntensity: 'none' | 'subtle' | 'full';
  subliminalFlashes: boolean;
  flashFrequencyMean: number;
  easterEggAlerts: boolean;

  sound: {
    master: boolean; volume: number;
    hum: boolean; scanlineWhine: boolean; sceneSwitch: boolean;
    bootSounds: boolean; boost: boolean; radarPing: boolean;
    synthSoundscape: 'off' | 'carpenter' | 'bach';
  };

  autoCycle:   { on: boolean; intervalMin: 2 | 5 | 10 };
  idleLaunch:  { on: boolean; minutes: 5 | 10 | 15 | 30 };
  embed:       { on: boolean; opacity: number; hudHidden: boolean };
  parallax:    boolean;

  liveHotkeysEnabled: boolean;
  escapeOnlyExit: boolean;
  controlBarAutoHideSec: number;   // 0 = never auto-hide; >0 = seconds before hide
  /**
   * Narrative terminal: when ON, the bottom terminal renders an unfolding shift
   * by a CORP operator (typing, hesitations, intrusions, panic, reset) instead
   * of a passive scroll of atmospheric lines. Recommended ON.
   */
  narrativeTerminal: boolean;
  /**
   * Terminal layout mode:
   *   bottom-strip  — original mode: terminal hugs the bottom of the screen.
   *   center-window — Apple-Lisa-inspired CORP OS window centered front + center,
   *                   semi-transparent so the 3D scene shows through.
   */
  terminalLayout: 'bottom-strip' | 'center-window';

  dayNightCycle: { on: boolean; periodMin: number };
  /**
   * Fog / view-distance control (control-bar FOG button):
   *   'auto'  — day/night cycle breathes the fog density (default)
   *   'clear' — fixed low density → maximum view distance, no dark phases
   *   'dense' — fixed high density → moody, short view distance
   */
  fogMode: 'auto' | 'clear' | 'dense';
  weather: 'light-fog' | 'heavy-fog' | 'storm' | 'dust' | 'clear';

  perfAdapt: boolean;

  stats: {
    totalUptimeMs: number;
    scenesLoaded: number;
    perScene: Record<string, number>;
  };
}

export const DEFAULT_SCREENSAVER: ScreensaverSettings = {
  defaultScene: 'city',
  speed: 'norm',
  cityAltitude: 'low',
  tunnelAutoBoost: true,
  seedLock: null,

  colorMode: 'kuro-auto',
  colorPreset: 'toxic-haze',
  colorCustom: '#00ff41',

  aspectPaletteMode: 'matchAspect',
  aspectPaletteFixed: 'shugo',

  fx: {
    bloom:               { on: true,  strength: 1.4 },
    trails:              { on: false, damp: 0.84 },
    matrix:              { on: false, density: 0.5 },
    scan:                { on: true,  opacity: 0.11 },
    glitch:              { on: false, freq: 0.3 },
    vignette:            { on: true,  strength: 0.35 },
    scanlineDrift:       { on: true,  speed: 0.6 },
    radarPing:           { on: true,  interval: 6 },
    burnDecay:           { on: false, strength: 0.4 },
    chromaticAberration: { on: false, offset: 1.5 },
    noiseBursts:         { on: false, freq: 0.5 },
    powerOn:             { on: true },
  },

  crtSim: { on: true, intensity: 0.35 },

  fxInheritFromTheme: true,

  hudPreset: 'tactical',
  hud: {
    left: true, right: true, radar: true, terminal: true,
    crosshair: true, vaultKanji: true, realtime: true,
    controlBar: true,
  },

  bootEnabled: true,
  bootSpeed: 'normal',

  loreIntensity: 'subtle',
  subliminalFlashes: true,
  flashFrequencyMean: 90,
  easterEggAlerts: true,

  sound: {
    master: true, volume: 0.4,
    hum: true, scanlineWhine: false, sceneSwitch: true,
    bootSounds: true, boost: true, radarPing: true,
    synthSoundscape: 'carpenter',
  },

  autoCycle: { on: false, intervalMin: 5 },
  idleLaunch: { on: false, minutes: 10 },
  embed: { on: false, opacity: 0.7, hudHidden: true },
  parallax: true,

  liveHotkeysEnabled: true,
  escapeOnlyExit: false,
  controlBarAutoHideSec: 30,
  narrativeTerminal: true,
  terminalLayout: 'bottom-strip',

  dayNightCycle: { on: true, periodMin: 4 },
  fogMode: 'auto',
  weather: 'light-fog',

  perfAdapt: true,

  stats: { totalUptimeMs: 0, scenesLoaded: 0, perScene: {} },
};

export type SceneId = ScreensaverSettings['defaultScene'];
export const SCENES: SceneId[] = ['terrain', 'city', 'rift', 'tunnel', 'void'];

// Display labels — used by settings dropdown and control bar.
// (Internal id stays short for storage / commands; label is presentation.)
export const SCENE_LABELS: Record<SceneId, string> = {
  terrain: 'TERRAIN',
  city:    'CITY',
  rift:    'THE RIFT',
  tunnel:  'TUNNEL',
  void:    'VOID',
};

export const SPEED_VALUES = { slow: 0.32, norm: 1, fast: 2.8 } as const;
export const ALT_VALUES   = { low: 4, mid: 11, high: 24 } as const;

export const HUD_PRESETS: Record<string, Partial<ScreensaverSettings['hud']>> = {
  minimal:  { left: false, right: false, radar: false, terminal: false, crosshair: true, vaultKanji: false, realtime: true, controlBar: false },
  tactical: { left: true,  right: true,  radar: true,  terminal: true,  crosshair: true, vaultKanji: true,  realtime: true, controlBar: true  },
  full:     { left: true,  right: true,  radar: true,  terminal: true,  crosshair: true, vaultKanji: true,  realtime: true, controlBar: true  },
  off:      { left: false, right: false, radar: false, terminal: false, crosshair: false, vaultKanji: false, realtime: false, controlBar: false },
};
