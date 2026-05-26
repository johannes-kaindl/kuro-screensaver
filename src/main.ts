// Standalone entry — runs when the user opens index.html in a browser.
//
// Sensible defaults for non-Obsidian context:
//   - colorMode 'kuro-preset' (no CSS vars to read from)
//   - default preset 'toxic-haze' (the original DEFAULT_SCREENSAVER value)
//   - vault kanji '黒' (Kuro)

import { mountScreensaver } from './host-web/mount';

mountScreensaver({
  vaultKanji: '黒',
  activePreset: 'toxic-haze',
  overrides: {
    colorMode: 'kuro-preset',
    colorPreset: 'toxic-haze',
  },
});
