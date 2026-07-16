import { describe, expect, it } from 'vitest';
import {
  FORM_DEFAULTS,
  WALLPAPER_FORM_DEFAULTS,
  buildSaveMessage,
  initialMonitorStates,
  readAutostart,
  readInitial,
  readMonitors,
  readTab,
  readWallpaperInitial,
  readWallpaperRunning,
  type MonitorEntry,
} from '../src/settings/form-state';

// v0.10 fixtures — pinned on both sides (options_test.cpp mirrors them byte-identically).
const DEFAULT_QUERY =
  'scene=random&preset=toxic-haze&speed=norm&audio=off&bloom=on&trails=off' +
  '&scan=on&crt=on&matrix=off&terminal=on&radar=on&crosshair=on' +
  '&look=&altitude=low&fog=auto&weather=light-fog&bank=1&reactive=on' +
  '&autocycle=on&cyclemin=5&termlayout=strip&boot=on&bootspeed=normal' +
  '&daynight=on&crtintensity=0.35&curvature=0.012&aperture=0.22' +
  '&bloomstrength=1.4&trailsamount=0.84&ntsc=0&halation=0.15&scale=1&perfadapt=on';

const FLIP_QUERY =
  'scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on' +
  '&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off' +
  '&look=heavy&altitude=high&fog=dense&weather=storm&bank=2&reactive=off' +
  '&autocycle=off&cyclemin=0.5&termlayout=window&boot=off&bootspeed=cinematic' +
  '&daynight=off&crtintensity=0.85&curvature=0.022&aperture=0.45' +
  '&bloomstrength=1.6&trailsamount=0.9&ntsc=0.6&halation=0.4&scale=0.66&perfadapt=off';

