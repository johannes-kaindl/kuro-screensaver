// Screensaver controller — owns overlay lifecycle, hotkeys, fullscreen, modes.
// Host-agnostic: the only environment hook is the ScreensaverHost interface
// (read/write settings, optional theme preset + vault kanji).
import { Engine, ALL_SCENES } from './engine/core';
import { resolveColor, readKuroFxDefaults } from './engine/color';
import { Hud } from './hud';
import { showBoot } from './hud/boot';
import { AudioLayer } from './audio/synth';
import { DICT } from './data/dictionary';
import type { ScreensaverSettings, SceneId } from './data/defaults';
import { HUD_PRESETS, SCENES, SCENE_LABELS } from './data/defaults';
import { PRESETS } from './data/presets';
import { NarrativeRunner } from './terminal/narrative';
import { mkRng, freshSeed } from './engine/rng';
import { CrtSim } from './fx/crt-sim';
import type { ScreensaverHost } from './host';

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
  private openedAt = 0;
  private statsSaveDebounce = 0;

  constructor(public host: ScreensaverHost) {
    this.startIdleWatcher();
  }

  get s(): ScreensaverSettings {
    return this.host.getSettings();
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

    // Vault kanji from host (Obsidian: from kuro plugin settings; Web: from host config)
    this.hud.setKanji(this.host.getVaultKanji?.() ?? '');

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
    const labels = DICT.MODE_LABELS[scene];
    this.hud.setMode(labels[0]);
    this.hud.setTri(this.engine.getSceneObj()?.triCount || '----');
    this.hud.flashSceneLabel(scene);

    // Stats
    this.s.stats.scenesLoaded = (this.s.stats.scenesLoaded || 0) + 1;
    this.s.stats.perScene[scene] = (this.s.stats.perScene[scene] || 0) + 1;
    void this.host.saveSettings(this.s);

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

    // Day/night cycle: subtle modulation of bloom strength + fog density
    if (s.dayNightCycle.on) {
      const periodMs = s.dayNightCycle.periodMin * 60_000;
      const baseBloom = this.engine!.bloomPass.strength;
      const fog = this.engine!.scene.fog as any;
      const baseFog = fog?.density ?? 0.01;
      (this as any)._dayNightInterval = window.setInterval(() => {
        const phase = ((Date.now() - this.dayNightT0) % periodMs) / periodMs;
        const cycleVal = Math.sin(phase * Math.PI * 2);
        if (this.engine) {
          this.engine.bloomPass.strength = baseBloom * (1 + cycleVal * 0.35);
          if (this.engine.scene.fog) (this.engine.scene.fog as any).density = baseFog * (1 + cycleVal * 0.4);
        }
      }, 250);
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

    // SCENE
    lbl('SCENE');
    SCENES.forEach(sc => btn(SCENE_LABELS[sc], this.engine?.currentScene === sc, () => this.switchScene(sc)));

    // SPD
    sep(); lbl('SPD');
    (['slow', 'norm', 'fast'] as const).forEach(sp => btn(
      sp === 'slow' ? '▶' : sp === 'norm' ? '▶▶' : '▶▶▶',
      s.speed === sp,
      () => { this.s.speed = sp; this.saveSettingsDebounced(); this.rebuildBar(); },
    ));

    // COLOR — cycle through Kuro presets via colored dots
    sep(); lbl('COLOR');
    const presetKeys = Object.keys(PRESETS);
    presetKeys.forEach(key => {
      const p = (PRESETS as any)[key];
      const isActive = (s.colorMode === 'kuro-preset' && s.colorPreset === key) ||
                       (s.colorMode === 'kuro-auto' && this.host.getActivePreset?.() === key);
      const b = btn('', isActive, () => {
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
    sep(); lbl('FX');
    (['bloom', 'matrix', 'trails', 'scan'] as const).forEach(fx => btn(
      fx.toUpperCase(), (s.fx as any)[fx].on, () => this.toggleFx(fx),
    ));
    // CRT sim toggle (replaces glitch)
    btn('CRT', s.crtSim.on, () => {
      this.s.crtSim.on = !this.s.crtSim.on;
      this.saveSettingsDebounced();
      this.rebuildBar();
    });

    // FX advanced
    sep(); lbl('FX+');
    (['vignette', 'scanlineDrift', 'radarPing', 'burnDecay', 'chromaticAberration', 'noiseBursts'] as const).forEach(fx => {
      const labels: Record<string, string> = {
        vignette: 'VIG', scanlineDrift: 'DRIFT', radarPing: 'PING',
        burnDecay: 'BURN', chromaticAberration: 'CHRM', noiseBursts: 'NOISE',
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
    if (k === 'p' || k === 'P') {
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
    this.engine.loadScene(id);
    const labels = DICT.MODE_LABELS[id];
    this.hud.setMode(labels[0]);
    this.hud.setTri(this.engine.getSceneObj()?.triCount || '----');
    this.hud.flashSceneLabel(id);
    this.s.stats.scenesLoaded = (this.s.stats.scenesLoaded || 0) + 1;
    this.s.stats.perScene[id] = (this.s.stats.perScene[id] || 0) + 1;
    this.saveSettingsDebounced();
    this.rebuildBar();
  }

  cycleScene() {
    if (!this.engine) return;
    const cur = this.engine.currentScene;
    const idx = ALL_SCENES.indexOf(cur as any);
    const next = ALL_SCENES[(idx + 1) % ALL_SCENES.length];
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
    clearInterval(this.fpsBarTimer);
    this.fpsBarTimer = 0;
    this.fpsBarEl = null;

    // Update uptime stat
    if (this.openedAt > 0) {
      this.s.stats.totalUptimeMs = (this.s.stats.totalUptimeMs || 0) + (Date.now() - this.openedAt);
      void this.host.saveSettings(this.s);
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
    this.statsSaveDebounce = window.setTimeout(() => this.host.saveSettings(this.s), 1500);
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
