// Web-Host bootstrap — instantiates the controller against a WebHost
// and starts the screensaver on user click (browsers require a user gesture
// for fullscreen + AudioContext).

import './obsidian-dom-polyfill';
import { ScreensaverController } from '../engine/controller';
import { WebHost, type WebHostOptions } from './persistence';
import { makePluginShim } from './plugin-shim';

export interface MountOptions extends WebHostOptions {
  /** Element whose click triggers start. Default: document.getElementById('start-btn'). */
  startTrigger?: HTMLElement | null;
  /** Hide this element once the screensaver opens (the boot hint). */
  hideOnStart?: HTMLElement | null;
}

export function mountScreensaver(opts: MountOptions = {}): ScreensaverController {
  const host = new WebHost({
    vaultKanji: opts.vaultKanji,
    activePreset: opts.activePreset,
    overrides: opts.overrides,
  });

  const controller = new ScreensaverController(makePluginShim(host));

  const trigger = opts.startTrigger ?? document.getElementById('start-btn');
  const hideEl = opts.hideOnStart ?? document.getElementById('boot-hint');

  if (trigger) {
    trigger.addEventListener('click', () => {
      if (hideEl) hideEl.style.display = 'none';
      void controller.open();
    });
  }

  // When the controller's close() runs (via ESC), show the boot hint again
  // so the user can re-launch without reloading.
  const origClose = controller.close.bind(controller);
  controller.close = async () => {
    await origClose();
    if (hideEl) hideEl.style.display = '';
  };

  return controller;
}
