// Native settings dialog (Windows) — renders the full v0.10 option set (looks,
// CRT sliders, motion/story, monitors, performance) and posts it back to the
// Win32 host via window.chrome.webview.postMessage ("save:<query>" or "cancel";
// host answers "saveerror" when it rejects). Loads standalone in a browser too
// (styling / dev loop); without the host bridge the messages go to the console.
//
// v0.11: two tabs, two fully independent option sets. One DOM drives both — the
// tab switch repoints `state` and re-runs the refreshers, so every control keeps
// exactly one definition and the two tabs cannot drift apart.
//
// Scene / preset / look lists come straight from the engine data — the retired
// C# ConfigForm duplicated them by hand.

import { SCENES } from '../engine/data/defaults';
import { LOOKS } from '../engine/data/looks';
import { PRESETS } from '../engine/data/presets';
import {
  MONITOR_CAP,
  NUMERIC_RANGES,
  buildSaveMessage,
  initialMonitorStates,
  readAutostart,
  readInitial,
  readMonitors,
  readTab,
  readWallpaperInitial,
  readWallpaperRunning,
  type BoolKey,
  type MonitorEntry,
  type MonitorFormState,
  type NumericKey,
  type SettingsFormState,
  type Tab,
} from './form-state';

const SPEEDS = ['slow', 'norm', 'fast'] as const;

const params = new URLSearchParams(location.search);
const saverState = readInitial(params);
const wallpaperState = readWallpaperInitial(params);
const monitors = readMonitors(params);

let tab: Tab = readTab(params);
const isWallpaperTab = (): boolean => tab === 'wallpaper';

// Every control below closes over this binding rather than a fixed object, so
// repointing it IS the tab switch.
let state: SettingsFormState = isWallpaperTab() ? wallpaperState : saverState;

// MonitorMode travels as its own query param (not part of the 33-key format);
// echoed back verbatim in the save message when non-empty. One per tab: the
// wallpaper's span/per choice lives in WallpaperMonitorMode and has always been
// independent of the saver's — v0.10 just had no UI for it.
const monitorModes: Record<Tab, string> = {
  saver: params.get('monitormode') ?? '',
  wallpaper: params.get('wmonitormode') ?? '',
};
if (monitors.length >= 2) {
  for (const t of ['saver', 'wallpaper'] as const) {
    if (monitorModes[t] !== 'per' && monitorModes[t] !== 'span') monitorModes[t] = 'per';
  }
}

let autostart = readAutostart(params);

// Per-monitor overrides start from the existing config the host embeds in
// the monitors=-JSON — an untouched save keeps them (unknown registry values
// are normalised by the selects below, exactly like the global fields).
const monitorStates: MonitorFormState[] = initialMonitorStates(monitors);

// Every control registers a refresher so state mutations from elsewhere
// (look bundles, dependent enable/visibility rules) reflect in the DOM.
const refreshers: Array<() => void> = [];
function refreshAll(): void {
  for (const r of refreshers) r();
}

function post(message: string): void {
  const bridge = (window as unknown as {
    chrome?: { webview?: { postMessage(m: string): void } };
  }).chrome?.webview;
  if (bridge) bridge.postMessage(message);
  else console.log('[settings] no host bridge —', message);
}

function row(labelText: string, control: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'row';
  const label = document.createElement('label');
  label.textContent = labelText;
  div.append(label, control);
  return div;
}

interface Option { value: string; label?: string }
const opts = (values: readonly string[]): Option[] => values.map((value) => ({ value }));

function select(options: readonly Option[], get: () => string, set: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label ?? o.value;
    sel.append(opt);
  }
  // Normalise unknown registry values to a real option — on load AND on every
  // refresh, because a tab switch shows a set this select has never seen.
  const normalise = (): void => {
    const current = get();
    sel.value = options.some((o) => o.value === current) ? current : options[0].value;
    if (sel.value !== current) set(sel.value);
  };
  normalise();
  sel.addEventListener('change', () => set(sel.value));
  refreshers.push(normalise);
  return sel;
}

function toggle(key: BoolKey, labelText: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state[key];
  box.addEventListener('change', () => {
    state[key] = box.checked;
    refreshAll();
  });
  refreshers.push(() => { box.checked = state[key]; });
  wrap.append(box, document.createTextNode(labelText));
  return wrap;
}

