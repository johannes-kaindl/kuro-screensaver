// Screensaver-mode entry — auto-starts the engine with no user gesture.
//
// Used by the native OS-screensaver wrappers (macOS .saver / Windows .scr),
// which load this page in an embedded WebView and inject options as URL
// query params:
//   ?scene=random|terrain|city|rift|tunnel|void|wreckage|matrix  (default: random)
//   ?preset=<colour-preset-key>                                  (default: toxic-haze)
//   ?audio=on|off                                                (default: off)
//   ?seed=<int>                                                  (pins settings.seedLock; render-sequence.mjs)
//   ?hud=minimal|tactical|full|off                              (named HUD preset; off = no readouts, no control bar)
//   ?ping=on|off                                                 (radar ping ring)
//   plus the persistent FX/HUD/speed toggles handled in params.ts
//   (?speed, ?bloom, ?trails, ?scan, ?crt, ?matrix, ?terminal, ?radar, ?crosshair)
//
// Unlike the demo landing page (src/main.ts), there is no Start button —
// the controller opens immediately. In a real screensaver the OS exits on
// any input, so live hotkeys are disabled. Audio defaults off because an
// AudioContext cannot start without a user gesture in a screensaver.

import '../host-web/obsidian-dom-polyfill';
import { ScreensaverController } from '../engine/controller';
import { WebHost } from '../host-web/persistence';
import { makePluginShim } from '../host-web/plugin-shim';
import { SCENES, type SceneId } from '../engine/data/defaults';
import { PRESETS } from '../engine/data/presets';
import { applyParamOverrides } from './params';

const params = new URLSearchParams(location.search);

const sceneParam = params.get('scene') ?? 'random';
// The screensaver film opens on a calm ROUTINE scene — never the matrix fx scene
// (a functioning CORP terminal wouldn't boot into the rain).
const START_SCENES: SceneId[] = ['terrain', 'city'];
const scene: SceneId =
  sceneParam !== 'random' && SCENES.includes(sceneParam as SceneId)
    ? (sceneParam as SceneId)
    : START_SCENES[Math.floor(Math.random() * START_SCENES.length)];

// Color preset — ?preset=<key>, validated against PRESETS. One rendered
// .saver per preset, so the video pipeline drives this per build.
const presetParam = params.get('preset') ?? '';
const preset = presetParam in PRESETS ? presetParam : 'toxic-haze';

// Story duration scaling — ?storyScale=<n>. The video render uses ~0.33 for a
// ~2-3 min loop; default 1 is the full live shift. Clamped to [0.02, 1].
const scaleParam = parseFloat(params.get('storyScale') ?? '');
const storyScale = Number.isFinite(scaleParam)
  ? Math.min(1, Math.max(0.02, scaleParam))
  : 1;

const audioOn = params.get('audio') === 'on';

// Reactive-world tuning — ?threat=<0..1> pins the narrative threat level so each
// escalation state (fog/CRT/storm) is screenshot-able without the 6-9 min cycle.
const threatRaw = parseFloat(params.get('threat') ?? '');
const reactiveThreat = Number.isFinite(threatRaw)
  ? Math.min(1, Math.max(0, threatRaw)) : undefined;

const host = new WebHost({
  activePreset: preset,
  vaultKanji: PRESETS[preset].kanji,
  overrides: {
    // Force the explicit preset path. Default 'matchAspect' takes precedence
    // in resolveColor() and, with no Obsidian data-aspect present, falls back
    // to a time-of-day palette — which would ignore ?preset= entirely.
    aspectPaletteMode: 'inherit',
    colorMode: 'kuro-preset',
    colorPreset: preset,
    defaultScene: scene,
    liveHotkeysEnabled: false,
    // perfAdapt is user-controlled via ?perfadapt= (params.ts); without the
    // param this entry forces it OFF below (e9e2719 browser regression guard).
  },
});

