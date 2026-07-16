// Native settings dialog (Windows .scr `/c`) — renders the full v0.10 option
// set (looks, CRT sliders, motion/story, monitors, performance) and posts it
// back to the Win32 host via window.chrome.webview.postMessage
// ("save:<query>" or "cancel"; host answers "saveerror" when it rejects).
// Loads standalone in a browser too (styling / dev loop); without the host
// bridge the messages go to the console instead.
//
// Scene / preset / look lists come straight from the engine data — the retired
// C# ConfigForm duplicated them by hand.

import { SCENES } from '../engine/data/defaults';
import { LOOKS } from '../engine/data/looks';
import { PRESETS } from '../engine/data/presets';
import {
  buildSaveMessage,
  readInitial,
  readMonitors,
  type BoolKey,
  type MonitorEntry,
  type MonitorFormState,
  type StringKey,
} from './form-state';

const SPEEDS = ['slow', 'norm', 'fast'] as const;

const params = new URLSearchParams(location.search);
const state = readInitial(params);
const monitors = readMonitors(params);

// MonitorMode travels as its own query param (not part of the 33-key format);
// echoed back verbatim in the save message when non-empty.
let monitorMode = params.get('monitormode') ?? '';
if (monitors.length >= 2 && monitorMode !== 'per' && monitorMode !== 'span') monitorMode = 'per';

// Per-monitor overrides start neutral; the host applies its own defaults.
const monitorStates: MonitorFormState[] = monitors.map((m) => ({
  id: m.id, mode: 'on', scene: '', preset: '',
}));

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
  const current = get();
  sel.value = options.some((o) => o.value === current) ? current : options[0].value;
  set(sel.value); // normalise unknown registry values to a real option
  sel.addEventListener('change', () => set(sel.value));
  refreshers.push(() => { sel.value = get(); });
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
// registry value is only replaced once the user actually drags.
function slider(
  labelText: string, key: StringKey,
  min: number, max: number, step: number,
  o: { resetsLook?: boolean; fmt?: (v: string) => string } = {},
): HTMLElement {
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
  slider('Intensity', 'crtintensity', 0, 1, 0.01, { resetsLook: true }),
  slider('Curvature', 'curvature', 0, 0.25, 0.001, { resetsLook: true }),
  slider('Aperture', 'aperture', 0, 0.5, 0.01, { resetsLook: true }),
  slider('Bloom', 'bloomstrength', 0, 3, 0.1, { resetsLook: true }),
  slider('Trails', 'trailsamount', 0.5, 0.95, 0.01, { resetsLook: true }),
  slider('NTSC', 'ntsc', 0, 1, 0.01, { resetsLook: true }),
  slider('Halation', 'halation', 0, 0.6, 0.01, { resetsLook: true }),
  toggle('scan', 'Scanlines'),
  toggle('crt', 'CRT simulation'),
  toggle('bloom', 'Bloom'),
  toggle('trails', 'Afterburn'),
);

const motion = section('Bewegung & Story');
motion.grid.append(
  slider('Bank', 'bank', 0, 2, 0.1),
  toggle('reactive', 'Reactive world'),
  toggle('autocycle', 'Auto-cycle'),
  slider('Cycle (min)', 'cyclemin', 0.5, 10, 0.5),
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
  toggle('audio', 'Audio'),
);

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
      radio.checked = monitorMode === value;
      radio.addEventListener('change', () => {
        if (radio.checked) monitorMode = value;
        refreshAll();
      });
      refreshers.push(() => { radio.checked = monitorMode === value; });
      wrap.append(radio, document.createTextNode(text));
      radios.append(wrap);
    }
    radios.style.gridColumn = '1 / -1';
    mon.grid.append(radios);
  }
  monitors.forEach((entry, i) => mon.grid.append(monitorCard(entry, monitorStates[i])));
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Empfehlung: Render-Scale ≤ 66 % bei 3 Monitoren';
  hint.hidden = monitorMode !== 'span';
  refreshers.push(() => { hint.hidden = monitorMode !== 'span'; });
  mon.root.append(hint);
}

const perf = section('Leistung');
perf.grid.append(
  slider('Render scale', 'scale', 0.25, 1, 0.01, {
    fmt: (v) => `${Math.round(parseFloat(v) * 100)} %`,
  }),
  toggle('perfadapt', 'Adaptive quality'),
);

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
  post(buildSaveMessage(state, monitorStates, monitorMode));
});
const cancel = document.createElement('button');
cancel.textContent = 'Cancel';
cancel.addEventListener('click', () => post('cancel'));
buttons.append(save, cancel);

const title = document.createElement('h1');
title.textContent = 'KURO // SCREENSAVER SETTINGS';

const app = document.getElementById('app')!;
app.append(title, lookRow, bild.root, crtFx.root, motion.root, term.root, display.root);
if (monitorSection) app.append(monitorSection);
app.append(perf.root, errorLine, buttons);