// Sliders keep the raw input string in state (byte-parity contract); the
// registry value is only replaced once the user actually drags. Range
// attributes come from the shared NUMERIC_RANGES table (form-state.ts) so the
// UI can never diverge from readInitial's validation or the host's ranges.
function slider(
  labelText: string, key: NumericKey,
  o: { resetsLook?: boolean; fmt?: (v: string) => string } = {},
): HTMLElement {
  const { min, max, step } = NUMERIC_RANGES[key];
  const fmt = o.fmt ?? ((v: string) => v);
  const div = document.createElement('div');
  div.className = 'row slider';
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = state[key];
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = fmt(state[key]);
  input.addEventListener('input', () => {
    state[key] = input.value;
    if (o.resetsLook) state.look = ''; // manual tweak leaves the Look bundle
    val.textContent = fmt(input.value);
    refreshAll();
  });
  refreshers.push(() => {
    input.value = state[key];
    val.textContent = fmt(state[key]);
  });
  div.append(label, input, val);
  return div;
}

function section(titleText: string): { root: HTMLElement; grid: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'section';
  const h = document.createElement('h2');
  h.textContent = titleText;
  const grid = document.createElement('div');
  grid.className = 'grid';
  root.append(h, grid);
  return { root, grid };
}

// ---------------------------------------------------------------- Look row
// Picking a look materialises its values into the slider fields (same mapping
// as applyLook in looks.ts); any manual slider change flips back to "Eigene".
function applyLookValues(key: string): void {
  const L = LOOKS[key];
  if (!L) return;
  state.preset = L.preset;
  state.matrix = L.matrix;
  // Materialise the on-flags exactly like applyLook (looks.ts) — otherwise the
  // saver renders the Look differently from web/macOS (e.g. Heavy CRT without
  // trails, Clean still glitching because crt stays on at intensity 0).
  state.crt = L.intensity > 0.001;
  state.trails = L.trails > 0.001;
  state.bloom = true;
  state.crtintensity = String(L.intensity);
  state.curvature = String(L.curvature);
  state.aperture = String(L.aperture);
  state.ntsc = String(L.ntsc);
  state.halation = String(L.halation);
  state.bloomstrength = String(L.bloom);
  state.trailsamount = String(0.5 + L.trails * 0.45); // 0..0.9 → damp 0.5..0.95
}

const lookSelect = select(
  [{ value: '', label: 'Eigene' }, ...Object.entries(LOOKS).map(([value, L]) => ({ value, label: L.label }))],
  () => state.look,
  (v) => { state.look = v; },
);
// Side effects only on USER change — never on load, so untouched registry
// strings survive the roundtrip byte-identically.
lookSelect.addEventListener('change', () => {
  applyLookValues(lookSelect.value);
  refreshAll();
});
const lookRow = row('Look', lookSelect);
lookRow.classList.add('look-row');

// ---------------------------------------------------------------- Sektionen
const bild = section('Bild');
bild.grid.append(
  row('Scene', select(opts(['random', ...SCENES]), () => state.scene, (v) => (state.scene = v))),
  row('Color', select(opts(Object.keys(PRESETS)), () => state.preset, (v) => (state.preset = v))),
  row('Speed', select(opts(SPEEDS), () => state.speed, (v) => (state.speed = v))),
  row('Altitude', select(opts(['low', 'mid', 'high']), () => state.altitude, (v) => (state.altitude = v))),
  row('Fog', select(opts(['auto', 'clear', 'dense']), () => state.fog, (v) => (state.fog = v))),
  row('Weather', select(
    opts(['light-fog', 'heavy-fog', 'storm', 'dust', 'clear']),
    () => state.weather, (v) => (state.weather = v),
  )),
);

const crtFx = section('CRT-Effekte');
crtFx.grid.append(
  slider('Intensity', 'crtintensity', { resetsLook: true }),
  slider('Curvature', 'curvature', { resetsLook: true }),
  slider('Aperture', 'aperture', { resetsLook: true }),
  slider('Bloom', 'bloomstrength', { resetsLook: true }),
  slider('Trails', 'trailsamount', { resetsLook: true }),
  slider('NTSC', 'ntsc', { resetsLook: true }),
  slider('Halation', 'halation', { resetsLook: true }),
  toggle('scan', 'Scanlines'),
  toggle('crt', 'CRT simulation'),
  toggle('bloom', 'Bloom'),
  toggle('trails', 'Afterburn'),
);

const motion = section('Bewegung & Story');
motion.grid.append(
  slider('Bank', 'bank'),
  toggle('reactive', 'Reactive world'),
  toggle('autocycle', 'Auto-cycle'),
  slider('Cycle (min)', 'cyclemin'),
  toggle('terminal', 'Story terminal'),
);

