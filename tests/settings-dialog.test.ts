// @vitest-environment jsdom
//
// The settings dialog as the host actually opens it: main.ts is imported against
// a query string in the exact shape settings_window.cpp builds (BuildQueryString
// + monitormode + monitors-JSON + BuildWallpaperQuerySuffix + wpmonitormode +
// tab), and the save message is read off the webview bridge stub.
//
// Why through main.ts and not buildSaveMessage directly: main.ts is the ONLY
// production caller, it always passes both option sets, and every guard in
// form-state.ts is only worth what it is worth on THAT call. A test that
// composes a call main.ts never makes proves nothing — that is how the wmode
// sentinel could be destroyed on every save while two green tests watched.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORM_DEFAULTS,
  WALLPAPER_FORM_DEFAULTS,
  buildSaveMessage,
  type MonitorEntry,
  type SettingsFormState,
} from '../src/settings/form-state';

/** Laptop (primary) + external dock monitor, wmode as EffectiveWallpaperMode resolves it. */
const LAPTOP_AND_DOCK: MonitorEntry[] = [
  { id: 'LAPTOP_0', name: 'Laptop', w: 1920, h: 1080, portrait: false, primary: true,
    mode: 'on', scene: '', preset: '', wmode: 'on', wscene: '', wpreset: '' },
  { id: 'DELL_ABC1', name: 'Dell U2720Q', w: 3840, h: 2160, portrait: false, primary: false,
    mode: 'on', scene: '', preset: '', wmode: 'off', wscene: '', wpreset: '' },
];

/**
 * The host's page query. Query and save message share the key format (pinned
 * byte for byte in settings-form.test.ts and options_test.cpp), so the
 * serialiser doubles as the host stub here — with the two keys only the host
 * sends appended.
 */
function hostQuery(o: {
  saver?: Partial<SettingsFormState>;
  wallpaper?: Partial<SettingsFormState>;
  monitors?: MonitorEntry[];
  tab?: 'saver' | 'wallpaper';
} = {}): string {
  const query = buildSaveMessage(
    { ...FORM_DEFAULTS, ...o.saver }, [], 'per',
    { ...WALLPAPER_FORM_DEFAULTS, ...o.wallpaper }, 'per',
  ).slice('save:'.length);
  return `?${query}&monitors=${encodeURIComponent(JSON.stringify(o.monitors ?? []))}` +
    `&tab=${o.tab ?? 'saver'}`;
}

const posted: string[] = [];

/** Boots the real dialog against `query` — one module instance per test. */
async function openDialog(query: string): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, '', '/settings.html' + query);
  posted.length = 0;
  (window as unknown as { chrome: unknown }).chrome = {
    webview: { postMessage: (m: string) => posted.push(m), addEventListener: () => {} },
  };
  vi.resetModules(); // main.ts builds the whole dialog on import
  await import('../src/settings/main');
}

function clickTab(text: string): void {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('button.tab')]
    .find((b) => b.textContent === text);
  if (!btn) throw new Error(`no tab "${text}"`);
  btn.click();
}

function save(): string {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.buttons button')]
    .find((b) => b.textContent === 'Save');
  if (!btn) throw new Error('no save button');
  btn.click();
  const msg = posted.at(-1);
  if (!msg) throw new Error('save posted nothing');
  return msg;
}

/** The select of the `label` row inside `root` — cards and sections share the row shape. */
function selectIn(root: ParentNode, label: string): HTMLSelectElement {
  for (const rowEl of root.querySelectorAll('.row')) {
    if (rowEl.querySelector('label')?.textContent === label) {
      return rowEl.querySelector('select')!;
    }
  }
  throw new Error(`no select labelled "${label}"`);
}

/** A user picking a value — `change` is what the dialog's listeners react to. */
function pick(sel: HTMLSelectElement, value: string): void {
  sel.value = value;
  if (sel.value !== value) throw new Error(`no option "${value}"`);
  sel.dispatchEvent(new Event('change'));
}

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.mon-card')];

