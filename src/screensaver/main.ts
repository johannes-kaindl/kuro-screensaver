// Screensaver-mode entry — auto-starts the engine with no user gesture.
//
// Used by the native OS-screensaver wrappers (macOS .saver / Windows .scr),
// which load this page in an embedded WebView and inject options as URL
// query params:
//   ?scene=random|terrain|city|rift|tunnel|void   (default: random)
//   ?audio=on|off                                  (default: off)
//
// Unlike the demo landing page (src/main.ts), there is no Start button —
// the controller opens immediately. In a real screensaver the OS exits on
// any input, so live hotkeys are disabled. Audio defaults off because an
// AudioContext cannot start without a user gesture in a screensaver.

import '../host-web/obsidian-dom-polyfill';
import { ScreensaverController } from '../engine/controller';
import { WebHost } from '../host-web/persistence';
import { makePluginShim } from '../host-web/plugin-shim';
import { SCENES, type SceneId } from '../engine/data/defaults';

const params = new URLSearchParams(location.search);

const sceneParam = params.get('scene') ?? 'random';
const scene: SceneId =
  sceneParam !== 'random' && SCENES.includes(sceneParam as SceneId)
    ? (sceneParam as SceneId)
    : SCENES[Math.floor(Math.random() * SCENES.length)];

const audioOn = params.get('audio') === 'on';

const host = new WebHost({
  activePreset: 'toxic-haze',
  vaultKanji: '黒',
  overrides: {
    colorMode: 'kuro-preset',
    colorPreset: 'toxic-haze',
    defaultScene: scene,
    liveHotkeysEnabled: false,
  },
});

// `overrides` is Partial<ScreensaverSettings> — nested objects can't be set
// partially through it without a type error, so toggle audio directly on the
// merged settings (deepMerge has already run in the WebHost constructor).
host.getSettings().sound.master = audioOn;

const controller = new ScreensaverController(makePluginShim(host));
void controller.open({ scene });
