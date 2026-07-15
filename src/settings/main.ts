// Native settings dialog (Windows .scr `/c`) — renders the persistent options
// and posts them back to the Win32 host via window.chrome.webview.postMessage
// ("save:<query>" or "cancel"). Loads standalone in a browser too (styling /
// dev loop); without the host bridge the messages go to the console instead.
//
// Scene / preset lists come straight from the engine data — the retired C#
// ConfigForm duplicated them by hand.

import { SCENES } from '../engine/data/defaults';
import { PRESETS } from '../engine/data/presets';
import { buildSaveMessage, readInitial, type BoolKey } from './form-state';

const SPEEDS = ['slow', 'norm', 'fast'] as const;

// Same labels as the old WinForms dialog (docs/WINDOWS-INSTALL.md documents them).
const TOGGLES: ReadonlyArray<{ key: BoolKey; label: string }> = [
  { key: 'audio', label: 'Audio' },
  { key: 'bloom', label: 'Bloom' },
  { key: 'scan', label: 'Scanlines' },
  { key: 'crt', label: 'CRT simulation' },
  { key: 'crosshair', label: 'Crosshair' },
  { key: 'matrix', label: 'Matrix rain' },
  { key: 'trails', label: 'Afterburn' },
  { key: 'terminal', label: 'Story terminal' },
  { key: 'radar', label: 'Radar' },
];

const state = readInitial(new URLSearchParams(location.search));

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

function select(values: readonly string[], current: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.append(opt);
  }
  sel.value = values.includes(current) ? current : values[0];
  onChange(sel.value); // normalise unknown registry values to a real option
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const toggles = document.createElement('div');
toggles.className = 'toggles';
for (const { key, label } of TOGGLES) {
  const wrap = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state[key];
  box.addEventListener('change', () => (state[key] = box.checked));
  wrap.append(box, document.createTextNode(label));
  toggles.append(wrap);
}

const buttons = document.createElement('div');
buttons.className = 'buttons';
const save = document.createElement('button');
save.textContent = 'Save';
save.addEventListener('click', () => post(buildSaveMessage(state)));
const cancel = document.createElement('button');
cancel.textContent = 'Cancel';
cancel.addEventListener('click', () => post('cancel'));
buttons.append(save, cancel);

const title = document.createElement('h1');
title.textContent = 'KURO // SCREENSAVER SETTINGS';

document.getElementById('app')!.append(
  title,
  row('Scene', select(['random', ...SCENES], state.scene, (v) => (state.scene = v))),
  row('Color', select(Object.keys(PRESETS), state.preset, (v) => (state.preset = v))),
  row('Speed', select(SPEEDS, state.speed, (v) => (state.speed = v))),
  toggles,
  buttons,
);
