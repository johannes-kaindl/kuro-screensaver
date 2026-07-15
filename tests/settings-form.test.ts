import { describe, expect, it } from 'vitest';
import { FORM_DEFAULTS, buildSaveMessage, readInitial } from '../src/settings/form-state';

describe('settings form state (native /c dialog bridge)', () => {
  it('serialises the defaults in the pinned key order', () => {
    // Byte-identical to the C# host's default Options.QueryString() output,
    // with the "save:" prefix instead of "?".
    expect(buildSaveMessage(FORM_DEFAULTS)).toBe(
      'save:scene=random&preset=toxic-haze&speed=norm&audio=off&bloom=on&trails=off' +
        '&scan=on&crt=on&matrix=off&terminal=on&radar=on&crosshair=on',
    );
  });

  it('reads host query params over the defaults', () => {
    const s = readInitial(new URLSearchParams('?scene=city&preset=kuro&audio=on&bloom=off'));
    expect(s.scene).toBe('city');
    expect(s.preset).toBe('kuro');
    expect(s.audio).toBe(true);
    expect(s.bloom).toBe(false);
    expect(s.terminal).toBe(true); // untouched default
  });

  it('round-trips: what readInitial parses, buildSaveMessage re-serialises', () => {
    const q =
      'scene=void&preset=phosphor&speed=fast&audio=on&bloom=off&trails=on' +
      '&scan=off&crt=off&matrix=on&terminal=off&radar=off&crosshair=off';
    expect(buildSaveMessage(readInitial(new URLSearchParams('?' + q)))).toBe('save:' + q);
  });
});
