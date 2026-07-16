// Pure form-state model for the native settings dialog (settings.html).
//
// The Win32 host opens settings.html with the current registry values as
// query params (same serialisation as screensaver.html) and expects a
// "save:key=value&..." string message back — parsed by ParseSaveMessage in
// native/windows/host/src/options.cpp. Key order and on/off encoding are
// pinned by tests/settings-form.test.ts and options_test.cpp on both sides.
//
// v0.10: numerics travel as RAW validated strings (registry → query → form →
// save message, never reformatted) so byte-parity with the host is trivial.

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
  // v0.10 — keys 13..33 (contract order, see buildSaveMessage)
  look: string;          // look slug or '' = custom ("Eigene"), dialog-only key
  altitude: string;      // low|mid|high
  fog: string;           // auto|clear|dense
  weather: string;       // light-fog|heavy-fog|storm|dust|clear
  bank: string;          // num 0..2
  reactive: boolean;
  autocycle: boolean;
  cyclemin: string;      // num 0.5..10
  termlayout: string;    // strip|window
  boot: boolean;
  bootspeed: string;     // fast|normal|cinematic
  daynight: boolean;
  crtintensity: string;  // num 0..1
  curvature: string;     // num 0..0.25
  aperture: string;      // num 0..0.5
  bloomstrength: string; // num 0..3
  trailsamount: string;  // num 0.5..0.95 (= trails.damp)
  ntsc: string;          // num 0..1
  halation: string;      // num 0..0.6
  scale: string;         // num 0.25..1
  perfadapt: boolean;
}

/** One monitor as enumerated by the host (`monitors=`-JSON query param). */
export interface MonitorEntry {
  id: string;
  name: string;
  w: number;
  h: number;
  portrait: boolean;
  primary: boolean;
}

/** Per-monitor form state, serialised as mNid/mNmode/mNscene/mNpreset. */
export interface MonitorFormState {
  id: string;
  mode: string;   // on|off|random|scene
  scene: string;  // slug or '' (= global scene)
  preset: string; // slug or '' (= global preset)
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
  look: '',
  altitude: 'low',
  fog: 'auto',
  weather: 'light-fog',
  bank: '1',
  reactive: true,
  autocycle: true,
  cyclemin: '5',
  termlayout: 'strip',
  boot: true,
  bootspeed: 'normal',
  daynight: true,
  crtintensity: '0.35',
  curvature: '0.012',
  aperture: '0.22',
  bloomstrength: '1.4',
  trailsamount: '0.84',
  ntsc: '0',
  halation: '0.15',
  scale: '1',
  perfadapt: true,
};

/** All 33 query keys in the pinned contract order (host BuildQueryString). */
const KEY_ORDER: readonly (keyof SettingsFormState)[] = [
  'scene', 'preset', 'speed', 'audio', 'bloom', 'trails', 'scan', 'crt', 'matrix',
  'terminal', 'radar', 'crosshair', 'look', 'altitude', 'fog', 'weather', 'bank',
  'reactive', 'autocycle', 'cyclemin', 'termlayout', 'boot', 'bootspeed', 'daynight',
  'crtintensity', 'curvature', 'aperture', 'bloomstrength', 'trailsamount', 'ntsc',
  'halation', 'scale', 'perfadapt',
];

export type BoolKey = {
  [K in keyof SettingsFormState]: SettingsFormState[K] extends boolean ? K : never;
}[keyof SettingsFormState];

export type StringKey = Exclude<keyof SettingsFormState, BoolKey>;

const BOOL_KEYS: readonly BoolKey[] = [
  'audio', 'bloom', 'trails', 'scan', 'crt', 'matrix', 'terminal', 'radar', 'crosshair',
  'reactive', 'autocycle', 'boot', 'daynight', 'perfadapt',
];

// v0.10 string keys pass through raw ('' is meaningful for look); the three
// legacy keys keep their non-empty guard from v0.9.
const RAW_STRING_KEYS: readonly StringKey[] = [
  'look', 'altitude', 'fog', 'weather', 'bank', 'cyclemin', 'termlayout', 'bootspeed',
  'crtintensity', 'curvature', 'aperture', 'bloomstrength', 'trailsamount', 'ntsc',
  'halation', 'scale',
];

export function readInitial(params: URLSearchParams): SettingsFormState {
  const s: SettingsFormState = { ...FORM_DEFAULTS };
  for (const key of ['scene', 'preset', 'speed'] as const) {
    const v = params.get(key);
    if (v) s[key] = v;
  }
  for (const key of RAW_STRING_KEYS) {
    const v = params.get(key);
    if (v !== null) s[key] = v;
  }
  for (const key of BOOL_KEYS) {
    const v = params.get(key);
    if (v === 'on') s[key] = true;
    else if (v === 'off') s[key] = false;
  }
  return s;
}

/** Parses the host's monitor list (`monitors=`-JSON param); [] when absent/broken. */
export function readMonitors(params: URLSearchParams): MonitorEntry[] {
  const raw = params.get('monitors');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MonitorEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Serialises in the same key order as the host's BuildQueryString, then the
 * optional `monitormode` (only when non-empty), then the mN monitor keys
 * (index order, gapless — ParseSaveMessage rejects gaps).
 */
export function buildSaveMessage(
  s: SettingsFormState,
  monitors: readonly MonitorFormState[] = [],
  monitorMode?: string,
): string {
  const parts = KEY_ORDER.map((key) => {
    const v = s[key];
    return `${key}=${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`;
  });
  let msg = 'save:' + parts.join('&');
  if (monitorMode) msg += `&monitormode=${monitorMode}`;
  monitors.forEach((m, i) => {
    msg += `&m${i}id=${m.id}&m${i}mode=${m.mode}&m${i}scene=${m.scene}&m${i}preset=${m.preset}`;
  });
  return msg;
}
