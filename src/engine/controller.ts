// Screensaver controller — owns overlay lifecycle, hotkeys, fullscreen, modes.
//
// Host coupling: this file expects a Plugin-shaped host (settings tree +
// saveData). In the Obsidian plugin that's the actual `Plugin` instance; in
// the standalone web build it's a shim around WebHost (see
// `src/host-web/plugin-shim.ts`). The shape is declared locally so the engine
// stays free of `from 'obsidian'`.
import { Engine, ALL_SCENES } from './engine/core';
import { resolveColor, readKuroFxDefaults } from './engine/color';
import { Hud } from './hud';
import { showBoot } from './hud/boot';
import { AudioLayer } from './audio/synth';
import { DICT } from './data/dictionary';
import type { ScreensaverSettings, SceneId } from './data/defaults';
import { HUD_PRESETS, SCENES, SCENE_LABELS } from './data/defaults';
import { PRESETS } from './data/presets';

export interface HostPlugin {
  settings: {
    screensaver: ScreensaverSettings;
    activePreset?: string;
    vaultKanji?: string;
    vaultKanjiCustom?: string;
    [k: string]: any;
  };
  saveData: (data: any) => Promise<void>;
  app?: { workspace?: { getActiveFile?: () => { basename?: string } | null } };
}
import { NarrativeRunner } from './terminal/narrative';
import { mkRng, freshSeed } from './engine/rng';
import { CrtSim } from './fx/crt-sim';

export interface OverlayState {
  open: boolean;
  embed: boolean;
}

export class ScreensaverController {
  state: OverlayState = { open: false, embed: false };

  overlay: HTMLElement | null = null;
  engine: Engine | null = null;
  hud: Hud | null = null;
  audio: AudioLayer | null = null;
  narrative: NarrativeRunner | null = null;
  crt: CrtSim | null = null;

  private autoCycleTimer = 0;
  private idleTimer = 0;
  private lastActivity = 0;
  private dayNightT0 = 0;
  /** The active scene's own fog density, captured on load — the base the
   *  day/night cycle and fogMode work relative to. */
  private baseFogDensity = 0.01;
  private openedAt = 0;
  private statsSaveDebounce = 0;

  constructor(public plugin: HostPlugin) {
    this.startIdleWatcher();
  }

  get s(): ScreensaverSettings {
    return this.plugin.settings.screensaver;
  }

  /** Enrich with theme-derived defaults if fxInheritFromTheme is set. */
  private effectiveSettings(): ScreensaverSettings {
    const s: ScreensaverSettings = JSON.parse(JSON.stringify(this.s));
    if (s.fxInheritFromTheme) {
      const k = readKuroFxDefaults();
      s.fx.bloom.strength = Math.max(0.4, k.glowIntensity * 4);
      s.fx.scan.opacity = Math.max(0.02, k.scanlineOpacity * 5);
      s.fx.vignette.strength = Math.max(0.15, k.vignetteStrength + 0.15);
    }
    return s;
  }

  applyHudPreset(s: ScreensaverSettings): ScreensaverSettings {
    if (s.hudPreset === 'custom') return s;
    const p = HUD_PRESETS[s.hudPreset];
    if (p) Object.assign(s.hud, p);
    return s;
  }

