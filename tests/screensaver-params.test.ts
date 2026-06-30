import { describe, it, expect } from 'vitest';
import { applyParamOverrides } from '../src/screensaver/params';
import { DEFAULT_SCREENSAVER, HUD_PRESETS, type ScreensaverSettings } from '../src/engine/data/defaults';

// The native OS-screensaver hosts (Windows .scr / macOS) cannot show the web
// control bar — any input exits the saver — so persistent settings are bridged
// in as URL query params instead. `applyParamOverrides` is the pure seam that
// maps those params onto the merged settings tree. These tests pin that mapping.

function fresh(): ScreensaverSettings {
  return structuredClone(DEFAULT_SCREENSAVER);
}
function apply(query: string): ScreensaverSettings {
  const s = fresh();
  applyParamOverrides(s, new URLSearchParams(query));
  return s;
}

describe('applyParamOverrides', () => {
  it('leaves every setting at its default when no params are present', () => {
    expect(apply('')).toEqual(DEFAULT_SCREENSAVER);
  });

  it('sets a valid speed enum and ignores an invalid one', () => {
    expect(apply('speed=fast').speed).toBe('fast');
    expect(apply('speed=slow').speed).toBe('slow');
    expect(apply('speed=ludicrous').speed).toBe(DEFAULT_SCREENSAVER.speed); // unchanged
  });

  it('toggles fx.bloom via on/off', () => {
    expect(apply('bloom=off').fx.bloom.on).toBe(false);
    expect(apply('bloom=on').fx.bloom.on).toBe(true);
  });

  it('toggles fx.trails and fx.scan', () => {
    expect(apply('trails=on').fx.trails.on).toBe(true);
    expect(apply('scan=off').fx.scan.on).toBe(false);
  });

  it('toggles the crtSim aggregate via crt=', () => {
    expect(apply('crt=off').crtSim.on).toBe(false);
    expect(apply('crt=on').crtSim.on).toBe(true);
  });

  it('toggles fx.matrix via matrix= (accepts on and 1)', () => {
    expect(apply('matrix=on').fx.matrix.on).toBe(true);
    expect(apply('matrix=1').fx.matrix.on).toBe(true);
    expect(apply('matrix=off').fx.matrix.on).toBe(false);
  });

  it('toggles hud.terminal, hud.radar and hud.crosshair', () => {
    expect(apply('terminal=off').hud.terminal).toBe(false);
    expect(apply('radar=off').hud.radar).toBe(false);
    expect(apply('crosshair=off').hud.crosshair).toBe(false);
  });

  it('accepts 1/0 as boolean aliases and leaves unknown values unchanged', () => {
    expect(apply('bloom=0').fx.bloom.on).toBe(false);
    expect(apply('bloom=1').fx.bloom.on).toBe(true);
    expect(apply('bloom=maybe').fx.bloom.on).toBe(DEFAULT_SCREENSAVER.fx.bloom.on); // unchanged
  });

  it('applies several params together without touching unrelated settings', () => {
    const s = apply('speed=fast&bloom=off&crt=off&radar=off&matrix=on');
    expect(s.speed).toBe('fast');
    expect(s.fx.bloom.on).toBe(false);
    expect(s.crtSim.on).toBe(false);
    expect(s.hud.radar).toBe(false);
    expect(s.fx.matrix.on).toBe(true);
    // untouched
    expect(s.fx.trails.on).toBe(DEFAULT_SCREENSAVER.fx.trails.on);
    expect(s.hud.terminal).toBe(DEFAULT_SCREENSAVER.hud.terminal);
    expect(s.defaultScene).toBe(DEFAULT_SCREENSAVER.defaultScene);
  });
});

// Mirror of ScreensaverController.applyHudPreset (controller.ts:90-95). The engine
// re-applies the named HUD preset over s.hud at open() time unless hudPreset is
// 'custom'. With the default 'tactical' preset this used to clobber the
// ?terminal/?radar/?crosshair params right back on. We can't import the controller
// in a node test (it pulls THREE/DOM), so we mirror its trivial logic against the
// REAL exported HUD_PRESETS — the inline-oracle pattern used elsewhere in this repo.
function applyHudPreset(s: ScreensaverSettings): ScreensaverSettings {
  if (s.hudPreset === 'custom') return s;
  const p = HUD_PRESETS[s.hudPreset];
  if (p) Object.assign(s.hud, p);
  return s;
}

describe('applyParamOverrides — HUD params survive the engine preset', () => {
  it('switches hudPreset to "custom" when any HUD flag is overridden', () => {
    expect(apply('terminal=off').hudPreset).toBe('custom');
    expect(apply('radar=off').hudPreset).toBe('custom');
    expect(apply('crosshair=off').hudPreset).toBe('custom');
  });

  it('leaves hudPreset untouched when no HUD flag is present', () => {
    expect(apply('bloom=off&speed=fast').hudPreset).toBe(DEFAULT_SCREENSAVER.hudPreset);
    expect(apply('').hudPreset).toBe(DEFAULT_SCREENSAVER.hudPreset);
  });

  it('keeps ?terminal=off/?radar=off/?crosshair=off after applyHudPreset runs (regression)', () => {
    const s = apply('terminal=off&radar=off&crosshair=off');
    applyHudPreset(s); // the engine step that previously overwrote these
    expect(s.hud.terminal).toBe(false);
    expect(s.hud.radar).toBe(false);
    expect(s.hud.crosshair).toBe(false);
    expect(s.hud.vaultKanji).toBe(true); // non-overridden field stays at the tactical/default value
  });
});