// `overrides` is Partial<ScreensaverSettings> — nested objects can't be set
// partially through it without a type error, so toggle audio directly on the
// merged settings (deepMerge has already run in the WebHost constructor).
host.getSettings().sound.master = audioOn;
// The screensaver IS the procedural film: run the phase-driven scene itinerary by
// default (Brick C film mode). prefers-reduced-motion turns it back off in open().
// Set BEFORE applyParamOverrides so ?autocycle=off wins.
host.getSettings().autoCycle.on = true;
// Persistent user toggles bridged from the native config dialog (speed, FX, HUD,
// matrix-rain + the full v0.10 set incl. ?ntsc/?halation/?weather/?kiosk).
// See src/screensaver/params.ts — pinned by screensaver-params.test.ts.
applyParamOverrides(host.getSettings(), params);

// Plain-browser guardrails. The Windows host ALWAYS pins ?perfadapt and ?kiosk
// in its query (options.cpp BuildQueryString), so both branches only fire for
// the direct screensaver.html consumer:
//  • perfAdapt — e9e2719 ("stop perfAdapt killing AFTER effect") disabled it
//    for this entry because it silently kills user-enabled AFTER:TRAIL/BURN
//    seconds after enabling (and since v0.10 also downscales the resolution),
//    and the control bar has no perfadapt toggle to opt out. Keep the browser
//    on that behaviour; hosts opt in explicitly via ?perfadapt=on.
if (!params.has('perfadapt')) host.getSettings().perfAdapt = false;
//  • kiosk — ?kiosk=on mutates the settings tree, which open() persists to
//    localStorage (stats write); a later param-less visit would restart in
//    kiosk mode (no control bar, no cursor, no ×) with no in-page way out.
//    Heal any persisted kiosk residue when the param is absent.
if (!params.has('kiosk')) {
  const s = host.getSettings();
  if (s.kioskMode) { s.kioskMode = false; s.hud.controlBar = true; }
}

const controller = new ScreensaverController(makePluginShim(host));

// Host→page power bridge (Windows wallpaper mode): the C++ host posts
// 'power:hidden' | 'power:frozen' | 'power:animating:<fps>' as WebMessage strings
// when desktop visibility / power state changes. Absent in a plain browser → no-op.
(window as any).chrome?.webview?.addEventListener?.('message', (ev: { data: unknown }) => {
  const m = typeof ev.data === 'string' ? ev.data : '';
  if (!m.startsWith('power:')) return;
  const [, state, fpsRaw] = m.split(':');
  if (state === 'hidden' || state === 'frozen' || state === 'animating') {
    controller.applyPowerState(state, fpsRaw ? parseInt(fpsRaw, 10) : undefined);
  }
});

// In a native host (macOS .app / Windows .scr), the engine's close button (×)
// must quit the whole app. Otherwise close() only tears down the overlay and
// leaves a black window with no way out. Bridge close() to the native host;
// in a plain browser both message channels are absent, so this is a no-op.
const origClose = controller.close.bind(controller);
controller.close = async () => {
  const w = window as any;
  w.webkit?.messageHandlers?.kuroExit?.postMessage?.('exit'); // macOS WKWebView
  w.chrome?.webview?.postMessage?.('exit');                   // Windows WebView2
  await origClose();
};

// Harness hooks (tuning): ?event=intrusion|flash|surge fires one discrete reaction;
// ?transition=<from>-<to> opens on <from> then plays one warp transition to <to>
// (mirrors ?threat= for the continuous arc).
const eventParam = params.get('event');
const transParam = params.get('transition');
const transFrom = transParam?.split('-')[0];
const transTo = transParam?.split('-')[1];
const openScene: SceneId =
  transFrom && SCENES.includes(transFrom as SceneId) ? (transFrom as SceneId) : scene;
void controller.open({ scene: openScene, storyScale, reactiveThreat }).then(() => {
  if (eventParam === 'intrusion') controller.engine?.bus.emit({ kind: 'intrusion', intensity: 2.0 });
  else if (eventParam === 'flash' || eventParam === 'surge') controller.reactiveWorld?.pulse(eventParam);
  if (transTo && SCENES.includes(transTo as SceneId)) {
    setTimeout(() => controller.switchScene(transTo as SceneId), 1500);
  }
});

// DEV-only: expose the controller so the crash-preview render script can
// trigger playCrash() directly instead of waiting for a full ~8-min shift.
// Stripped from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { __kuro?: unknown }).__kuro = controller;
}