  async open(opts: { embed?: boolean; scene?: SceneId } = {}) {
    if (this.state.open) return;
    this.state.open = true;
    this.state.embed = !!opts.embed;

    const s = this.applyHudPreset(this.effectiveSettings());
    // v1.1 (Live-Test 2026-05-11): aspectPaletteMode === 'matchAspect'
    // makes resolveColor read `data-aspect` off <html> and pick the matching
    // signal preset. The lookup itself lives in engine/color.ts; the explicit
    // mention here is a traceability anchor so anyone tracing palette flow
    // from the controller sees the data-aspect dependency.
    const color = resolveColor(s);
    const scene: SceneId = opts.scene || s.defaultScene;

    // Build overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'kuro-screensaver-overlay';
    this.overlay.setAttribute('style',
      `position:fixed;inset:0;z-index:9999;background:#000;` +
      (this.state.embed ? `opacity:${s.embed.opacity};` : '') +
      `cursor:none;overflow:hidden;color:${color.css}`);
    document.body.appendChild(this.overlay);

    // Engine
    this.engine = new Engine(this.overlay, s, color);

    // HUD
    this.hud = new Hud(this.overlay, s, color, this.engine);

    // Vault kanji — aspect-aware (v1.2, 2026-05-13).
    //   Resolution order: explicit user override (vaultKanjiCustom) wins,
    //   then the current vault-aspect's signature kanji (護/軍/監/霊),
    //   then the global vaultKanji setting, then empty.
    //   Aspect-mapping mirrors KSP: Shugo=護(guard), Gunshi=軍(strategy),
    //   Kantoku=監(oversight), Sensei=霊(spirit).
    const kuroSettings = (this.plugin as any).settings;
    const ASPECT_KANJI: Record<string, string> = {
      shugo: '護', gunshi: '軍', kantoku: '監', sensei: '霊',
    };
    const liveAspect = (document.documentElement.getAttribute('data-aspect') || '').toLowerCase();
    const aspectKanji = ASPECT_KANJI[liveAspect];
    const k = kuroSettings.vaultKanjiCustom
           || aspectKanji
           || kuroSettings.vaultKanji
           || '';
    this.hud.setKanji(k);

    // Audio
    this.audio = new AudioLayer(s);
    if (!this.state.embed) this.audio.start();

    // Mouse listener for control bar + parallax
    if (!this.state.embed) {
      // ── Mouse handlers ──
      // Mousemove: always reveal cursor + open control bar (auto-hides per setting),
      //            also drives parallax with a top-deadzone so the user can reach the bar.
      // Click outside the bar: dismiss the bar immediately (alternative to waiting for timeout).
      this.overlay.addEventListener('mousemove', (ev) => {
        this.overlay!.style.cursor = '';
        clearTimeout(this.cursorHideTimer);
        this.cursorHideTimer = window.setTimeout(() => {
          if (this.overlay) this.overlay.style.cursor = 'none';
        }, 2500);

        if (s.hud.controlBar && this.hud) {
          this.hud.showControlBar(this.s.controlBarAutoHideSec);
        }

        if (s.parallax && this.engine) {
          this.engine.parallaxEnabled = true;
          if (ev.clientY < 80) {
            this.engine.parallaxTargetX = 0;
            this.engine.parallaxTargetY = 0;
          } else {
            this.engine.parallaxTargetX = (ev.clientX / window.innerWidth) * 2 - 1;
            this.engine.parallaxTargetY = (ev.clientY / window.innerHeight) * 2 - 1;
          }
        }
      });

      // Click anywhere in the overlay: if the click is NOT on the bar (which has
      // its own button handlers using stopPropagation), hide the bar.
      this.overlay.addEventListener('click', () => {
        if (this.hud?.isControlBarVisible()) this.hud.hideControlBar();
      });

      // v1.2 — Touch parity for Mobile (Obsidian iOS).
      //   WebView mousemove is not generated for touch — without explicit
      //   touchstart/touchmove handlers the control bar never reveals on
      //   phone. We mirror the mouse code paths so the bar shows on first
      //   tap and parallax follows touch position.
      //   Also: first touch is used to unlock the AudioContext (iOS Safari
      //   only resumes audio after a user gesture).
      const handleTouch = (ev: TouchEvent) => {
        const t = ev.touches[0] || ev.changedTouches[0];
        if (!t) return;
        if (s.hud.controlBar && this.hud) {
          this.hud.showControlBar(this.s.controlBarAutoHideSec);
        }
        if (s.parallax && this.engine) {
          this.engine.parallaxEnabled = true;
          if (t.clientY < 80) {
            this.engine.parallaxTargetX = 0;
            this.engine.parallaxTargetY = 0;
          } else {
            this.engine.parallaxTargetX = (t.clientX / window.innerWidth) * 2 - 1;
            this.engine.parallaxTargetY = (t.clientY / window.innerHeight) * 2 - 1;
          }
        }
        // Unlock audio on first user gesture (iOS WKWebView requirement).
        // Cheap to call repeatedly — resume() on a running context is a no-op.
        try { (this.audio as any)?.ctx?.resume?.(); } catch {}
      };
      this.overlay.addEventListener('touchstart', handleTouch, { passive: true });
      this.overlay.addEventListener('touchmove', handleTouch, { passive: true });

      if (s.hud.controlBar) this.buildControlBar(s);
    }
    if (s.hud.controlBar && !this.state.embed) {
      // Show briefly on first open as orientation; auto-hides per setting.
      this.hud.showControlBar(this.s.controlBarAutoHideSec);
    }

    // Keyboard close + live hotkeys
    if (!this.state.embed) {
      document.addEventListener('keydown', this.onKeyDown, { capture: true });
    }

    // Fullscreen (only non-embed)
    if (!this.state.embed) {
      try { await this.overlay.requestFullscreen(); } catch { /* user denied or unsupported */ }
    }

    // Power-on flash
    if (s.fx.powerOn.on) this.hud.flashPowerOn();

    // Boot sequence
    if (s.bootEnabled && !this.state.embed) {
      this.audio?.bootBeep();
      await showBoot(this.overlay, scene, s.bootSpeed);
    }

    // Init scene
    this.engine.loadScene(scene);
    this.baseFogDensity = (this.engine.scene.fog as any)?.density ?? 0.01;
    const labels = DICT.MODE_LABELS[scene];
    this.hud.setMode(labels[0]);
    this.hud.setTri(this.engine.getSceneObj()?.triCount || '----');
    this.hud.flashSceneLabel(scene);

    // Stats
    this.s.stats.scenesLoaded = (this.s.stats.scenesLoaded || 0) + 1;
    this.s.stats.perScene[scene] = (this.s.stats.perScene[scene] || 0) + 1;
    void this.plugin.saveData(this.plugin.settings);

    // CRT signal-degradation simulator — fires h-tear, brightness flicker,
    // chroma spikes, scanline pulse, hum bar, interlace flicker, etc. on top
    // of the rendered canvas. Single intensity controls all (replaces fx.glitch).
    this.crt = new CrtSim(this.engine.canvas, this.overlay, this.engine, s, this.hud.scanlines);
    this.crt.start();

    // Engine start + HUD loop start
    this.engine.start();
    const t0 = performance.now();
    this.dayNightT0 = t0;
    this.openedAt = Date.now();
    this.hud.startLoop(t0);

    // Narrative terminal: instantiate runner that drives the bottom terminal
    // through a CORP operator's shift (routine → intrusion → alarm → panic → reset).
    if (s.narrativeTerminal && s.hud.terminal && !this.state.embed) {
      this.narrative = new NarrativeRunner({
        hud: this.hud,
        promptInputEl: this.hud.promptInputEl,
        promptHandleEl: this.hud.promptHandleEl,
        // End of shift → diegetic CRT crash, then reboot into a fresh shift.
        onShiftEnd: (clearScreen) =>
          this.crt?.playCrash(clearScreen) ?? Promise.resolve(),
      }, mkRng(freshSeed()));
      this.narrative.start();
    }

    // Auto-cycle
    if (s.autoCycle.on && !this.state.embed) {
      this.autoCycleTimer = window.setInterval(() => this.cycleScene(), s.autoCycle.intervalMin * 60_000);
    }

    // Weather: apply fog density override + dust toggle
    const fog = this.engine!.scene.fog as any;
    if (fog) {
      switch (s.weather) {
        case 'clear':     fog.density = 0.004; break;
        case 'light-fog': /* scene default */   break;
        case 'heavy-fog': fog.density = (fog.density || 0.01) * 2.5; break;
        case 'storm':
          // Storm flicker: occasional bloom-strength surge
          (this as any)._stormInterval = window.setInterval(() => {
            if (this.engine && Math.random() < 0.06) {
              const bp = this.engine.bloomPass;
              const orig = bp.strength;
              bp.strength = orig * 2.4;
              setTimeout(() => { if (this.engine) this.engine.bloomPass.strength = orig; }, 80 + Math.random() * 60);
            }
          }, 400);
          break;
        case 'dust':      fog.density = (fog.density || 0.01) * 1.6; break;
      }
    }

    // Performance auto-adapt: monitor FPS, downgrade FX when sustained low
    if (s.perfAdapt) {
      let lowFrames = 0;
      (this as any)._perfInterval = window.setInterval(() => {
        if (!this.engine) return;
        const fps = this.engine.fps;
        if (fps && fps < 40) lowFrames++; else lowFrames = 0;
        if (lowFrames >= 3) {
          // Reduce trails + bloom strength
          this.engine.bloomPass.strength = Math.max(0.4, this.engine.bloomPass.strength * 0.85);
          if (this.engine.trailPass.enabled) this.engine.trailPass.enabled = false;
          if (this.engine.burnPass.enabled) this.engine.burnPass.enabled = false;
          lowFrames = 0;
        }
      }, 1500);
    }

    // v1.2 — Real-note flash (Live-Test 2026-05-13 cool-idea).
    //   Every ~60s with a 12% chance, slip the currently active vault
    //   note title into the narrative terminal as if it were a CORP-OS
    //   command. Subtle enough that the operator-narrative still feels
    //   coherent, but means the screensaver gestures at *your* work.
    //   Skipped if narrative-terminal is off or terminal-strip hidden.
    (this as any)._noteFlashInterval = window.setInterval(() => {
      if (!this.hud || !s.narrativeTerminal || !s.hud.terminal) return;
      if (Math.random() > 0.12) return;
      const file = (this.plugin as any).app?.workspace?.getActiveFile?.();
      const name = file?.basename;
      if (!name) return;
      const out = this.hud.termOut;
      const el = document.createElement('div');
      el.className = 'tl';
      el.textContent = `$ open "${name}"`;
      out.appendChild(el);
      // Keep scrollback bounded — narrative cleans its own, this is a guest.
      while (out.children.length > 40) out.firstChild?.remove();
    }, 60_000);

    // v1.2 — Idle-drift mode (Live-Test 2026-05-13 cool-idea).
    //   After ~5 minutes without user interaction, slowly bias the engine
    //   toward "drift" — current speed-multiplier eases toward 0.55, the
    //   ambient hum gets a touch louder, and the narrative terminal pauses.
    //   On any touch / mousemove the state restores within a few seconds.
    //   Subtle by design — meant to feel like the screensaver settles into
    //   contemplation, not that it broke.
    let lastInteractionT = performance.now();
    const driftHandler = () => { lastInteractionT = performance.now(); };
    this.overlay!.addEventListener('mousemove', driftHandler, { passive: true });
    this.overlay!.addEventListener('touchstart', driftHandler, { passive: true });
    this.overlay!.addEventListener('touchmove', driftHandler, { passive: true });
    let inDrift = false;
    let preDriftBloom = 0, preDriftFog = 0;
    (this as any)._driftInterval = window.setInterval(() => {
      if (!this.engine) return;
      const idleMs = performance.now() - lastInteractionT;
      const shouldDrift = idleMs > 5 * 60_000;
      const fog = this.engine.scene.fog as any;
      if (shouldDrift && !inDrift) {
        inDrift = true;
        // Visual drift: gentler bloom + thicker fog gives a "settling" feel
        preDriftBloom = this.engine.bloomPass.strength;
        preDriftFog = fog?.density ?? 0.01;
        this.engine.bloomPass.strength = preDriftBloom * 0.65;
        if (fog) fog.density = preDriftFog * 1.45;
        if (this.audio?.master) this.audio.master.gain.value = Math.min(1.0, this.s.sound.volume * 1.3);
        this.audio?.pauseSoundscape?.();
        this.narrative?.pause();
      } else if (!shouldDrift && inDrift) {
        inDrift = false;
        this.engine.bloomPass.strength = preDriftBloom;
        if (fog) fog.density = preDriftFog;
        if (this.audio?.master) this.audio.master.gain.value = this.s.sound.volume;
        this.audio?.resumeSoundscape?.();
        this.narrative?.resume();
      }
    }, 5_000);

    // Day/night cycle: subtle modulation of bloom strength + (in fogMode
    // 'auto' only) fog density. fogMode 'clear'/'dense' set a fixed density
    // that this loop leaves alone.
    if (s.dayNightCycle.on) {
      const periodMs = s.dayNightCycle.periodMin * 60_000;
      const baseBloom = this.engine!.bloomPass.strength;
      (this as any)._dayNightInterval = window.setInterval(() => {
        const phase = ((Date.now() - this.dayNightT0) % periodMs) / periodMs;
        const cycleVal = Math.sin(phase * Math.PI * 2);
        if (this.engine) {
          this.engine.bloomPass.strength = baseBloom * (1 + cycleVal * 0.35);
          if (this.s.fogMode === 'auto' && this.engine.scene.fog) {
            (this.engine.scene.fog as any).density = this.baseFogDensity * (1 + cycleVal * 0.4);
          }
        }
      }, 250);
    }

    // Apply the chosen fog mode (clear/dense set a fixed density now; auto
    // hands fog back to the day/night loop above).
    this.applyFogMode();
  }