const term = section('Terminal');
const termlayoutSelect = select(
  [{ value: 'strip', label: 'strip' }, { value: 'window', label: 'window' }],
  () => state.termlayout, (v) => (state.termlayout = v),
);
refreshers.push(() => { termlayoutSelect.disabled = !state.terminal; });
termlayoutSelect.disabled = !state.terminal;
term.grid.append(row('Layout', termlayoutSelect));

const display = section('Anzeige & Automatik');
display.grid.append(
  toggle('radar', 'Radar'),
  toggle('crosshair', 'Crosshair'),
  toggle('matrix', 'Matrix rain'),
  toggle('boot', 'Boot sequence'),
  row('Boot speed', select(opts(['fast', 'normal', 'cinematic']), () => state.bootspeed, (v) => (state.bootspeed = v))),
  toggle('daynight', 'Day/night'),
);

// Audio is forced off in the wallpaper (BuildWallpaperPage) — greyed out WITH
// the reason, not hidden: a missing switch reads as a bug, a greyed one with an
// explanation reads as a decision (spec §5).
const audioToggle = toggle('audio', 'Audio');
const audioBox = audioToggle.querySelector('input')!;
const audioReason = document.createElement('span');
audioReason.className = 'reason';
audioReason.textContent = 'aus — im Wallpaper immer';
audioToggle.append(audioReason);
refreshers.push(() => {
  audioBox.disabled = isWallpaperTab();
  audioToggle.classList.toggle('disabled', isWallpaperTab());
  audioReason.hidden = !isWallpaperTab();
});
display.grid.append(audioToggle);

// ---------------------------------------------------------------- Monitore
function badge(text: string): HTMLElement {
  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = text;
  return b;
}

function monitorCard(entry: MonitorEntry, ms: MonitorFormState): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mon-card';
  const head = document.createElement('div');
  head.className = 'mon-head';
  const name = document.createElement('span');
  name.className = 'mon-name';
  name.textContent = `${entry.name || entry.id} — ${entry.w}×${entry.h}`;
  head.append(name);
  if (entry.primary) head.append(badge('Hauptmonitor'));
  if (entry.portrait) head.append(badge('Hochformat'));

  const modeSelect = select(opts(['on', 'off', 'random', 'scene']), () => ms.mode, (v) => (ms.mode = v));
  modeSelect.addEventListener('change', refreshAll);
  const sceneRow = row('Scene', select(
    [{ value: '', label: 'global' }, ...opts(SCENES)],
    () => ms.scene, (v) => (ms.scene = v),
  ));
  sceneRow.hidden = ms.mode !== 'scene';
  refreshers.push(() => { sceneRow.hidden = ms.mode !== 'scene'; });
  const presetRow = row('Color', select(
    [{ value: '', label: 'global' }, ...opts(Object.keys(PRESETS))],
    () => ms.preset, (v) => (ms.preset = v),
  ));
  card.append(head, row('Mode', modeSelect), sceneRow, presetRow);
  return card;
}

let monitorSection: HTMLElement | null = null;
if (monitors.length > 0) {
  const mon = section('Monitore');
  monitorSection = mon.root;
  if (monitors.length >= 2) {
    const radios = document.createElement('div');
    radios.className = 'row radios';
    const label = document.createElement('label');
    label.textContent = 'Modus';
    radios.append(label);
    for (const [value, text] of [['per', 'Je Monitor'], ['span', 'Eine Fläche']] as const) {
      const wrap = document.createElement('label');
      wrap.className = 'toggle';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'monitormode';
      radio.value = value;
      radio.checked = monitorModes[tab] === value;
      radio.addEventListener('change', () => {
        if (radio.checked) monitorModes[tab] = value;
        refreshAll();
      });
      refreshers.push(() => { radio.checked = monitorModes[tab] === value; });
      wrap.append(radio, document.createTextNode(text));
      radios.append(wrap);
    }
    radios.style.gridColumn = '1 / -1';
    mon.grid.append(radios);
  }
  // Save-format cap: ParseSaveMessage accepts m0..m7 only, buildSaveMessage
  // slices accordingly — so no card for what would silently not be saved.
  monitors.slice(0, MONITOR_CAP).forEach((entry, i) => {
    const card = monitorCard(entry, monitorStates[i]);
    // The cards edit the saver's per-monitor trio. The wallpaper's own trio
    // (WMode/WScene/WPreset) is a separate registry vocabulary that no query
    // key carries yet, so showing these cards under the wallpaper tab would
    // silently edit the wrong set.
    refreshers.push(() => { card.hidden = isWallpaperTab(); });
    mon.grid.append(card);
  });
  if (monitors.length > MONITOR_CAP) {
    const capHint = document.createElement('div');
    capHint.className = 'hint';
    capHint.textContent = `Maximal ${MONITOR_CAP} Monitore konfigurierbar`;
    capHint.style.gridColumn = '1 / -1';
    refreshers.push(() => { capHint.hidden = isWallpaperTab(); });
    mon.grid.append(capHint);
  }
  const perMonHint = document.createElement('div');
  perMonHint.className = 'hint';
  perMonHint.textContent = 'Je-Monitor-Zuordnung: derzeit nur für den Screensaver einstellbar';
  refreshers.push(() => { perMonHint.hidden = !isWallpaperTab(); });
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Empfehlung: Render-Scale ≤ 66 % bei 3 Monitoren';
  refreshers.push(() => { hint.hidden = monitorModes[tab] !== 'span'; });
  mon.root.append(perMonHint, hint);
}

