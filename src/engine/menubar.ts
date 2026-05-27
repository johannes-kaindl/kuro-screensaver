// Shared menubar render (v1.1 — Live-Test 2026-05-11).
//
// Replaces the v1.0 gap where the embed pane had no controls at all. The
// fullscreen overlay has its own much richer control bar in controller.ts;
// this helper renders a minimum-viable menubar (scene-switcher · speed ·
// close) that is also small enough to sit cleanly in an Obsidian pane.
//
// Kept on its own so the embed view can reuse it without dragging in the
// fullscreen controller's lifecycle. The fullscreen path will move onto
// the same helper in a later phase; for v1.1 the goal is parity-not-
// identity between fullscreen and embed.
//
// Standalone-Status (post 2026-05-27 rollback): the standalone Web-Host
// only ever opens fullscreen, so this file is dead code in the browser
// build. Kept here because the plugin's embed-view.ts (excluded from
// sync) imports it.

import type { Engine } from './engine/core';
import type { ScreensaverSettings, SceneId } from './data/defaults';
import { SCENES, SCENE_LABELS } from './data/defaults';

export interface MenubarOpts {
  engine: Engine;
  /** Pane settings — the screensaver subtree of plugin.settings. */
  settings: ScreensaverSettings;
  /** Persist settings change. Called debounced from the menubar. */
  save: () => void;
  /** Switch to a new scene. */
  switchScene: (id: SceneId) => void;
  /** Close the screensaver / detach the pane. */
  close: () => void;
}

const MENUBAR_CSS_INJECTED_FLAG = 'kuro-menubar-css-injected';

function ensureMenubarCss() {
  if (document.getElementById(MENUBAR_CSS_INJECTED_FLAG)) return;
  const tag = document.createElement('style');
  tag.id = MENUBAR_CSS_INJECTED_FLAG;
  tag.textContent = `
    .kuro-menubar {
      position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      font-family: "Share Tech Mono", ui-monospace, monospace;
      font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase;
      color: rgba(255, 255, 255, 0.85);
      z-index: 9;
      backdrop-filter: blur(3px);
      opacity: 0; transition: opacity 160ms ease;
      pointer-events: none;
    }
    .kuro-menubar.is-visible { opacity: 1; pointer-events: auto; }
    .kuro-menubar .kuro-mb-lbl { color: rgba(255, 255, 255, 0.45); padding: 0 4px; }
    .kuro-menubar .kuro-mb-sep { width: 1px; height: 14px; background: rgba(255, 255, 255, 0.18); margin: 0 4px; }
    .kuro-menubar button.kuro-mb-btn {
      background: transparent;
      border: 1px solid transparent;
      color: rgba(255, 255, 255, 0.7);
      padding: 2px 8px; cursor: pointer;
      font: inherit; letter-spacing: inherit; text-transform: inherit;
      border-radius: 3px;
    }
    .kuro-menubar button.kuro-mb-btn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.30); }
    .kuro-menubar button.kuro-mb-btn.is-active { color: #fff; border-color: rgba(255, 255, 255, 0.55); background: rgba(255, 255, 255, 0.08); }
    .kuro-menubar button.kuro-mb-close { color: rgba(255, 200, 200, 0.8); }
    .kuro-menubar button.kuro-mb-close:hover { color: #fff; background: rgba(255, 80, 80, 0.4); border-color: rgba(255, 120, 120, 0.6); }
  `;
  document.head.appendChild(tag);
}

/**
 * Mount a menubar onto a host element. Host must be positioned (relative /
 * absolute / fixed) for the bar's absolute positioning to land correctly.
 * Returns a small handle so the caller can show/hide/refresh on demand.
 */
export function renderMenubar(host: HTMLElement, opts: MenubarOpts) {
  ensureMenubarCss();

  const bar = host.createDiv({ cls: 'kuro-menubar' });
  bar.addEventListener('mouseenter', () => bar.classList.add('is-visible'));
  bar.addEventListener('mouseleave', () => bar.classList.remove('is-visible'));
  // Click outside the bar inside the host area: nothing. Click outside the
  // host is the caller's responsibility.

  const render = () => {
    bar.empty();

    const lbl = (text: string) => {
      const s = bar.createSpan({ cls: 'kuro-mb-lbl', text });
      return s;
    };
    const sep = () => bar.createDiv({ cls: 'kuro-mb-sep' });
    const btn = (text: string, active: boolean, fn: () => void, extraCls = '') => {
      const b = bar.createEl('button', { cls: 'kuro-mb-btn ' + (active ? 'is-active ' : '') + extraCls, text });
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); render(); });
      return b;
    };

    // SCENE
    lbl('SCENE');
    SCENES.forEach(sc => btn(SCENE_LABELS[sc], opts.engine.currentScene === sc, () => opts.switchScene(sc)));

    // SPD
    sep(); lbl('SPD');
    (['slow', 'norm', 'fast'] as const).forEach(sp => btn(
      sp === 'slow' ? '▶' : sp === 'norm' ? '▶▶' : '▶▶▶',
      opts.settings.speed === sp,
      () => {
        opts.settings.speed = sp;
        opts.engine.setSpeed(sp);
        opts.save();
      },
    ));

    // CLOSE
    sep();
    btn('×', false, () => opts.close(), 'kuro-mb-close');
  };

  render();

  // Show/hide tied to mouse activity on the host. Always show on first mount
  // for a couple seconds so the user sees the bar exists.
  bar.classList.add('is-visible');
  let hideTimer = window.setTimeout(() => bar.classList.remove('is-visible'), 2500);
  host.addEventListener('mousemove', () => {
    bar.classList.add('is-visible');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bar.classList.remove('is-visible'), 2500);
  });

  return {
    refresh: render,
    destroy: () => { clearTimeout(hideTimer); bar.remove(); },
  };
}