  /** Fog / view-distance control — see ScreensaverSettings.fogMode. */
  private applyFogMode() {
    const fog = this.engine?.scene.fog as any;
    if (!fog) return;
    switch (this.s.fogMode) {
      case 'clear': fog.density = this.baseFogDensity * 0.45; break;
      case 'dense': fog.density = this.baseFogDensity * 2.2;  break;
      case 'auto':
      default:      fog.density = this.baseFogDensity;        break;
    }
  }

  private cursorHideTimer = 0;

  private fpsBarEl: HTMLSpanElement | null = null;
  private fpsBarTimer = 0;

  /**
   * Live control bar layout (left → right):
   *   SCENE | SPD | COLOR | FX (5 primary toggles) | FX+ (6 advanced toggles) | FPS
   *
   * Each click stops propagation to prevent the global "any-key/click closes" path
   * from terminating the screensaver. The bar is rebuilt on every state change so
   * `.on` highlights stay in sync.
   */
  private buildControlBar(s: ScreensaverSettings) {
    if (!this.hud) return;
    const bar = this.hud.controlBar;
    bar.innerHTML = '';

    const lbl = (text: string) => {
      const span = document.createElement('span'); span.className = 'ks-lbl'; span.textContent = text; bar.appendChild(span);
    };
    const sep = () => { const d = document.createElement('div'); d.className = 'ks-sep'; bar.appendChild(d); };
    const btn = (text: string, active: boolean, fn: () => void, title = '') => {
      const b = document.createElement('button');
      b.className = 'ks-btn' + (active ? ' on' : '');
      b.textContent = text;
      if (title) b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.appendChild(b); return b;
    };

    // CLOSE + AUDIO at the very front of the bar
    //
    // v1.2 — Live-Test 2026-05-13: with all FX/COLOR/SCENE/FX+ buttons, the
    // bar overflows on the default desktop width and `flex-wrap:wrap` pushes
    // the last items onto a 2nd row. Audio and Close had ended up on that
    // 2nd row — small, easy to miss. Pinning them first keeps them in row 1.
    // If a wrap is needed it now drops the less-critical FX+ block (vignette,
    // ping, noise) onto row 2 instead.
    const closeBtn = btn('×', false, () => { void this.close(); }, 'Close screensaver');
    closeBtn.style.cssText += 'color:rgba(255,200,200,.85);font-size:14px;line-height:1;padding:2px 9px;';

    btn(s.sound.master ? '🔊' : '🔇', s.sound.master, () => {
      this.s.sound.master = !this.s.sound.master;
      if (!this.s.sound.master) {
        this.audio?.dispose();
      } else {
        this.audio = new AudioLayer(this.effectiveSettings());
        this.audio.start();
      }
      this.saveSettingsDebounced();
      this.rebuildBar();
    }, this.s.sound.master ? 'Audio on (toggle)' : 'Audio muted (toggle)');

    // SCENE
    sep(); lbl('SCENE');
    SCENES.forEach(sc => btn(SCENE_LABELS[sc], this.engine?.currentScene === sc, () => this.switchScene(sc)));

    // SPD
    sep(); lbl('SPD');
    (['slow', 'norm', 'fast'] as const).forEach(sp => btn(
      sp === 'slow' ? '▶' : sp === 'norm' ? '▶▶' : '▶▶▶',
      s.speed === sp,
      () => {
        // v1.1 — Live-Test 2026-05-11. Persist + push to the running engine.
        // Without the engine.setSpeed() call, scenes keep reading their
        // captured ctx.settings reference and the button click is a no-op.
        this.s.speed = sp;
        this.engine?.setSpeed(sp);
        this.saveSettingsDebounced();
        this.rebuildBar();
      },
    ));

    // COLOR — cycle through Kuro presets via colored dots
    //
    // v1.2 — Live-Test 2026-05-13 (color-button no-op fix):
    //   In v1.1 we introduced `aspectPaletteMode: 'matchAspect'` as the new
    //   default — resolveColor() reads `html[data-aspect]` and overrides
    //   colorMode/colorPreset. That means a click on the COLOR-button set the
    //   preset but resolveColor() then ignored it and returned the aspect-
    //   matched color → user-visible no-op.
    //   Fix: an explicit user pick on the COLOR-button is interpreted as
    //   override intent, so we flip aspectPaletteMode to 'inherit'. The user
    //   can re-enable matchAspect from the settings tab.
    sep(); lbl('COLOR');
    const presetKeys = Object.keys(PRESETS);
    presetKeys.forEach(key => {
      const p = (PRESETS as any)[key];
      const isActive = (s.aspectPaletteMode !== 'matchAspect') && (
        (s.colorMode === 'kuro-preset' && s.colorPreset === key) ||
        (s.colorMode === 'kuro-auto' && this.plugin.settings.activePreset === key)
      );
      const b = btn('', isActive, () => {
        this.s.aspectPaletteMode = 'inherit';   // explicit user pick wins over aspect-match
        this.s.colorMode = 'kuro-preset';
        this.s.colorPreset = key;
        this.saveSettingsDebounced();
        const newColor = resolveColor(this.effectiveSettings());
        this.engine?.setColor(newColor);
        this.hud?.applyColor(newColor);
        this.rebuildBar();
      }, `${p.label} (${p.darkAccent.color})`);
      b.style.cssText += `width:14px;height:14px;border-radius:50%;padding:0;background:${p.darkAccent.color};margin:0 2px;`;
      b.textContent = '';
    });

    // FX primary
    //
    // v1.2 — Live-Test 2026-05-13 hard-merge of overlapping FX toggles:
    //   • TRAILS + BURN were both `AfterimagePass` (different damp). Now a single
    //     AFTER-button cycles 3 stages: off → trails (mild) → burn (heavy) → off.
    //   • CRT-Sim already produces chromatic aberration spikes, so the separate
    //     CHRM button is hidden — exposing it created a "two-effect-doing-the-
    //     same-thing" puzzle. The underlying fx.chromaticAberration setting is
    //     preserved internally for users who scripted it.
    //   • DRIFT (scanline drift) only makes sense when SCAN is on. It's now an
    //     implicit sub-setting of SCAN — turning SCAN on enables DRIFT, turning
    //     SCAN off disables DRIFT. No separate DRIFT button.
    sep(); lbl('FX');
    (['bloom', 'matrix', 'scan'] as const).forEach(fx => btn(
      fx.toUpperCase(), (s.fx as any)[fx].on, () => this.toggleFx(fx),
    ));
    // CRT sim toggle (replaces glitch + subsumes chromatic aberration)
    btn('CRT', s.crtSim.on, () => {
      this.s.crtSim.on = !this.s.crtSim.on;
      this.saveSettingsDebounced();
      this.rebuildBar();
    });
    // AFTER — 3-stage cycler: off → trails → burn → off
    const afterStage = s.fx.burnDecay.on ? 'BURN' : (s.fx.trails.on ? 'TRAIL' : 'OFF');
    const afterActive = afterStage !== 'OFF';
    btn(`AFTER:${afterStage}`, afterActive, () => {
      // Cycle order matches stages above
      if (!this.s.fx.trails.on && !this.s.fx.burnDecay.on) {
        this.s.fx.trails.on = true; this.s.fx.burnDecay.on = false;
      } else if (this.s.fx.trails.on && !this.s.fx.burnDecay.on) {
        this.s.fx.trails.on = false; this.s.fx.burnDecay.on = true;
      } else {
        this.s.fx.trails.on = false; this.s.fx.burnDecay.on = false;
      }
      this.saveSettingsDebounced();
      const eff = this.effectiveSettings();
      this.engine?.applyFxSettings(eff);
      this.rebuildBar();
    }, 'After-image / motion-blur stages: off · mild trails · heavy burn-in');

    // FOG — 3-stage cycler: auto (day/night breathing) → clear → dense → auto
    btn(`FOG:${this.s.fogMode.toUpperCase()}`, this.s.fogMode !== 'auto', () => {
      this.s.fogMode = this.s.fogMode === 'auto' ? 'clear'
                     : this.s.fogMode === 'clear' ? 'dense'
                     : 'auto';
      this.applyFogMode();
      this.saveSettingsDebounced();
      this.rebuildBar();
    }, 'Fog / view distance: auto (day-night) · clear (far) · dense (moody)');

    // FX advanced — remaining toggles that don't overlap with anything else
    sep(); lbl('FX+');
    (['vignette', 'radarPing', 'noiseBursts'] as const).forEach(fx => {
      const labels: Record<string, string> = {
        vignette: 'VIG', radarPing: 'PING', noiseBursts: 'NOISE',
      };
      btn(labels[fx], (s.fx as any)[fx].on, () => this.toggleFx(fx as any));
    });

    // FPS — live, updated by separate ticker so we don't rebuild the bar each frame
    sep(); lbl('FPS');
    this.fpsBarEl = document.createElement('span');
    this.fpsBarEl.className = 'ks-v';
    this.fpsBarEl.style.cssText = 'font-family:"Share Tech Mono",monospace;font-size:11px;letter-spacing:.06em;padding:0 4px;';
    this.fpsBarEl.textContent = '--';
    bar.appendChild(this.fpsBarEl);

    // Start FPS ticker if not running
    if (!this.fpsBarTimer) {
      this.fpsBarTimer = window.setInterval(() => {
        if (this.fpsBarEl && this.engine) this.fpsBarEl.textContent = String(this.engine.fps || '--');
      }, 500);
    }
  }