const perf = section('Leistung');
perf.grid.append(
  slider('Render scale', 'scale', {
    fmt: (v) => `${Math.round(parseFloat(v) * 100)} %`,
  }),
  toggle('perfadapt', 'Adaptive quality'),
);

// ------------------------------------------------- Tabs, Status, Autostart
const tabBar = document.createElement('div');
tabBar.className = 'tabs';
for (const [value, text] of [['saver', 'Screensaver'], ['wallpaper', 'Wallpaper']] as const) {
  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.textContent = text;
  btn.addEventListener('click', () => {
    tab = value;
    state = value === 'wallpaper' ? wallpaperState : saverState;
    refreshAll();
  });
  refreshers.push(() => { btn.classList.toggle('active', tab === value); });
  tabBar.append(btn);
}

// Status and autostart live in the wallpaper tab only: they concern the
// wallpaper alone — the screensaver is started by Windows itself (spec E4).
const status = document.createElement('div');
status.className = 'status';
const running = readWallpaperRunning(params);
status.textContent = running ? `● Läuft auf ${running} Monitoren` : '○ Wallpaper läuft nicht';
status.classList.toggle('on', running !== '');

const autostartRow = document.createElement('label');
autostartRow.className = 'toggle autostart';
const autostartBox = document.createElement('input');
autostartBox.type = 'checkbox';
autostartBox.checked = autostart;
// Applies immediately instead of on Save: the Run key is an OS setting, not one
// of the 33 options — same as the tray's toggle, which it mirrors.
autostartBox.addEventListener('change', () => {
  autostart = autostartBox.checked;
  post(`autostart:${autostart ? 'on' : 'off'}`);
});
autostartRow.append(autostartBox, document.createTextNode('Mit Windows starten'));

const wallpaperHead = document.createElement('div');
wallpaperHead.className = 'wp-head';
wallpaperHead.append(status, autostartRow);
refreshers.push(() => { wallpaperHead.hidden = !isWallpaperTab(); });

// ---------------------------------------------------------------- Buttons
const errorLine = document.createElement('div');
errorLine.className = 'error';
errorLine.textContent = 'Speichern abgelehnt — Werte prüfen';
errorLine.hidden = true;

// Host rejects the save all-or-nothing → dialog stays open, show the error.
(window as unknown as {
  chrome?: { webview?: { addEventListener?: (t: string, h: (ev: { data: unknown }) => void) => void } };
}).chrome?.webview?.addEventListener?.('message', (ev) => {
  if (ev.data === 'saveerror') errorLine.hidden = false;
});

const buttons = document.createElement('div');
buttons.className = 'buttons';
const save = document.createElement('button');
save.textContent = 'Save';
save.addEventListener('click', () => {
  errorLine.hidden = true;
  // Both tabs always go out, whichever one is visible — the host splits them by
  // prefix into two registry keys and never read-modify-writes the other's
  // (spec §5.2). The saver's set is always `saverState`, never the active tab.
  post(buildSaveMessage(
    saverState, monitorStates, monitorModes.saver, wallpaperState, monitorModes.wallpaper,
  ));
});
const cancel = document.createElement('button');
cancel.textContent = 'Cancel';
cancel.addEventListener('click', () => post('cancel'));
buttons.append(save, cancel);

const title = document.createElement('h1');
title.textContent = 'KURO // SETTINGS'; // serves both tabs now

const app = document.getElementById('app')!;
app.append(title, tabBar, wallpaperHead, lookRow, bild.root, crtFx.root, motion.root, term.root, display.root);
if (monitorSection) app.append(monitorSection);
app.append(perf.root, errorLine, buttons);

// Nothing above rendered tab-dependent state yet — the refreshers own that, so
// the first paint is the same code path as every later tab switch.
refreshAll();