describe('settings form state (native /c dialog bridge)', () => {
  it('serialises the defaults in the pinned key order', () => {
    // Byte-identical to the host's default BuildQueryString() output,
    // with the "save:" prefix instead of "?".
    expect(buildSaveMessage(FORM_DEFAULTS)).toBe('save:' + DEFAULT_QUERY);
  });

  it('reads host query params over the defaults', () => {
    const s = readInitial(new URLSearchParams('?scene=city&preset=kuro&audio=on&bloom=off&curvature=0.05&look=vapor'));
    expect(s.scene).toBe('city');
    expect(s.preset).toBe('kuro');
    expect(s.audio).toBe(true);
    expect(s.bloom).toBe(false);
    expect(s.curvature).toBe('0.05'); // numerics stay raw strings
    expect(s.look).toBe('vapor');
    expect(s.terminal).toBe(true); // untouched default
    expect(s.trailsamount).toBe('0.84'); // untouched default
  });

  it('round-trips: what readInitial parses, buildSaveMessage re-serialises', () => {
    expect(buildSaveMessage(readInitial(new URLSearchParams('?' + FLIP_QUERY)))).toBe('save:' + FLIP_QUERY);
  });

  it('readInitial rejects garbage / out-of-range numerics back to the defaults', () => {
    // Registry values arrive unvalidated (LoadOptions never checks them) —
    // accepting them verbatim would make the host reject every save.
    const s = readInitial(new URLSearchParams('?bank=1,5&crtintensity=9&scale=abc'));
    expect(s.bank).toBe(FORM_DEFAULTS.bank);
    expect(s.crtintensity).toBe(FORM_DEFAULTS.crtintensity);
    expect(s.scale).toBe(FORM_DEFAULTS.scale);
  });

  it('readInitial keeps valid raw numeric strings byte-identical, incl. range bounds', () => {
    const s = readInitial(new URLSearchParams('?cyclemin=0.5&bank=2&scale=0.66'));
    expect(s.cyclemin).toBe('0.5');
    expect(s.bank).toBe('2');
    expect(s.scale).toBe('0.66');
  });

  it('appends monitor entries in index order', () => {
    const mons = [
      { id: 'DELL_ABC1', mode: 'scene', scene: 'matrix', preset: 'phosphor' },
      { id: 'LAPTOP_0', mode: 'off', scene: '', preset: '' },
    ];
    expect(buildSaveMessage(FORM_DEFAULTS, mons)).toContain(
      '&m0id=DELL_ABC1&m0mode=scene&m0scene=matrix&m0preset=phosphor&m1id=LAPTOP_0&m1mode=off&m1scene=&m1preset=',
    );
  });

  it('caps the serialised monitors at 8 (ParseSaveMessage accepts m0..m7 only)', () => {
    const mons = Array.from({ length: 9 }, (_, i) => ({
      id: `MON_${i}`, mode: 'on', scene: '', preset: '',
    }));
    const msg = buildSaveMessage(FORM_DEFAULTS, mons);
    expect(msg).toContain('&m7id=MON_7');
    expect(msg).not.toContain('m8id');
  });

  it('appends monitormode after perfadapt and before the monitor keys, only when non-empty', () => {
    expect(buildSaveMessage(FORM_DEFAULTS, [], 'span')).toMatch(/&perfadapt=on&monitormode=span$/);
    expect(buildSaveMessage(FORM_DEFAULTS, [], '')).not.toContain('monitormode');
    expect(buildSaveMessage(FORM_DEFAULTS)).not.toContain('monitormode');
    const mons = [{ id: 'A', mode: 'on', scene: '', preset: '' }];
    expect(buildSaveMessage(FORM_DEFAULTS, mons, 'per')).toContain('&perfadapt=on&monitormode=per&m0id=A');
  });

  it('readMonitors parses the host monitor list', () => {
    const json = encodeURIComponent(
      JSON.stringify([{ id: 'A', name: 'Dell U2720Q', w: 3840, h: 2160, portrait: false, primary: true }]),
    );
    expect(readMonitors(new URLSearchParams('?monitors=' + json))[0].name).toBe('Dell U2720Q');
    expect(readMonitors(new URLSearchParams(''))).toEqual([]);
  });

  it('readMonitors tolerates malformed JSON', () => {
    expect(readMonitors(new URLSearchParams('?monitors=%7Bnope'))).toEqual([]);
    expect(readMonitors(new URLSearchParams('?monitors=42'))).toEqual([]);
  });

  it('readMonitors passes the existing per-monitor config through', () => {
    const json = encodeURIComponent(JSON.stringify([{
      id: 'A', name: 'Dell', w: 1920, h: 1080, portrait: false, primary: true,
      mode: 'scene', scene: 'matrix', preset: 'phosphor',
    }]));
    const [m] = readMonitors(new URLSearchParams('?monitors=' + json));
    expect(m.mode).toBe('scene');
    expect(m.scene).toBe('matrix');
    expect(m.preset).toBe('phosphor');
  });

  it('monitor cards start from the host config, missing subkey falls back to on/global', () => {
    const entries: MonitorEntry[] = [
      { id: 'A', name: 'Dell', w: 1920, h: 1080, portrait: false, primary: true,
        mode: 'scene', scene: 'matrix', preset: 'phosphor' },
      { id: 'B', name: 'Laptop', w: 1280, h: 800, portrait: false, primary: false },
    ];
    const states = initialMonitorStates(entries);
    expect(states[0]).toEqual({ id: 'A', mode: 'scene', scene: 'matrix', preset: 'phosphor' });
    expect(states[1]).toEqual({ id: 'B', mode: 'on', scene: '', preset: '' });
  });

  it('round-trips: an untouched save reproduces the loaded per-monitor config', () => {
    const json = encodeURIComponent(JSON.stringify([
      { id: 'A', name: 'Dell', w: 1920, h: 1080, portrait: false, primary: true,
        mode: 'scene', scene: 'matrix', preset: 'phosphor' },
      { id: 'B', name: 'Laptop', w: 1280, h: 800, portrait: false, primary: false,
        mode: 'off', scene: '', preset: '' },
    ]));
    const loaded = readMonitors(new URLSearchParams('?monitors=' + json));
    expect(buildSaveMessage(FORM_DEFAULTS, initialMonitorStates(loaded))).toContain(
      '&m0id=A&m0mode=scene&m0scene=matrix&m0preset=phosphor&m1id=B&m1mode=off&m1scene=&m1preset=',
    );
  });
});

