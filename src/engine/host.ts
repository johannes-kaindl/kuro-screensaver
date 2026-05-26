// Host interface — the single boundary between the Screensaver engine and
// its embedding context (Obsidian plugin, web app, electron, ...).
//
// Hosts implement this interface to provide persistence and (optionally) hooks
// into the wider environment (active theme preset, vault kanji).
//
// The engine never imports anything host-specific.

import type { ScreensaverSettings } from './data/defaults';

export interface ScreensaverHost {
  /** Read current settings (called frequently — must be cheap). */
  getSettings(): ScreensaverSettings;

  /** Persist current settings (called debounced, e.g. after stats updates). */
  saveSettings(settings: ScreensaverSettings): void | Promise<void>;

  /** Active Kuro theme preset key, used by colorMode === 'kuro-auto'. */
  getActivePreset?(): string | undefined;

  /** Vault kanji glyph for the HUD (e.g. '黒'). Empty string disables it. */
  getVaultKanji?(): string;
}
