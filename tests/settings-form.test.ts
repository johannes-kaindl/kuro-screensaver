import { describe, expect, it } from 'vitest';
import { FORM_DEFAULTS, buildSaveMessage, readInitial, readMonitors } from '../src/settings/form-state';

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

  it('appends monitor entries in index order', () => {
    const mons = [
      { id: 'DELL_ABC1', mode: 'scene', scene: 'matrix', preset: 'phosphor' },
      { id: 'LAPTOP_0', mode: 'off', scene: '', preset: '' },
    ];
    expect(buildSaveMessage(FORM_DEFAULTS, mons)).toContain(
      '&m0id=DELL_ABC1&m0mode=scene&m0scene=matrix&m0preset=phosphor&m1id=LAPTOP_0&m1mode=off&m1scene=&m1preset=',
    );
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
});