// v0.11 — the wallpaper's own half of the dialog. Pinned against
// BuildWallpaperQuerySuffix / ParseWallpaperSaveMessage on the host side.
describe('wallpaper tab', () => {
  it('reads the wp-prefixed half into its own state', () => {
    const p = new URLSearchParams('scene=terrain&wpscene=void&wppreset=phosphor&wpscale=0.66');
    const wp = readWallpaperInitial(p);
    expect(wp.scene).toBe('void');
    expect(wp.preset).toBe('phosphor');
    expect(wp.scale).toBe('0.66');
  });

  it('leaves the saver state untouched', () => {
    const p = new URLSearchParams('scene=terrain&wpscene=void');
    expect(readInitial(p).scene).toBe('terrain');
  });

  it('falls back to wallpaper defaults when the half is absent', () => {
    const wp = readWallpaperInitial(new URLSearchParams('scene=terrain'));
    expect(wp.audio).toBe(false);
    expect(wp.scale).toBe('0.66');
    expect(wp.preset).toBe(FORM_DEFAULTS.preset); // rest = saver defaults
  });

  it('does not mistake the saver half for the wallpaper half', () => {
    // A bare `scene=` must not leak in through a sloppy prefix strip.
    const wp = readWallpaperInitial(new URLSearchParams('scene=terrain&audio=on&scale=1'));
    expect(wp.scene).toBe(WALLPAPER_FORM_DEFAULTS.scene);
    expect(wp.audio).toBe(false);
    expect(wp.scale).toBe('0.66');
  });

  it('forces audio off even when the registry says otherwise', () => {
    // The host renders the wallpaper with audio off unconditionally
    // (BuildWallpaperPage). A checkbox greyed out as "aus — im Wallpaper immer"
    // must therefore never show, or save, anything else.
    expect(readWallpaperInitial(new URLSearchParams('wpaudio=on')).audio).toBe(false);
  });

  it('rejects garbage / out-of-range wp numerics back to the WALLPAPER defaults', () => {
    const wp = readWallpaperInitial(new URLSearchParams('wpscale=abc&wpcrtintensity=9'));
    expect(wp.scale).toBe('0.66'); // not FORM_DEFAULTS.scale ('1')
    expect(wp.crtintensity).toBe(FORM_DEFAULTS.crtintensity);
  });

  it('serialises both sets, numerics unchanged', () => {
    const saver = { ...FORM_DEFAULTS, scene: 'terrain', crtintensity: '0.35' };
    const wallpaper = { ...WALLPAPER_FORM_DEFAULTS, scene: 'void', crtintensity: '0.35' };
    const out = buildSaveMessage(saver, [], '', wallpaper);
    expect(out).toContain('scene=terrain');
    expect(out).toContain('wpscene=void');
    expect(out).toContain('crtintensity=0.35');
    expect(out).toContain('wpcrtintensity=0.35');
    expect(out).toContain('wpscale=0.66'); // raw, never reformatted
  });

  it('keeps the saver half byte-identical when a wallpaper half is appended', () => {
    // The format invariant: everything new hangs off the back, the pinned
    // 33-key prefix does not move a byte.
    const msg = buildSaveMessage(FORM_DEFAULTS, [], '', WALLPAPER_FORM_DEFAULTS);
    expect(msg.startsWith('save:' + DEFAULT_QUERY + '&wpscene=')).toBe(true);
  });

  it('appends the wp half after the monitor keys, and wmonitormode last', () => {
    const mons = [{ id: 'A', mode: 'on', scene: '', preset: '' }];
    const msg = buildSaveMessage(FORM_DEFAULTS, mons, 'per', WALLPAPER_FORM_DEFAULTS, 'span');
    expect(msg).toContain('&m0preset=&wpscene=');
    expect(msg).toMatch(/&wpperfadapt=on&wmonitormode=span$/);
  });

  it('omits the wp half and wmonitormode entirely when not passed', () => {
    // The saver-only callers (and the pinned fixtures) must not gain a byte.
    expect(buildSaveMessage(FORM_DEFAULTS)).toBe('save:' + DEFAULT_QUERY);
    expect(buildSaveMessage(FORM_DEFAULTS, [], 'span')).not.toContain('wp');
    expect(buildSaveMessage(FORM_DEFAULTS, [], 'span', WALLPAPER_FORM_DEFAULTS)).not.toContain(
      'wmonitormode',
    );
  });

  it('round-trips: what readWallpaperInitial parses, buildSaveMessage re-serialises', () => {
    const wpQuery = FLIP_QUERY.split('&')
      .map((pair) => 'wp' + pair)
      .join('&')
      .replace('wpaudio=on', 'wpaudio=off'); // forced off, see above
    const wp = readWallpaperInitial(new URLSearchParams('?' + wpQuery));
    const msg = buildSaveMessage(FORM_DEFAULTS, [], '', wp);
    expect(msg).toBe('save:' + DEFAULT_QUERY + '&' + wpQuery);
  });

  it('reads the run status, the initial tab and the autostart flag', () => {
    const p = new URLSearchParams('wprunning=2/3&tab=wallpaper&wpautostart=on');
    expect(readWallpaperRunning(p)).toBe('2/3');
    expect(readTab(p)).toBe('wallpaper');
    expect(readAutostart(p)).toBe(true);

    // Absent = nothing runs, saver tab, no autostart — the /c screensaver path.
    const empty = new URLSearchParams('');
    expect(readWallpaperRunning(empty)).toBe('');
    expect(readTab(empty)).toBe('saver');
    expect(readAutostart(empty)).toBe(false);

    // An unknown tab value is not a reason to show a broken dialog.
    expect(readTab(new URLSearchParams('tab=nonsense'))).toBe('saver');
  });
});
