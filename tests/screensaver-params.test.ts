import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('pins the engine seed via seed=<int> and ignores malformed values', () => {
    expect(apply('seed=7').seedLock).toBe(7);
    expect(apply('seed=0').seedLock).toBe(0);
    expect(apply('seed=abc').seedLock).toBe(DEFAULT_SCREENSAVER.seedLock);
    expect(apply('seed=1.5').seedLock).toBe(DEFAULT_SCREENSAVER.seedLock);
    expect(apply('').seedLock).toBeNull();
  });

  it('selects a named HUD preset via hud=<name> and ignores unknown names', () => {
    expect(apply('hud=off').hudPreset).toBe('off');
    expect(apply('hud=minimal').hudPreset).toBe('minimal');
    expect(apply('hud=bogus').hudPreset).toBe(DEFAULT_SCREENSAVER.hudPreset);
    // a named preset wins over the single toggles: controller.open() re-applies it
    expect(apply('hud=off&terminal=on').hudPreset).toBe('off');
  });

  it('switches the radar ping off via ping=off (a render for a composition must not show it)', () => {
    expect(apply('ping=off').fx.radarPing.on).toBe(false);
    expect(apply('ping=on').fx.radarPing.on).toBe(true);
    expect(apply('').fx.radarPing.on).toBe(DEFAULT_SCREENSAVER.fx.radarPing.on);
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

// v0.10 — the Windows host bridges the FULL settings dialog through the query
// string (keys 13–33 of the pinned contract in the v0.10 implementation plan).
describe('applyParamOverrides — v0.10 keys', () => {
  it('maps enums with whitelist validation', () => {
    expect(apply('altitude=high').cityAltitude).toBe('high');
    expect(apply('altitude=orbit').cityAltitude).toBe(DEFAULT_SCREENSAVER.cityAltitude);
    expect(apply('fog=dense').fogMode).toBe('dense');
    expect(apply('weather=storm').weather).toBe('storm');
    expect(apply('weather=sharknado').weather).toBe(DEFAULT_SCREENSAVER.weather);
    expect(apply('bootspeed=cinematic').bootSpeed).toBe('cinematic');
    expect(apply('termlayout=window').terminalLayout).toBe('center-window');
    expect(apply('termlayout=strip').terminalLayout).toBe('bottom-strip');
  });
  it('maps bools', () => {
    expect(apply('reactive=off').narrativeReactiveWorld).toBe(false);
    expect(apply('autocycle=off').autoCycle.on).toBe(false);
    expect(apply('boot=off').bootEnabled).toBe(false);
    expect(apply('daynight=off').dayNightCycle.on).toBe(false);
    // NOTE: only the param MAPPING is pinned here. The plain-browser default
    // (absent ?perfadapt → perfAdapt=false, e9e2719 regression guard) is entry
    // logic in src/screensaver/main.ts, deliberately outside this pure seam.
    expect(apply('perfadapt=off').perfAdapt).toBe(false);
  });
  it('maps clamped numerics from raw strings', () => {
    expect(apply('bank=2').bankStrength).toBe(2);
    expect(apply('bank=9').bankStrength).toBe(2);          // clamp
    expect(apply('cyclemin=0.5').autoCycle.intervalMin).toBe(0.5);
    expect(apply('crtintensity=0.85').crtSim.intensity).toBe(0.85);
    expect(apply('curvature=0.022').fx.curvature).toEqual({ on: true, amount: 0.022 });
    expect(apply('curvature=0').fx.curvature.on).toBe(false);
    expect(apply('aperture=0.45').fx.aperture).toEqual({ on: true, strength: 0.45 });
    expect(apply('trailsamount=0.9').fx.trails.damp).toBe(0.9);
    expect(apply('ntsc=0.6').fx.ntsc).toEqual({ on: true, amount: 0.6 });
    expect(apply('halation=0.4').fx.halation).toEqual({ on: true, amount: 0.4 });
    expect(apply('scale=0.66').renderScale).toBe(0.66);
    expect(apply('scale=0.1').renderScale).toBe(0.25);     // clamp low
    expect(apply('bank=abc').bankStrength).toBe(DEFAULT_SCREENSAVER.bankStrength);
  });
  it('bloomstrength disables theme inheritance so the value sticks', () => {
    const s = apply('bloomstrength=1.6');
    expect(s.fx.bloom.strength).toBe(1.6);
    expect(s.fxInheritFromTheme).toBe(false);
  });
  it('ignores look (dialog-only key)', () => {
    expect(apply('look=heavy')).toEqual(DEFAULT_SCREENSAVER);
  });
});

describe('applyParamOverrides — kiosk mode', () => {
  it('kiosk=on hides the control bar and survives applyHudPreset', () => {
    const s = apply('kiosk=on');
    expect(s.kioskMode).toBe(true);
    expect(s.hud.controlBar).toBe(false);
    expect(s.hudPreset).toBe('custom');
    applyHudPreset(s);
    expect(s.hud.controlBar).toBe(false);
  });
  it('defaults stay without the param', () => {
    expect(apply('').kioskMode).toBe(false);
    expect(apply('').hud.controlBar).toBe(true);
  });
});

// The one contract line all three hosts read: native/shared/query-contract.txt.
// The native tests check the WRITE direction (default options must produce exactly
// this query); this checks the READ direction (this query must produce exactly the
// default settings). Both together are what makes the line a contract rather than
// two independent opinions that happen to agree today.
describe('gemeinsames Query-Fixture (native/shared/query-contract.txt)', () => {
  function contractLine(): string {
    const raw = readFileSync('native/shared/query-contract.txt', 'utf8');
    const line = raw.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    if (!line) throw new Error('query-contract.txt enthält keine Vertragszeile');
    return line.trim();
  }

  it('ist vorhanden und beginnt mit ?', () => {
    expect(contractLine().startsWith('?')).toBe(true);
  });

  // Defaults in, defaults out — with two documented exceptions, both mechanism:
  //  - hudPreset 'tactical' → 'custom'. The contract line always carries the HUD keys,
  //    so `hudOverridden` fires (params.ts:154-157). That flip is what stops
  //    controller.open()'s applyHudPreset from clobbering query-set HUD flags, and
  //    since 'tactical' IS the default hud it changes the marker, never the look.
  //  - fxInheritFromTheme true → false, same reason one level down (params.ts:141):
  //    explicit FX values must not be overwritten by the theme.
  //
  // There used to be a third entry here — a real divergence, autoCycle, which defaulted
  // to off on the web and on in the native hosts. This fixture is what surfaced it, and
  // it was resolved on 2026-08-30 by pulling the native hosts to the web default. Every
  // other field, autoCycle included, must now match exactly.
  it('ergibt die Default-Settings — bis auf die zwei Mechanik-Marker', () => {
    const settings = structuredClone(DEFAULT_SCREENSAVER);
    applyParamOverrides(settings, new URLSearchParams(contractLine().slice(1)));

    // The HUD tree itself must be untouched — only the marker moves.
    expect(settings.hud).toEqual(DEFAULT_SCREENSAVER.hud);
    expect(settings.hudPreset).toBe('custom');
    expect(settings.fxInheritFromTheme).toBe(false);
    // The former divergence, now pinned as parity rather than as an exception.
    expect(settings.autoCycle).toEqual(DEFAULT_SCREENSAVER.autoCycle);

    const strip = (x: ScreensaverSettings) => {
      const { hudPreset: _a, fxInheritFromTheme: _b, ...rest } = x;
      return rest;
    };
    expect(strip(settings)).toEqual(strip(DEFAULT_SCREENSAVER));
  });

  // Guards the sentence above: 'tactical' really is the default hud. If someone
  // ever changes the tactical preset, the test above would keep passing while the
  // native hosts silently started rendering a different HUD than the web default.
  it('der tactical-Preset ist identisch mit dem Default-HUD', () => {
    expect(HUD_PRESETS.tactical).toEqual(DEFAULT_SCREENSAVER.hud);
  });
});
