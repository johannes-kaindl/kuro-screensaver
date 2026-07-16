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
  // Existing per-monitor saver config, carried along by the host so the
  // dialog starts from it (data-loss guard: an untouched save must reproduce
  // these instead of resetting every monitor to neutral). Absent fields mean
  // "no registry subkey yet" → mode 'on', scene/preset ''.
  mode?: string;   // on|off|random|scene
  scene?: string;  // slug or '' (= global scene)
  preset?: string; // slug or '' (= global preset)
  // The wallpaper's own per-monitor trio (registry WMode/WScene/WPreset). wmode
  // arrives ALREADY RESOLVED by the host (EffectiveWallpaperMode): its registry
  // sentinel — the empty string — means "never set", which in turn means
  // "primary on, others off", NOT off. Rendering that absence as 'off' and
  // letting the user save it is what turned the wallpaper permanently black in
  // v0.10, so the rule lives host-side and this side never re-derives it.
  wmode?: string;   // on|off|random|scene, always concrete
  wscene?: string;  // slug or '' (= global scene)
  wpreset?: string; // slug or '' (= global preset)
}

/**
 * Per-monitor form state, serialised as mNid/mNmode/mNscene/mNpreset plus the
 * wallpaper's mNwmode/mNwscene/mNwpreset.
 */
