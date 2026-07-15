// Pure form-state model for the native settings dialog (settings.html).
//
// The Win32 host opens settings.html with the current registry values as
// query params (same serialisation as screensaver.html) and expects a
// "save:key=value&..." string message back — parsed by ParseSaveMessage in
// native/windows/host/src/options.cpp. Key order and on/off encoding are
// pinned by tests/settings-form.test.ts and options_test.cpp on both sides.

export interface SettingsFormState {
  scene: string;
  preset: string;
  speed: string;
  audio: boolean;
  bloom: boolean;
  trails: boolean;
  scan: boolean;
  crt: boolean;
  matrix: boolean;
  terminal: boolean;
  radar: boolean;
  crosshair: boolean;
}

/** Mirrors the engine defaults (defaults.ts) and the host's SaverOptions defaults. */
export const FORM_DEFAULTS: SettingsFormState = {
  scene: 'random',
  preset: 'toxic-haze',
  speed: 'norm',
  audio: false,
  bloom: true,
  trails: false,
  scan: true,
  crt: true,
  matrix: false,
  terminal: true,
  radar: true,
  crosshair: true,
};

export type BoolKey = {
  [K in keyof SettingsFormState]: SettingsFormState[K] extends boolean ? K : never;
}[keyof SettingsFormState];

const BOOL_KEYS: readonly BoolKey[] = [
  'audio', 'bloom', 'trails', 'scan', 'crt', 'matrix', 'terminal', 'radar', 'crosshair',
];

export function readInitial(params: URLSearchParams): SettingsFormState {
  const s: SettingsFormState = { ...FORM_DEFAULTS };
  for (const key of ['scene', 'preset', 'speed'] as const) {
    const v = params.get(key);
    if (v) s[key] = v;
  }
  for (const key of BOOL_KEYS) {
    const v = params.get(key);
    if (v === 'on') s[key] = true;
    else if (v === 'off') s[key] = false;
  }
  return s;
}

/** Serialises in the same key order as the host's BuildQueryString. */
export function buildSaveMessage(s: SettingsFormState): string {
  const on = (b: boolean) => (b ? 'on' : 'off');
  return (
    `save:scene=${s.scene}&preset=${s.preset}&speed=${s.speed}` +
    `&audio=${on(s.audio)}&bloom=${on(s.bloom)}&trails=${on(s.trails)}` +
    `&scan=${on(s.scan)}&crt=${on(s.crt)}&matrix=${on(s.matrix)}` +
    `&terminal=${on(s.terminal)}&radar=${on(s.radar)}&crosshair=${on(s.crosshair)}`
  );
}
