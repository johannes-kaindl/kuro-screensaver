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
    // The standalone app runs on capable hardware and the user explicitly
    // toggles effects — don't let perfAdapt silently kill them (it was
    // disabling AFTER:BURN/TRAIL a few seconds after the user enabled it).
    perfAdapt: false,
  },
});

// `overrides` is Partial<ScreensaverSettings> — nested objects can't be set
// partially through it without a type error, so toggle audio directly on the
// merged settings (deepMerge has already run in the WebHost constructor).
host.getSettings().sound.master = audioOn;

const controller = new ScreensaverController(makePluginShim(host));

// In a native host (macOS .app / Windows .scr), the engine's close button (×)
// must quit the whole app. Otherwise close() only tears down the overlay and
// leaves a black window with no way out. Bridge close() to the native host;
// in a plain browser both message channels are absent, so this is a no-op.
const origClose = controller.close.bind(controller);
controller.close = async () => {
  const w = window as any;
  w.webkit?.messageHandlers?.kuroExit?.postMessage?.('exit'); // macOS WKWebView
  w.chrome?.webview?.postMessage?.('exit');                   // Windows WebView2
  await origClose();
};

void controller.open({ scene });

// DEV-only: expose the controller so the crash-preview render script can
// trigger playCrash() directly instead of waiting for a full ~8-min shift.
// Stripped from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { __kuro?: unknown }).__kuro = controller;
}