  private toggleFx(fx: keyof ScreensaverSettings['fx']) {
    (this.s.fx as any)[fx].on = !(this.s.fx as any)[fx].on;
    // v1.2 — DRIFT is an implicit sub-setting of SCAN (see buildControlBar
    // hard-merge comment). When SCAN toggles, DRIFT follows so the visible
    // result matches user intent without exposing a separate DRIFT button.
    if (fx === 'scan') this.s.fx.scanlineDrift.on = this.s.fx.scan.on;
    this.saveSettingsDebounced();
    const eff = this.effectiveSettings();
    this.engine?.applyFxSettings(eff);
    this.hud?.applySettings(eff);
    this.rebuildBar();
  }

  /**
   * Refresh control-bar contents (active states, FPS, etc) WITHOUT changing visibility.
   * If the bar is currently visible (mouse-driven), updates appear live; if hidden
   * (e.g. after a hotkey-driven scene switch), the next mouse-reveal shows the new state.
   * Hotkeys must NOT auto-pop the bar — only mouse interaction does.
   */
  private rebuildBar() {
    if (!this.hud) return;
    this.buildControlBar(this.effectiveSettings());
    // Intentionally do NOT call showControlBar() here.
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.state.open || this.state.embed) return;
    const k = e.key;

    // ── Escape-only exit mode ──
    // When enabled, only Escape closes the screensaver. All other keys are
    // swallowed (live hotkeys still work). Useful for "I want this to keep running
    // even if I bump the keyboard."
    if (this.s.escapeOnlyExit) {
      if (k === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        void this.close();
        return;
      }
      // Live hotkeys remain available even in escape-only mode
      if (this.s.liveHotkeysEnabled && this.handleLiveHotkey(e, k)) return;
      // Swallow everything else
      e.preventDefault(); e.stopPropagation();
      return;
    }

