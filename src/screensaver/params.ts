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

/** Raw numeric string (host passes values through unreformatted), validated +
 *  clamped to [lo, hi]; absent or malformed → undefined (leave default). */
function readNum(params: URLSearchParams, key: string, lo: number, hi: number): number | undefined {
  const raw = params.get(key);
  if (raw === null || !/^[0-9]+(\.[0-9]+)?$/.test(raw)) return undefined;
  const v = parseFloat(raw);
  return Math.min(hi, Math.max(lo, v));
}

/** Whitelist-validated enum; absent or unknown value → undefined (leave default). */
function readEnum<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = params.get(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
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

  // seed=<int>: pin the engine seed (settings.seedLock) so a render is reproducible
  // (scripts/render-sequence.mjs). Integers only; `readNum` would accept 1.5, and a
  // fractional seed would be lied about by the manifest that records it.
  const seedRaw = params.get('seed');
  if (seedRaw !== null && /^[0-9]{1,10}$/.test(seedRaw)) settings.seedLock = parseInt(seedRaw, 10);

  let hudOverridden = false;

  const terminal = readBool(params, 'terminal');
  if (terminal !== undefined) { settings.hud.terminal = terminal; hudOverridden = true; }

  const radar = readBool(params, 'radar');
  if (radar !== undefined) { settings.hud.radar = radar; hudOverridden = true; }

  const crosshair = readBool(params, 'crosshair');
  if (crosshair !== undefined) { settings.hud.crosshair = crosshair; hudOverridden = true; }

  // ── v0.10 keys (13–33 of the pinned host contract) ─────────────────────────
  // `look` is deliberately NOT read here: it is a dialog-only convenience key —
  // the settings dialog expands a Look into the individual CRT knobs before save,
  // so the query already carries the resolved values.

  const altitude = readEnum(params, 'altitude', ['low', 'mid', 'high'] as const);
  if (altitude !== undefined) settings.cityAltitude = altitude;

  const fog = readEnum(params, 'fog', ['auto', 'clear', 'dense'] as const);
  if (fog !== undefined) settings.fogMode = fog;

  const weather = readEnum(params, 'weather', ['light-fog', 'heavy-fog', 'storm', 'dust', 'clear'] as const);
  if (weather !== undefined) settings.weather = weather;

  const bootspeed = readEnum(params, 'bootspeed', ['fast', 'normal', 'cinematic'] as const);
  if (bootspeed !== undefined) settings.bootSpeed = bootspeed;

  const termlayout = readEnum(params, 'termlayout', ['strip', 'window'] as const);
  if (termlayout !== undefined) settings.terminalLayout = termlayout === 'window' ? 'center-window' : 'bottom-strip';

  const reactive = readBool(params, 'reactive');
  if (reactive !== undefined) settings.narrativeReactiveWorld = reactive;

  const autocycle = readBool(params, 'autocycle');
  if (autocycle !== undefined) settings.autoCycle.on = autocycle;

  const boot = readBool(params, 'boot');
  if (boot !== undefined) settings.bootEnabled = boot;

  const daynight = readBool(params, 'daynight');
  if (daynight !== undefined) settings.dayNightCycle.on = daynight;

  const perfadapt = readBool(params, 'perfadapt');
  if (perfadapt !== undefined) settings.perfAdapt = perfadapt;

  const bank = readNum(params, 'bank', 0, 2);
  if (bank !== undefined) settings.bankStrength = bank;

  const cyclemin = readNum(params, 'cyclemin', 0.5, 10);
  if (cyclemin !== undefined) settings.autoCycle.intervalMin = cyclemin;

  const crtintensity = readNum(params, 'crtintensity', 0, 1);
  if (crtintensity !== undefined) settings.crtSim.intensity = crtintensity;

  // Slider-driven FX pairs: the value doubles as the on-switch (≈0 → off).
  const curvature = readNum(params, 'curvature', 0, 0.25);
  if (curvature !== undefined) settings.fx.curvature = { on: curvature > 0.001, amount: curvature };

  const aperture = readNum(params, 'aperture', 0, 0.5);
  if (aperture !== undefined) settings.fx.aperture = { on: aperture > 0.001, strength: aperture };

  const trailsamount = readNum(params, 'trailsamount', 0.5, 0.95);
  if (trailsamount !== undefined) settings.fx.trails.damp = trailsamount;

  const ntsc = readNum(params, 'ntsc', 0, 1);
  if (ntsc !== undefined) settings.fx.ntsc = { on: ntsc > 0.001, amount: ntsc };

  const halation = readNum(params, 'halation', 0, 0.6);
  if (halation !== undefined) settings.fx.halation = { on: halation > 0.001, amount: halation };

  const scale = readNum(params, 'scale', 0.25, 1);
  if (scale !== undefined) settings.renderScale = scale;

  // Bloom strength: theme inheritance (effectiveSettings) would overwrite the
  // strength from the page theme — disable it so the explicit value sticks.
  const bloomstrength = readNum(params, 'bloomstrength', 0, 3);
  if (bloomstrength !== undefined) {
    settings.fx.bloom.strength = bloomstrength;
    settings.fxInheritFromTheme = false;
  }

  // Kiosk: UI-less operation in the native saver host — no control bar (the host
  // exits on input, the bar is unreachable and would burn in), cursor stays hidden.
  const kiosk = readBool(params, 'kiosk');
  if (kiosk) {
    settings.kioskMode = true;
    settings.hud.controlBar = false;
    hudOverridden = true;
  }

  // controller.open() re-applies the named HUD preset over hud.* unless the preset
  // is 'custom' (applyHudPreset, controller.ts:90-95). The default 'tactical' preset
  // would clobber the flags we just set, so switch to 'custom' to make them stick.
  // 'tactical' is identical to the default hud, so non-overridden fields are unchanged.
  if (hudOverridden) settings.hudPreset = 'custom';
}