describe('settings dialog — per-monitor wallpaper trio', () => {
  beforeEach(() => { vi.resetModules(); });

  it('a save that never touched a monitor card leaves the wmode sentinel alone', async () => {
    // The /c path: Systemsteuerung → scene changed → Save, wallpaper tab never
    // seen. Spelling out m<N>wmode here writes WMode explicitly for every
    // monitor, and the host's "unset primary = on" rule can never fire again —
    // re-dock with the external as primary and the wallpaper runs nowhere.
    await openDialog(hostQuery({ monitors: LAPTOP_AND_DOCK, tab: 'saver' }));
    pick(selectIn(document.body, 'Scene'), 'void');
    const msg = save();
    expect(msg).toContain('&m0id=LAPTOP_0&m0mode=on');
    expect(msg).not.toContain('m0wmode');
    expect(msg).not.toContain('m1wmode');
  });

  it('sends the trio only for the cards the user actually touched', async () => {
    await openDialog(hostQuery({ monitors: LAPTOP_AND_DOCK, tab: 'wallpaper' }));
    pick(selectIn(cards()[1], 'Mode'), 'random');
    const msg = save();
    expect(msg).toContain('&m1wmode=random&m1wscene=&m1wpreset=');
    // Monitor 0 was never touched — its WMode stays unwritten, so the rule keeps
    // following the primary.
    expect(msg).not.toContain('m0wmode');
  });

  it('a card touched in the saver tab does not send the wallpaper trio', async () => {
    // Same cards serve both tabs; only the wallpaper tab speaks for WMode.
    await openDialog(hostQuery({ monitors: LAPTOP_AND_DOCK, tab: 'saver' }));
    pick(selectIn(cards()[0], 'Mode'), 'off');
    const msg = save();
    expect(msg).toContain('&m0id=LAPTOP_0&m0mode=off');
    expect(msg).not.toContain('m0wmode');
  });

  it('changing only the wallpaper tab globals sends no trio at all', async () => {
    await openDialog(hostQuery({ monitors: LAPTOP_AND_DOCK, tab: 'wallpaper' }));
    pick(selectIn(document.body, 'Scene'), 'void'); // the global Bild scene
    const msg = save();
    expect(msg).toContain('&wpscene=void');
    expect(msg).not.toContain('m0wmode');
    expect(msg).not.toContain('m1wmode');
  });

  it('a card touched in the wallpaper tab keeps its trio across a tab switch', async () => {
    await openDialog(hostQuery({ monitors: LAPTOP_AND_DOCK, tab: 'wallpaper' }));
    pick(selectIn(cards()[0], 'Mode'), 'scene');
    pick(selectIn(cards()[0], 'Scene'), 'void');
    clickTab('Screensaver'); // refreshAll repoints every card accessor
    pick(selectIn(cards()[0], 'Mode'), 'off'); // the saver's mode, not the wallpaper's
    const msg = save();
    expect(msg).toContain('&m0id=LAPTOP_0&m0mode=off&m0scene=&m0preset=');
    expect(msg).toContain('&m0wmode=scene&m0wscene=void&m0wpreset=');
  });
});

describe('settings dialog — the inactive tab is normalised too', () => {
  beforeEach(() => { vi.resetModules(); });

  it('saves from the wallpaper tab with a poisoned saver enum in the registry', async () => {
    // Speed=warp (hand edit / third-party writer — the model ReadNumber already
    // defends the numerics against). Opened on the wallpaper tab, the saver's
    // selects never render, so nothing normalised `speed` — and since one save
    // carries both halves, the host rejected it all-or-nothing: BOTH tabs
    // unsavable until someone happens to click the Screensaver tab once.
    await openDialog(hostQuery({ saver: { speed: 'warp' }, tab: 'wallpaper' }));
    const msg = save();
    expect(msg).toContain('&speed=norm');
    expect(msg).not.toContain('warp');
  });

  it('normalises every enum of the inactive half, not just the ones on screen', async () => {
    await openDialog(hostQuery({
      saver: { altitude: 'orbit', fog: 'soup', weather: 'hail', bootspeed: 'instant' },
      wallpaper: { speed: 'warp', termlayout: 'fullscreen' },
      tab: 'wallpaper',
    }));
    const msg = save();
    expect(msg).toContain(`&altitude=${FORM_DEFAULTS.altitude}`);
    expect(msg).toContain(`&fog=${FORM_DEFAULTS.fog}`);
    expect(msg).toContain(`&weather=${FORM_DEFAULTS.weather}`);
    expect(msg).toContain(`&bootspeed=${FORM_DEFAULTS.bootspeed}`);
    expect(msg).toContain(`&wpspeed=${WALLPAPER_FORM_DEFAULTS.speed}`);
    expect(msg).toContain(`&wptermlayout=${WALLPAPER_FORM_DEFAULTS.termlayout}`);
  });
});