    // ── Default mode: any key closes, live hotkeys intercept first ──
    if (this.s.liveHotkeysEnabled && this.handleLiveHotkey(e, k)) return;

    e.preventDefault(); e.stopPropagation();
    void this.close();
  };

  /** Returns true if the key was handled as a live hotkey. */
  private handleLiveHotkey(e: KeyboardEvent, k: string): boolean {
    // 1-5 → scene switch
    if (k >= '1' && k <= '5') {
      const idx = parseInt(k, 10) - 1;
      if (idx < SCENES.length) {
        e.preventDefault(); e.stopPropagation();
        this.switchScene(SCENES[idx]);
        return true;
      }
    }
    if (k === 'm' || k === 'M') {
      e.preventDefault(); e.stopPropagation();
      this.s.sound.master = !this.s.sound.master;
      if (!this.s.sound.master) this.audio?.dispose();
      else { this.audio = new AudioLayer(this.effectiveSettings()); this.audio.start(); }
      return true;
    }
    if (k === 'p' || k === 'P' || k === ' ') {
      e.preventDefault(); e.stopPropagation();
      if (this.engine) {
        if ((this.engine as any)._paused) {
          this.engine.start(); this.narrative?.resume();
          (this.engine as any)._paused = false;
        } else {
          this.engine.stop(); this.narrative?.pause();
          (this.engine as any)._paused = true;
        }
      }
      return true;
    }
    if (k === 's' || k === 'S') {
      e.preventDefault(); e.stopPropagation();
      this.takeScreenshot();
      return true;
    }
    if (k === 'f' || k === 'F') {
      e.preventDefault(); e.stopPropagation();
      return true;
    }
    return false;
  }

  switchScene(id: SceneId) {
    if (!this.engine || !this.hud) return;
    this.audio?.sceneSwitch();
    // v1.2 — Cross-fade transition (Live-Test 2026-05-13 cool-idea).
    //   Old behaviour: scene loadScene() was synchronous, the next frame
    //   showed entirely different geometry — visually a hard cut.
    //   New: 200ms fade-to-black on the canvas, then load + fade back.
    //   Total of ~420ms feels like a "TV switching channels" beat without
    //   disrupting the narrative-terminal pacing or hotkeys.
    const canvas = this.engine.canvas;
    canvas.style.transition = 'opacity 200ms ease-out';
    canvas.style.opacity = '0';
    window.setTimeout(() => {
      if (!this.engine || !this.hud) return;
      this.engine.loadScene(id);
      this.baseFogDensity = (this.engine.scene.fog as any)?.density ?? 0.01;
      this.applyFogMode();
      const labels = DICT.MODE_LABELS[id];
      this.hud.setMode(labels[0]);
      this.hud.setTri(this.engine.getSceneObj()?.triCount || '----');
      this.hud.flashSceneLabel(id);
      canvas.style.opacity = '1';
      this.s.stats.scenesLoaded = (this.s.stats.scenesLoaded || 0) + 1;
      this.s.stats.perScene[id] = (this.s.stats.perScene[id] || 0) + 1;
      this.saveSettingsDebounced();
      this.rebuildBar();
    }, 210);
  }

  cycleScene() {
    if (!this.engine) return;
    const cur = this.engine.currentScene;
    const idx = ALL_SCENES.indexOf(cur as any);
    const next = ALL_SCENES[(idx + 1) % ALL_SCENES.length];

    // v1.2 — cool-idea: when autoCycle is on, also rotate the screensaver
    // palette through the 4 KSP aspects in sync with the scene change.
    // Each scene gets its own "personality" — shugo phosphor for terrain,
    // gunshi spectre for city, kantoku crimson for rift, sensei ember for
    // tunnel/void. We only touch the screensaver's local color settings,
    // not html[data-aspect] (so the vault chrome stays where it is).
    if (this.s.autoCycle?.on) {
      const ASPECT_PRESETS = ['phosphor', 'spectre', 'crimson', 'ember'] as const;
      const curIdx = ASPECT_PRESETS.indexOf(this.s.colorPreset as any);
      const nextPreset = ASPECT_PRESETS[((curIdx >= 0 ? curIdx : -1) + 1) % ASPECT_PRESETS.length];
      this.s.aspectPaletteMode = 'inherit';
      this.s.colorMode = 'kuro-preset';
      this.s.colorPreset = nextPreset;
      const newColor = resolveColor(this.effectiveSettings());
      this.engine?.setColor(newColor);
      this.hud?.applyColor(newColor);
    }

    this.switchScene(next);
  }

  takeScreenshot() {
    if (!this.engine) return;
    this.engine.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `kuro-screensaver-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async close() {
    if (!this.state.open) return;
    document.removeEventListener('keydown', this.onKeyDown, { capture: true } as any);
    clearInterval(this.autoCycleTimer);
    clearInterval((this as any)._dayNightInterval);
    clearInterval((this as any)._stormInterval);
    clearInterval((this as any)._perfInterval);
    clearInterval((this as any)._driftInterval);
    clearInterval((this as any)._noteFlashInterval);
    clearInterval(this.fpsBarTimer);
    this.fpsBarTimer = 0;
    this.fpsBarEl = null;

    // Update uptime stat
    if (this.openedAt > 0) {
      this.s.stats.totalUptimeMs = (this.s.stats.totalUptimeMs || 0) + (Date.now() - this.openedAt);
      void this.plugin.saveData(this.plugin.settings);
      this.openedAt = 0;
    }

    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }
    this.narrative?.stop();
    this.crt?.dispose();
    this.audio?.dispose();
    this.hud?.dispose();
    this.engine?.dispose();
    this.overlay?.remove();
    this.overlay = null; this.engine = null; this.hud = null; this.audio = null; this.narrative = null; this.crt = null;
    this.state.open = false;
  }

  // Debounced settings save — call this from frequent paths (scene-switch stats, etc.)
  private saveSettingsDebounced() {
    clearTimeout(this.statsSaveDebounce);
    this.statsSaveDebounce = window.setTimeout(() => this.plugin.saveData(this.plugin.settings), 1500);
  }

  // Idle watcher
  private startIdleWatcher() {
    this.lastActivity = Date.now();
    const reset = () => { this.lastActivity = Date.now(); };
    document.addEventListener('mousemove', reset, { passive: true });
    document.addEventListener('keydown', reset, { passive: true });
    document.addEventListener('mousedown', reset, { passive: true });
    document.addEventListener('wheel', reset, { passive: true });
    this.idleTimer = window.setInterval(() => {
      if (!this.state.open && this.s?.idleLaunch?.on) {
        const ms = this.s.idleLaunch.minutes * 60_000;
        if (Date.now() - this.lastActivity > ms) {
          void this.open();
        }
      }
    }, 10_000);
  }

  dispose() {
    clearInterval(this.idleTimer);
    void this.close();
  }
}