export interface MonitorFormState {
  id: string;
  mode: string;   // on|off|random|scene
  scene: string;  // slug or '' (= global scene)
  preset: string; // slug or '' (= global preset)
  wmode: string;   // on|off|random|scene
  wscene: string;  // slug or '' (= global scene)
  wpreset: string; // slug or '' (= global preset)
  // Did the user touch this card IN THE WALLPAPER TAB? Only then does the trio
  // travel. The wmode the host sends is already resolved (EffectiveWallpaperMode
  // turns the "never set" sentinel into on/off for display), so the value alone
  // cannot answer "has anyone ever decided this?" — and a save that answers it
  // wrongly writes WMode for every monitor, killing the "unset primary = on"
  // rule forever. The touch is the only honest signal, so it is carried, not
  // re-derived.
  wtouched: boolean;
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

/**
 * The wallpaper's own defaults — deliberately NOT the saver's (spec §4.1).
 * Sound all day is unusable, and full device resolution through the bloom+CRT
 * chain is what made the wallpaper stutter (v0.8 finding). Mirrors
 * WallpaperDefaults() in native/windows/host/src/wallpaper_options.cpp.
 */
export const WALLPAPER_FORM_DEFAULTS: SettingsFormState = {
  ...FORM_DEFAULTS,
  audio: false,
  scale: '0.66',
};

/** All 33 query keys in the pinned contract order (host BuildQueryString). */
const KEY_ORDER: readonly (keyof SettingsFormState)[] = [
  'scene', 'preset', 'speed', 'audio', 'bloom', 'trails', 'scan', 'crt', 'matrix',
  'terminal', 'radar', 'crosshair', 'look', 'altitude', 'fog', 'weather', 'bank',
  'reactive', 'autocycle', 'cyclemin', 'termlayout', 'boot', 'bootspeed', 'daynight',
  'crtintensity', 'curvature', 'aperture', 'bloomstrength', 'trailsamount', 'ntsc',
  'halation', 'scale', 'perfadapt',
];

/**
 * The wallpaper half's query/save prefix. `wp`, not `w`: `w` alone borders the
 * per-monitor vocabulary that is already taken (WMode/WScene/WPreset in the
 * registry) — a `wscene` next to a `WScene` that means something else is a trap
 * for the next reader.
 */
const WALLPAPER_PREFIX = 'wp';

export type Tab = 'saver' | 'wallpaper';

export type BoolKey = {
  [K in keyof SettingsFormState]: SettingsFormState[K] extends boolean ? K : never;
}[keyof SettingsFormState];

export type StringKey = Exclude<keyof SettingsFormState, BoolKey>;

/** Save-format contract cap — ParseSaveMessage accepts monitor indices 0..7 only. */
export const MONITOR_CAP = 8;

export interface NumericRange { min: number; max: number; step: number }

/**
 * Slider ranges for the 10 raw numeric fields — the single source for the
 * dialog's range-input attributes (main.ts) AND readInitial's garbage guard,
 * so UI and validation cannot diverge. min/max mirror the host's
 * IsValidNumber calls in ParseSaveMessage (options.cpp).
 */
export const NUMERIC_RANGES = {
  bank:          { min: 0,    max: 2,    step: 0.1 },
  cyclemin:      { min: 0.5,  max: 10,   step: 0.5 },
  crtintensity:  { min: 0,    max: 1,    step: 0.01 },
  curvature:     { min: 0,    max: 0.25, step: 0.001 },
  aperture:      { min: 0,    max: 0.5,  step: 0.01 },
  bloomstrength: { min: 0,    max: 3,    step: 0.1 },
  trailsamount:  { min: 0.5,  max: 0.95, step: 0.01 },
  ntsc:          { min: 0,    max: 1,    step: 0.01 },
  halation:      { min: 0,    max: 0.6,  step: 0.01 },
  scale:         { min: 0.25, max: 1,    step: 0.01 },
} as const satisfies Partial<Record<StringKey, NumericRange>>;

export type NumericKey = keyof typeof NUMERIC_RANGES;

/**
 * The closed value sets of the enum fields — the single source for the dialog's
 * option lists (main.ts) AND readInitial's garbage guard, same contract as
 * NUMERIC_RANGES. Mirrors the whitelists in ParseOptionField (options.cpp),
 * which rejects anything else and fails the whole save with it.
 *
 * scene/preset/look are absent on purpose: they are open slug sets (the host
 * only checks the charset), and their option lists come from the engine data.
 */
export const ENUM_VALUES = {
  speed: ['slow', 'norm', 'fast'],
  altitude: ['low', 'mid', 'high'],
  fog: ['auto', 'clear', 'dense'],
  weather: ['light-fog', 'heavy-fog', 'storm', 'dust', 'clear'],
  termlayout: ['strip', 'window'],
  bootspeed: ['fast', 'normal', 'cinematic'],
} as const satisfies Partial<Record<StringKey, readonly string[]>>;

// Same shape the host accepts (IsValidNumber → wcstod): plain unsigned
// decimals. Anything else ("1,5", "abc", "1#") would poison the save loop.
const NUMERIC_RE = /^[0-9]+(\.[0-9]+)?$/;

/**
 * Whether a raw registry value may enter the form. Numerics must be in range,
 * enums must be in their whitelist — the selects normalise only what they
 * render, and the inactive tab renders nothing, so this side (which sees both
 * halves) is the only place that can defend both.
 */
function isAcceptableRaw(key: StringKey, v: string): boolean {
  const values = (ENUM_VALUES as Partial<Record<StringKey, readonly string[]>>)[key];
  if (values) return values.includes(v);
  const range = (NUMERIC_RANGES as Partial<Record<StringKey, NumericRange>>)[key];
  if (!range) return true; // open slug sets (scene/preset/look) — host checks the charset
  if (!NUMERIC_RE.test(v)) return false;
  const n = parseFloat(v);
  return n >= range.min && n <= range.max;
}

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

/**
 * Reads one option set out of the query. `prefix`/`defaults` exist for the
 * wallpaper half (readWallpaperInitial) — the saver half keeps calling this
 * with neither, so its 33 keys stay exactly where the format contract pins them.
 */
export function readInitial(
  params: URLSearchParams,
  prefix = '',
  defaults: SettingsFormState = FORM_DEFAULTS,
): SettingsFormState {
  const s: SettingsFormState = { ...defaults };
  const get = (key: string): string | null => params.get(prefix + key);
  for (const key of ['scene', 'preset', 'speed'] as const) {
    const v = get(key);
    if (v && isAcceptableRaw(key, v)) s[key] = v;
  }
  for (const key of RAW_STRING_KEYS) {
    const v = get(key);
    // Numeric and enum fields reject registry garbage back to the defaults —
    // otherwise the host rejects EVERY save (both tabs travel in one
    // all-or-nothing message) until the user happens to touch exactly the
    // poisoned control, which on the inactive tab they cannot even see.
    if (v !== null && isAcceptableRaw(key, v)) s[key] = v;
  }
  for (const key of BOOL_KEYS) {
    const v = get(key);
    if (v === 'on') s[key] = true;
    else if (v === 'off') s[key] = false;
  }
  return s;
}

/**
 * Reads the wp-prefixed half — same field names as the saver's, one prefix
 * deeper (mirrors BuildWallpaperQuerySuffix in options.cpp).
 *
 * `audio` is forced off rather than read: the host renders the wallpaper with
 * sound off unconditionally (BuildWallpaperPage), so a dialog that showed or
 * saved anything else would be lying about what the machine does.
 */
export function readWallpaperInitial(params: URLSearchParams): SettingsFormState {
  const s = readInitial(params, WALLPAPER_PREFIX, WALLPAPER_FORM_DEFAULTS);
  s.audio = false;
  return s;
}

/** Run status for the wallpaper tab's status block: "2/3", or '' when nothing runs. */
export function readWallpaperRunning(params: URLSearchParams): string {
  return params.get(WALLPAPER_PREFIX + 'running') ?? '';
}

/** Initially active tab. Anything unrecognised opens the saver — the /c default. */
export function readTab(params: URLSearchParams): Tab {
  return params.get('tab') === 'wallpaper' ? 'wallpaper' : 'saver';
}

/** Whether the wallpaper's HKCU Run key is set (host-owned, hence its own key). */
export function readAutostart(params: URLSearchParams): boolean {
  return params.get(WALLPAPER_PREFIX + 'autostart') === 'on';
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
 * Initial per-monitor form state from the host's monitor entries: starts from
 * the existing config the host embedded in the `monitors=`-JSON, so a save
 * without touching the cards round-trips the loaded values byte-identically.
 */
export function initialMonitorStates(entries: readonly MonitorEntry[]): MonitorFormState[] {
  return entries.map((m) => ({
    id: m.id,
    mode: m.mode ?? 'on',
    scene: m.scene ?? '',
    preset: m.preset ?? '',
    // '' only when a host too old to send the trio is on the other end — the
    // save then omits the key and the host keeps its sentinel, rather than this
    // side inventing a value for an absence it cannot see (see MonitorEntry).
    wmode: m.wmode ?? '',
    wscene: m.wscene ?? '',
    wpreset: m.wpreset ?? '',
    wtouched: false, // loading is not deciding
  }));
}

/** The 33 keys of one option set, in the pinned contract order. */
function serializeSet(s: SettingsFormState, prefix = ''): string {
  return KEY_ORDER.map((key) => {
    const v = s[key];
    return `${prefix}${key}=${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`;
  }).join('&');
}

/**
 * Serialises in the same key order as the host's BuildQueryString, then the
 * optional `monitormode` (only when non-empty), then the mN monitor keys
 * (index order, gapless — ParseSaveMessage rejects gaps). At most the first
 * MONITOR_CAP entries go out — ParseSaveMessage only accepts m0..m7 and would
 * reject the whole save on an m8 key.
 *
 * One save carries both tabs: `wallpaper` appends the same 33 keys wp-prefixed,
 * which settings_window.cpp splits off and writes to its own registry subkey.
 * Everything past `perfadapt` is additive — omit the wallpaper half and the
 * message is byte-identical to the v0.10 format. Numerics stay raw strings on
 * both halves; the host compares them byte for byte.
 */
export function buildSaveMessage(
  s: SettingsFormState,
  monitors: readonly MonitorFormState[] = [],
  monitorMode?: string,
  wallpaper?: SettingsFormState,
  wallpaperMonitorMode?: string,
): string {
  let msg = 'save:' + serializeSet(s);
  if (monitorMode) msg += `&monitormode=${monitorMode}`;
  monitors.slice(0, MONITOR_CAP).forEach((m, i) => {
    msg += `&m${i}id=${m.id}&m${i}mode=${m.mode}&m${i}scene=${m.scene}&m${i}preset=${m.preset}`;
    // The wallpaper trio only for a card the user actually touched in the
    // wallpaper tab (main.ts sets wtouched there, and only from a real change
    // event). Every save carries a wallpaper half — the dialog serves both tabs
    // — so `wallpaper` alone would send the trio for every monitor on every
    // save, materialising WMode where the host's "never set" sentinel must
    // stay. An absent key is the ONLY way to say "nobody decided this yet", and
    // `wmode` is belt and braces: the empty sentinel is never spelled out.
    if (wallpaper && m.wtouched && m.wmode) {
      msg += `&m${i}wmode=${m.wmode}&m${i}wscene=${m.wscene}&m${i}wpreset=${m.wpreset}`;
    }
  });
  if (wallpaper) {
    msg += '&' + serializeSet(wallpaper, WALLPAPER_PREFIX);
    // Same empty-means-not-sent rule as monitormode: the host can then tell
    // "the dialog had no choice to offer" from "the user picked per".
    if (wallpaperMonitorMode) msg += `&${WALLPAPER_PREFIX}monitormode=${wallpaperMonitorMode}`;
  }
  return msg;
}
