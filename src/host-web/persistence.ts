// localStorage-backed ScreensaverHost implementation for the web host.
//
// Mirrors the Obsidian plugin's pattern of holding a mutable settings object
// in memory and persisting it on saveSettings(). Stats updates from the
// controller mutate the in-memory object directly (via getSettings()), then
// the controller debounces saveSettings() calls.

import type { ScreensaverHost } from '../engine/host';
import type { ScreensaverSettings } from '../engine/data/defaults';
import { DEFAULT_SCREENSAVER } from '../engine/data/defaults';

const STORAGE_KEY = 'kuro-animation:settings';

function deepMerge<T extends object>(base: T, overrides: any): T {
  if (!overrides || typeof overrides !== 'object') return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(overrides)) {
    const bv = (base as any)[k];
    const ov = overrides[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && ov && typeof ov === 'object' && !Array.isArray(ov)) {
      out[k] = deepMerge(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out as T;
}

function loadFromStorage(): ScreensaverSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SCREENSAVER);
    const parsed = JSON.parse(raw);
    // Merge user overrides over defaults so newly-added settings always get a value.
    return deepMerge(structuredClone(DEFAULT_SCREENSAVER), parsed);
  } catch {
    return structuredClone(DEFAULT_SCREENSAVER);
  }
}

export interface WebHostOptions {
  vaultKanji?: string;        // e.g. '黒' for the HUD
  activePreset?: string;      // for colorMode 'kuro-auto'
  overrides?: Partial<ScreensaverSettings>;  // applied once at startup
}

export class WebHost implements ScreensaverHost {
  private settings: ScreensaverSettings;

  constructor(private options: WebHostOptions = {}) {
    this.settings = loadFromStorage();
    if (options.overrides) {
      this.settings = deepMerge(this.settings, options.overrides);
    }
  }

  getSettings(): ScreensaverSettings {
    return this.settings;
  }

  saveSettings(settings: ScreensaverSettings): void {
    this.settings = settings;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota exceeded or storage disabled — fail silently. Stats are non-critical.
    }
  }

  getActivePreset(): string | undefined {
    return this.options.activePreset;
  }

  getVaultKanji(): string {
    return this.options.vaultKanji ?? '';
  }
}
