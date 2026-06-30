// Query-param → settings bridge for the native OS-screensaver hosts.
//
// A real screensaver exits on any input, so the web control bar / hotkeys are
// unreachable there. The native hosts (Windows .scr config dialog, persisted to
// HKCU; macOS) instead pass the user's persistent choices in as URL query params.
// This pure seam maps those params onto the already-merged settings tree and is
// pinned by tests/screensaver-params.test.ts.
//
// Scene / colour preset / audio are applied at host-construction time in main.ts
// (they go through `overrides` / `sound.master`); everything here is a
// post-construction toggle on the nested settings objects.

import type { ScreensaverSettings } from '../engine/data/defaults';

const SPEEDS: readonly string[] = ['slow', 'norm', 'fast'];

/** 'on'/'1' → true, 'off'/'0' → false, absent or unrecognised → undefined (leave default). */
function readBool(params: URLSearchParams, key: string): boolean | undefined {
  const v = params.get(key);
  if (v === 'on' || v === '1') return true;
  if (v === 'off' || v === '0') return false;
  return undefined;
}

/** Mutates `settings` in place, applying any recognised query params. */
export function applyParamOverrides(settings: ScreensaverSettings, params: URLSearchParams): void {
  const speed = params.get('speed');
  if (speed && SPEEDS.includes(speed)) {
    settings.speed = speed as ScreensaverSettings['speed'];
  }

  const bloom = readBool(params, 'bloom');
  if (bloom !== undefined) settings.fx.bloom.on = bloom;

  const trails = readBool(params, 'trails');
  if (trails !== undefined) settings.fx.trails.on = trails;

  const scan = readBool(params, 'scan');
  if (scan !== undefined) settings.fx.scan.on = scan;

  const matrix = readBool(params, 'matrix');
  if (matrix !== undefined) settings.fx.matrix.on = matrix;

  const crt = readBool(params, 'crt');
  if (crt !== undefined) settings.crtSim.on = crt;

  let hudOverridden = false;

  const terminal = readBool(params, 'terminal');
  if (terminal !== undefined) { settings.hud.terminal = terminal; hudOverridden = true; }

  const radar = readBool(params, 'radar');
  if (radar !== undefined) { settings.hud.radar = radar; hudOverridden = true; }

  const crosshair = readBool(params, 'crosshair');
  if (crosshair !== undefined) { settings.hud.crosshair = crosshair; hudOverridden = true; }

  // controller.open() re-applies the named HUD preset over hud.* unless the preset
  // is 'custom' (applyHudPreset, controller.ts:90-95). The default 'tactical' preset
  // would clobber the flags we just set, so switch to 'custom' to make them stick.
  // 'tactical' is identical to the default hud, so non-overridden fields are unchanged.
  if (hudOverridden) settings.hudPreset = 'custom';
}
