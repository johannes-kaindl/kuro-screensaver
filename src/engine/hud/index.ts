// HUD: left/right info panels, radar, terminal scroller, crosshair, vault-kanji,
// realtime, scene-label slab, control bar.
import type { ScreensaverSettings, SceneId } from '../data/defaults';
import type { Engine } from '../engine/core';
import type { ResolvedColor } from '../engine/color';
import { DICT, pickFrom, pickTerminalLine, pickCommandSession } from '../data/dictionary';
import type { LineCategory } from '../data/dictionary';

export class Hud {
  root: HTMLElement;
  hl!: HTMLDivElement;
  hr!: HTMLDivElement;
  radar!: HTMLDivElement;
  radarCanvas!: HTMLCanvasElement;
  rctx!: CanvasRenderingContext2D;
  // Terminal-window chrome — Apple-Lisa-inspired CORP OS framing.
  termWindow!: HTMLDivElement;          // wrapper that switches layout via class
  termTitle!: HTMLDivElement;           // striped titlebar
  termTitleLabel!: HTMLSpanElement;     // app name + persona in the title slug
  termMenuBar!: HTMLDivElement;         // faux menu bar
  termStatusBar!: HTMLDivElement;       // bottom status bar
  termStatusLeft!: HTMLSpanElement;     // status-bar left text (sector / utc)
  termStatusRight!: HTMLSpanElement;    // status-bar right text (link state)
  termBackdrop!: HTMLDivElement;        // dim layer shown only in center-window mode
  term!: HTMLDivElement;                // content area (scrollback + prompt)
  termOut!: HTMLDivElement;
  promptHandleEl!: HTMLSpanElement;     // operator's "X@Y:~" label
  promptInputEl!: HTMLSpanElement;      // active typed input (where typing.ts writes)
  promptCursorEl!: HTMLSpanElement;     // blinking block cursor
  cross!: HTMLDivElement;
  slab!: HTMLDivElement;
  kanji!: HTMLDivElement;

  matrixCanvas!: HTMLCanvasElement;
  mctx!: CanvasRenderingContext2D;
  matrixCols: number[] = [];

  scanlines!: HTMLDivElement;
  vignette!: HTMLDivElement;
  pingEl!: HTMLDivElement;
  noiseEl!: HTMLDivElement;
  flashEl!: HTMLDivElement;
  alertEl!: HTMLDivElement;
  powerOnEl!: HTMLDivElement;

  controlBar!: HTMLDivElement;
  controlBarHideTimer = 0;

  fps = '--';
  modeText = 'RECON';
  handle: string;

  private rafId = 0;
  private rA = 0;
  private blips: { a: number; r: number; l: number }[] = [];
  private nextPingTime = 0;
  private nextNoiseTime = 0;
  private nextFlashTime = 0;
  private nextAlertTime = 0;
  private nextTerminalTime = 0;
  private terminalRng: () => number;

  constructor(host: HTMLElement, public settings: ScreensaverSettings, public color: ResolvedColor, public engine: Engine) {
    this.root = host;
    this.handle = pickFrom(DICT.HUD_HANDLES, Math.random);
    this.terminalRng = () => Math.random();
    this.buildDOM();
    this.applyColor(color);
    this.applySettings(settings);
    for (let i = 0; i < 12; i++) this.blips.push({ a: Math.random() * Math.PI * 2, r: 10 + Math.random() * 32, l: 0.85 });
  }

  private buildDOM() {
    const css = (s: TemplateStringsArray) => s[0];
    const make = (tag: string, style: string, parent: HTMLElement = this.root) => {
      const el = document.createElement(tag); el.setAttribute('style', style); parent.appendChild(el); return el as any;
    };

    // Scanlines (CSS overlay)
    this.scanlines = make('div',
      'position:absolute;inset:0;z-index:30;pointer-events:none;' +
      'background:repeating-linear-gradient(to bottom,transparent 0,transparent 3px,rgba(0,0,0,.11) 3px,rgba(0,0,0,.11) 4px);' +
      'transition:opacity .3s');

    // Vignette
    this.vignette = make('div',
      'position:absolute;inset:0;z-index:31;pointer-events:none;' +
      'background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.72) 100%)');

    // Matrix rain canvas
    this.matrixCanvas = make('canvas', 'position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .5s');
    this.matrixCanvas.width = window.innerWidth; this.matrixCanvas.height = window.innerHeight;
    this.mctx = this.matrixCanvas.getContext('2d')!;
    this.matrixCols = Array.from({ length: Math.floor(window.innerWidth / 13) }, () => Math.floor(Math.random() * window.innerHeight / 13));

    // Control bar
    this.controlBar = make('div',
      'position:absolute;top:0;left:0;right:0;z-index:40;padding:5px 10px;background:rgba(0,0,0,.9);' +
      'border-bottom:1px solid var(--ks-faint,#003d10);display:flex;align-items:center;gap:3px;flex-wrap:wrap;' +
      'opacity:0;transition:opacity .25s;pointer-events:none');

    // Slab (scene label)
    this.slab = make('div',
      'position:absolute;top:48px;left:50%;transform:translateX(-50%);z-index:35;pointer-events:none;' +
      'font-family:VT323,monospace;font-size:30px;letter-spacing:.22em;opacity:0;transition:opacity .4s');

    // HUD left
    this.hl = make('div',
      'position:absolute;top:46px;left:12px;z-index:35;font-family:"Share Tech Mono",monospace;font-size:10px;' +
      'letter-spacing:.06em;line-height:2;pointer-events:none');
    this.hl.innerHTML = `
      <div>MODE&nbsp;&nbsp;<span class="ks-v" id="ks-mode">RECON</span></div>
      <div>ALT&nbsp;&nbsp;&nbsp;<span class="ks-v" id="ks-alt">0042M</span></div>
      <div>SPD&nbsp;&nbsp;&nbsp;<span class="ks-v" id="ks-spd">0.18</span></div>
      <div>HDG&nbsp;&nbsp;&nbsp;<span class="ks-v" id="ks-hdg">270°</span></div>
      <div>T+&nbsp;&nbsp;&nbsp;&nbsp;<span class="ks-v" id="ks-time">00:00</span></div>
      <div>RT&nbsp;&nbsp;&nbsp;&nbsp;<span class="ks-v" id="ks-rt">00:00:00</span></div>
    `;

    // HUD right
    this.hr = make('div',
      'position:absolute;top:46px;right:12px;z-index:35;font-family:"Share Tech Mono",monospace;font-size:10px;' +
      'letter-spacing:.06em;line-height:2;text-align:right;pointer-events:none');
    this.hr.innerHTML = `
      <div><span class="ks-v" id="ks-sys">NOMINAL</span>&nbsp;SYS</div>
      <div><span class="ks-v">94%</span>&nbsp;&nbsp;&nbsp;PWR</div>
      <div><span class="ks-v">SECURE</span>&nbsp;LNK</div>
      <div><span class="ks-v" id="ks-tri">----</span>&nbsp;&nbsp;TRI</div>
      <div><span class="ks-v" id="ks-fps">--</span>&nbsp;&nbsp;&nbsp;FPS</div>
    `;

    // Vault kanji (right side, below HR)
    this.kanji = make('div',
      'position:absolute;bottom:240px;right:18px;z-index:35;font-family:VT323,monospace;font-size:80px;' +
      'opacity:.18;pointer-events:none;line-height:1');

    // Crosshair
    this.cross = make('div',
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:35;pointer-events:none;' +
      'font-family:"Share Tech Mono",monospace;font-size:11px;opacity:.4;text-align:center;line-height:1.4');
    this.cross.innerHTML = '──┤ ✛ ├──<br><span style="font-size:8px;letter-spacing:.15em">TRACK</span>';

    // Radar
    this.radar = make('div',
      'position:absolute;bottom:130px;right:12px;z-index:35;width:88px;height:88px;border-radius:50%;' +
      'overflow:hidden;background:rgba(0,18,5,.88)');
    this.radarCanvas = make('canvas', 'width:88px;height:88px', this.radar);
    this.radarCanvas.width = 88; this.radarCanvas.height = 88;
    this.rctx = this.radarCanvas.getContext('2d')!;

    // Backdrop dimmer — only visible in center-window mode (CSS toggles opacity).
    this.termBackdrop = make('div',
      'position:absolute;inset:0;z-index:34;pointer-events:none;background:rgba(0,0,0,0.55);opacity:0;transition:opacity .35s');

    // Window wrapper — switches layout entirely via CSS class.
    this.termWindow = make('div',
      'position:absolute;z-index:35;pointer-events:none;font-family:VT323,monospace;' +
      'font-size:18px;line-height:1.15;');
    this.termWindow.classList.add('ks-term-bottom');     // default layout

    // Titlebar — Apple-Lisa-style horizontal stripes with a centered title slug.
    this.termTitle = document.createElement('div');
    this.termTitle.className = 'ks-term-chrome ks-term-titlebar';
    this.termTitle.innerHTML =
      `<span class="ks-term-titlebar-close"></span>` +
      `<span class="ks-term-titlebar-title"><span class="ks-term-titlebar-label">CORP TERMINAL.APP v4.1</span></span>` +
      `<span class="ks-term-titlebar-spacer"></span>`;
    this.termTitleLabel = this.termTitle.querySelector('.ks-term-titlebar-label') as HTMLSpanElement;

    // Menu bar — looks-only faux entries
    this.termMenuBar = document.createElement('div');
    this.termMenuBar.className = 'ks-term-chrome ks-term-menubar';
    this.termMenuBar.innerHTML =
      `<span>File</span><span>Comms</span><span>Audit</span><span>Help</span>` +
      `<span class="ks-term-menubar-spacer"></span>` +
      `<span class="ks-term-menubar-controls">[ _ ] [ ▣ ] [ ✕ ]</span>`;

    // Content area — scrollback + prompt. Same DOM as before; only the wrapping changes.
    this.term = document.createElement('div');
    this.term.className = 'ks-term-content';
    this.term.innerHTML =
      `<hr class="ks-term-hr">` +
      `<div id="ks-tout"></div>` +
      `<div class="ks-promptline">` +
        `<span class="ks-dim" id="ks-prompt-handle">${this.handle}:~&nbsp;</span>` +
        `<span id="ks-prompt-input"></span>` +
        `<span class="ks-blink" id="ks-prompt-cursor">█</span>` +
      `</div>`;

    // Status bar — bottom strip with sector/clock/link
    this.termStatusBar = document.createElement('div');
    this.termStatusBar.className = 'ks-term-chrome ks-term-statusbar';
    this.termStatusBar.innerHTML =
      `<span class="ks-term-status-left">SECTOR 7 · UTC --:--:--</span>` +
      `<span class="ks-term-status-right">SECURE LNK</span>`;
    this.termStatusLeft  = this.termStatusBar.querySelector('.ks-term-status-left')  as HTMLSpanElement;
    this.termStatusRight = this.termStatusBar.querySelector('.ks-term-status-right') as HTMLSpanElement;

    // Compose
    this.termWindow.appendChild(this.termTitle);
    this.termWindow.appendChild(this.termMenuBar);
    this.termWindow.appendChild(this.term);
    this.termWindow.appendChild(this.termStatusBar);

    this.termOut         = this.term.querySelector('#ks-tout')          as HTMLDivElement;
    this.promptHandleEl  = this.term.querySelector('#ks-prompt-handle') as HTMLSpanElement;
    this.promptInputEl   = this.term.querySelector('#ks-prompt-input')  as HTMLSpanElement;
    this.promptCursorEl  = this.term.querySelector('#ks-prompt-cursor') as HTMLSpanElement;

    // Radar ping
    this.pingEl = make('div',
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:32;pointer-events:none;' +
      'width:0;height:0;border-radius:50%;border:2px solid currentColor;opacity:0');

    // Noise
    this.noiseEl = make('div',
      'position:absolute;inset:0;z-index:33;pointer-events:none;opacity:0;mix-blend-mode:screen');

    // Flash overlay
    this.flashEl = make('div',
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:36;pointer-events:none;' +
      'font-family:VT323,monospace;font-size:120px;letter-spacing:.18em;opacity:0;text-shadow:0 0 30px currentColor');

    // Alert overlay
    this.alertEl = make('div',
      'position:absolute;inset:0;z-index:38;pointer-events:none;opacity:0;display:flex;align-items:center;justify-content:center;' +
      'font-family:"Share Tech Mono",monospace;font-size:36px;letter-spacing:.15em;color:#ff2a2a;text-shadow:0 0 18px #ff2a2a;' +
      'background:rgba(80,0,0,.18)');

    // Power-on flash
    this.powerOnEl = make('div',
      'position:absolute;inset:0;z-index:50;pointer-events:none;background:#fff;opacity:0;mix-blend-mode:screen');
  }

  applyColor(c: ResolvedColor) {
    this.color = c;
    const root = this.root;
    root.style.setProperty('--ks-p', c.css);
    root.style.setProperty('--ks-dim', c.dim);
    root.style.setProperty('--ks-faint', c.faint);
    // Style sheets that depend on --ks-p
    if (!document.getElementById('ks-style')) {
      const st = document.createElement('style');
      st.id = 'ks-style';
      st.textContent = `
        #kuro-screensaver-overlay { color: var(--ks-p); }
        #kuro-screensaver-overlay .ks-v { color: var(--ks-p); text-shadow: 0 0 7px var(--ks-p); }
        #kuro-screensaver-overlay .ks-dim { color: var(--ks-dim); text-shadow: 0 0 4px var(--ks-dim); }
        #kuro-screensaver-overlay .ks-blink { animation: ks-blink .8s step-start infinite; }
        @keyframes ks-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        #kuro-screensaver-overlay .tl { display: block; }
        #kuro-screensaver-overlay .tl.d1 { color: var(--ks-dim); text-shadow: 0 0 4px var(--ks-dim); }
        #kuro-screensaver-overlay .tl.d2 { color: var(--ks-faint); text-shadow: none; }
        #kuro-screensaver-overlay button.ks-btn {
          font-family: 'Share Tech Mono', monospace; font-size: 10px; letter-spacing: .07em;
          color: var(--ks-dim); background: transparent; border: 1px solid var(--ks-faint);
          padding: 3px 8px; cursor: pointer; text-shadow: 0 0 4px var(--ks-faint); transition: all .15s;
          margin: 0 2px; pointer-events: auto;
        }
        #kuro-screensaver-overlay button.ks-btn:hover {
          color: var(--ks-p); border-color: var(--ks-dim); text-shadow: 0 0 7px var(--ks-p);
        }
        #kuro-screensaver-overlay button.ks-btn.on {
          color: #000; background: var(--ks-p); border-color: var(--ks-p); text-shadow: none;
          box-shadow: 0 0 10px var(--ks-p), 0 0 22px rgba(255,255,255,.18);
        }
        #kuro-screensaver-overlay .ks-lbl {
          font-family: 'Share Tech Mono', monospace; font-size: 9px; color: var(--ks-faint);
          letter-spacing: .1em; margin: 0 4px;
        }
        #kuro-screensaver-overlay .ks-sep {
          width: 1px; height: 20px; background: var(--ks-faint); margin: 0 6px;
        }

        /* ── Terminal: bottom-strip layout (default) ─────────────────── */
        #kuro-screensaver-overlay .ks-term-bottom {
          left: 0; right: 0; bottom: 0;
          padding: 0 14px 10px;
          background: linear-gradient(to top, rgba(0,0,0,.95) 0%, rgba(0,0,0,.55) 70%, transparent 100%);
          max-height: 240px; overflow: hidden;
        }
        #kuro-screensaver-overlay .ks-term-bottom .ks-term-chrome { display: none; }
        #kuro-screensaver-overlay .ks-term-hr {
          border: none; border-top: 1px solid var(--ks-faint); margin-bottom: 7px;
        }

        /* ── Terminal: center-window layout (Apple-Lisa-inspired CORP OS) ── */
        /* Fixed dimensions — looks and behaves like a real terminal window:
           constant size regardless of content, oldest lines scroll off the top. */
        #kuro-screensaver-overlay .ks-term-window {
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 760px;
          height: 480px;
          background: rgba(2,4,2,0.85);
          border: 2px solid var(--ks-p);
          box-shadow:
            0 0 28px rgba(0,0,0,0.85),
            inset 0 0 1px var(--ks-p),
            0 0 60px var(--ks-faint);
          padding: 0;
          overflow: hidden;
          display: flex; flex-direction: column;
        }
        #kuro-screensaver-overlay .ks-term-window .ks-term-content {
          padding: 10px 16px 12px;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
          display: flex; flex-direction: column; justify-content: flex-end;
        }
        /* Hide the divider in window mode — chrome borders already separate sections. */
        #kuro-screensaver-overlay .ks-term-window .ks-term-hr { display: none; }
        /* Scrollback grows from bottom: newest line touches the prompt, older
           lines stack upward, oldest scrolls off the top via overflow: hidden. */
        #kuro-screensaver-overlay .ks-term-window #ks-tout {
          display: flex; flex-direction: column; justify-content: flex-end;
        }

        /* Titlebar — Lisa-style horizontal stripes with centered title slug */
        #kuro-screensaver-overlay .ks-term-titlebar {
          height: 22px; flex: 0 0 auto;
          display: flex; align-items: center; padding: 0 6px;
          background:
            repeating-linear-gradient(
              to bottom,
              var(--ks-p) 0px, var(--ks-p) 1px,
              transparent 1px, transparent 3px
            );
          border-bottom: 1px solid var(--ks-p);
        }
        #kuro-screensaver-overlay .ks-term-titlebar-close {
          width: 12px; height: 12px;
          background: var(--ks-p);
          border: 1px solid var(--ks-p);
          flex: 0 0 auto;
        }
        #kuro-screensaver-overlay .ks-term-titlebar-title {
          flex: 1 1 auto; text-align: center;
        }
        #kuro-screensaver-overlay .ks-term-titlebar-label {
          background: rgba(2,4,2,0.95);
          padding: 0 14px;
          color: var(--ks-p);
          font-family: 'Share Tech Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-shadow: 0 0 6px var(--ks-p);
        }
        #kuro-screensaver-overlay .ks-term-titlebar-spacer { width: 12px; flex: 0 0 auto; }

        /* Menu bar — fake static menus for atmosphere */
        #kuro-screensaver-overlay .ks-term-menubar {
          flex: 0 0 auto;
          padding: 3px 10px;
          border-bottom: 1px solid var(--ks-faint);
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          color: var(--ks-dim);
          letter-spacing: 0.06em;
          display: flex; gap: 16px; align-items: center;
          background: rgba(0,0,0,0.4);
        }
        #kuro-screensaver-overlay .ks-term-menubar-spacer { flex: 1 1 auto; }
        #kuro-screensaver-overlay .ks-term-menubar-controls {
          color: var(--ks-faint); letter-spacing: 0.05em; font-size: 10px;
        }

        /* Status bar — bottom strip */
        #kuro-screensaver-overlay .ks-term-statusbar {
          flex: 0 0 auto;
          padding: 3px 10px;
          border-top: 1px solid var(--ks-faint);
          font-family: 'Share Tech Mono', monospace;
          font-size: 10px;
          color: var(--ks-dim);
          letter-spacing: 0.06em;
          display: flex; justify-content: space-between;
          background: rgba(0,0,0,0.4);
        }
      `;
      document.head.appendChild(st);
    }
  }

  applySettings(s: ScreensaverSettings) {
    this.settings = s;
    this.hl.style.display = s.hud.left ? '' : 'none';
    this.hr.style.display = s.hud.right ? '' : 'none';
    this.radar.style.display = s.hud.radar ? '' : 'none';
    this.termWindow.style.display = s.hud.terminal ? '' : 'none';
    this.cross.style.display = s.hud.crosshair ? '' : 'none';

    // Layout switch: bottom-strip vs centered window
    this.termWindow.classList.toggle('ks-term-bottom', s.terminalLayout !== 'center-window');
    this.termWindow.classList.toggle('ks-term-window', s.terminalLayout === 'center-window');
    this.termBackdrop.style.opacity = (s.terminalLayout === 'center-window' && s.hud.terminal) ? '1' : '0';
    this.kanji.style.display = s.hud.vaultKanji ? '' : 'none';
    this.scanlines.style.opacity = s.fx.scan.on ? String(s.fx.scan.opacity * 5) : '0';
    this.vignette.style.opacity = s.fx.vignette.on ? String(s.fx.vignette.strength) : '0';
    this.matrixCanvas.style.opacity = s.fx.matrix.on ? '0.5' : '0';
    // Vignette strength via inline gradient stop
    this.vignette.style.background = `radial-gradient(ellipse at center, transparent ${52 - s.fx.vignette.strength * 30}%, rgba(0,0,0,.72) 100%)`;
    // (Old `glitch` FX removed — superseded by the CrtSim subsystem in fx/crt-sim.ts.)
  }

  setKanji(k: string) { this.kanji.textContent = k; }

  setMode(label: string) {
    this.modeText = label;
    const m = this.hl.querySelector('#ks-mode'); if (m) m.textContent = label;
  }

  setTri(s: string) { const e = this.hl.parentElement?.querySelector('#ks-tri'); if (e) e.textContent = s; }

  /** Show scene label slab briefly */
  flashSceneLabel(name: string) {
    this.slab.textContent = name.toUpperCase();
    this.slab.style.opacity = '1';
    setTimeout(() => this.slab.style.opacity = '0', 1600);
  }

  flashAlert(text: string) {
    this.alertEl.textContent = text;
    this.alertEl.style.opacity = '1';
    setTimeout(() => this.alertEl.style.opacity = '0', 1800);
  }

  flashPhrase(text: string) {
    this.flashEl.textContent = text;
    this.flashEl.style.opacity = '1';
    setTimeout(() => this.flashEl.style.opacity = '0', 180);
  }

  flashPowerOn() {
    this.powerOnEl.style.transition = 'opacity 80ms ease-out';
    this.powerOnEl.style.opacity = '1';
    setTimeout(() => {
      this.powerOnEl.style.transition = 'opacity 250ms ease-in';
      this.powerOnEl.style.opacity = '0';
    }, 80);
  }

  /**
   * Reveal the control bar.
   * @param autoHideSec  seconds until auto-hide. 0 = no auto-hide (close only on click).
   *                     undefined or negative = use previous value (no change to schedule).
   */
  showControlBar(autoHideSec?: number) {
    this.controlBar.style.opacity = '1';
    this.controlBar.style.pointerEvents = 'auto';
    clearTimeout(this.controlBarHideTimer);
    if (autoHideSec != null && autoHideSec > 0) {
      this.controlBarHideTimer = window.setTimeout(() => this.hideControlBar(), autoHideSec * 1000);
    }
  }

  hideControlBar() {
    this.controlBar.style.opacity = '0';
    this.controlBar.style.pointerEvents = 'none';
    clearTimeout(this.controlBarHideTimer);
  }

  isControlBarVisible(): boolean {
    return this.controlBar.style.opacity === '1';
  }

  // Per-category prefix + suffix the rendered line gets in the terminal.
  // Monospaced visual structure so different message types are skim-readable.
  private static PREFIX: Record<LineCategory, string> = {
    STATUS:    '[OK] ',
    WARNING:   '[!!] ',
    LORE:      '[**] ',
    QUOTES:    '› ',                 // single chevron — quotes carry their own quote marks
    CMD:       '$ ',                 // typed at the prompt
    RESP:      '  ↳ ',               // indented response
    HQ:        '[HQ→] ',             // inbound from headquarters
    DENY:      '[NO] ',              // refused command / system block
    GHOSTLINK: '[~~] ',              // ghostlink secure-channel system events
    INSTR:     '« ',                 // inbound from instructor (mentor)
  };

  // Smooth opacity ramp — newer lines bright, older fade gradually to invisible.
  // Index 0 = newest. Used only in bottom-strip layout. center-window uses flat
  // opacity (real-terminal feel) and a hard line cap (LINE_CAP_WINDOW).
  private static LINE_OPACITY = [1.0, 0.72, 0.5, 0.32, 0.18, 0.09];
  private static LINE_CAP_WINDOW = 16;

  /**
   * Add a categorized line to the terminal scroller. Returns a Promise that
   * resolves when the typewriter finishes — callers `await` it to render lines
   * sequentially (one builds, slides up, next builds beneath).
   *
   * Layout: newest line at the BOTTOM (just above the prompt cursor), older
   * lines stack upward.
   *
   * CMD lines render instantly (the operator already typed them live at the
   * prompt — re-typing in the scrollback would be redundant).
   */
  addLine(txt: string, category: LineCategory = 'STATUS'): Promise<void> {
    if (!this.settings.hud.terminal) return Promise.resolve();

    // Append new line at bottom (next to prompt) — full opacity.
    const span = document.createElement('span');
    span.className = 'tl';
    span.style.opacity = '1';
    this.termOut.appendChild(span);

    const isWindow = this.settings.terminalLayout === 'center-window';
    const all = Array.from(this.termOut.querySelectorAll('.tl')) as HTMLElement[];

    if (isWindow) {
      // Real-terminal feel: flat opacity, hard line cap, no fade.
      const cap = Hud.LINE_CAP_WINDOW;
      for (let i = 0; i < all.length; i++) {
        const ageFromNewest = all.length - 1 - i;
        if (ageFromNewest >= cap) all[i].remove();
        else all[i].style.opacity = '1';
      }
    } else {
      // Bottom-strip: smooth opacity gradient, lines fade out at top.
      const ramp = Hud.LINE_OPACITY;
      for (let i = 0; i < all.length; i++) {
        const ageFromNewest = all.length - 1 - i;
        if (ageFromNewest >= ramp.length) all[i].remove();
        else all[i].style.opacity = String(ramp[ageFromNewest]);
      }
    }

    const prefix = Hud.PREFIX[category];

    // CMD lines: instant render. The operator already typed it at the prompt
    // (with full personality), so the scrollback entry is just the log.
    if (category === 'CMD') {
      span.textContent = prefix + txt;
      return Promise.resolve();
    }

    // Typewriter for everything else — appears character-by-character.
    const baseDelay = 14;
    const jitter = 11;
    span.textContent = prefix;
    let ci = 0;
    return new Promise<void>((resolve) => {
      const ty = () => {
        if (ci < txt.length) {
          span.textContent = prefix + txt.slice(0, ++ci);
          setTimeout(ty, baseDelay + Math.random() * jitter);
        } else {
          resolve();
        }
      };
      ty();
    });
  }

  /**
   * Schedule a faux-command session on the terminal.
   *
   * Renders: prompt types CMD → small "thinking" delay → response lines stream in.
   * Each response item may be a plain string (renders as RESP, indented) or
   * `{cat, text}` (e.g. QUOTES → renders with the quote prefix). The override
   * lets us surface lore + quotes WITHIN a session for higher impact than
   * ambient log lines.
   *
   * Returns the total time the session occupies (ms) so the caller can reschedule.
   */
  runCommandSession(rng: () => number): number {
    if (!this.settings.hud.terminal) return 0;
    const session = pickCommandSession(rng);

    // CMD line (typed slowly)
    this.addLine(session.cmd, 'CMD');
    const cmdMs = session.cmd.length * 35 + 400;     // typing time + small pause

    // Schedule each response line with progressive delay
    let cursor = cmdMs + 300;                         // "thinking" delay before first reply
    let totalLen = 0;
    session.resp.forEach((r) => {
      const text = typeof r === 'string' ? r : r.text;
      const cat: LineCategory = typeof r === 'string' ? 'RESP' : (r.cat as LineCategory);
      const at = cursor;
      setTimeout(() => this.addLine(text, cat), at);
      cursor += 350 + text.length * 14;               // typewriter time + inter-line pause
      totalLen += text.length;
    });

    return cursor + 200;
  }

  // Per-frame loop: radar, matrix, scanline drift, ping, noise, flash, hud values, terminal, day-night
  startLoop(t0: number) {
    let prevDriftY = 0;
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const elapsed = (now - t0) / 1000;

      // HUD
      const sec = Math.floor(elapsed);
      const timeEl = this.hl.querySelector('#ks-time'); if (timeEl) timeEl.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      if (this.settings.hud.realtime) {
        const d = new Date();
        const rtEl = this.hl.querySelector('#ks-rt'); if (rtEl) rtEl.textContent =
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      }
      const altEl = this.hl.querySelector('#ks-alt'); if (altEl) altEl.textContent = String(42 + Math.round(Math.sin(elapsed * 0.3) * 12)).padStart(4, '0') + 'M';
      const spdEl = this.hl.querySelector('#ks-spd'); if (spdEl) spdEl.textContent = (this.engine.settings.speed === 'slow' ? 0.06 : this.engine.settings.speed === 'norm' ? 0.18 : 0.5).toFixed(2);
      const hdgEl = this.hl.querySelector('#ks-hdg'); if (hdgEl) hdgEl.textContent = Math.floor((270 + Math.sin(elapsed * 0.12) * 15 + 360) % 360) + '°';
      const fpsEl = this.hr.querySelector('#ks-fps'); if (fpsEl) fpsEl.textContent = String(this.engine.fps || '--');
      const triEl = this.hr.querySelector('#ks-tri'); if (triEl && this.engine.getSceneObj()?.triCount) triEl.textContent = this.engine.getSceneObj().triCount;

      // Terminal-window status bar: UTC clock + sector. Title slug picks up persona
      // (the narrative runner sets promptHandleEl.textContent; we mirror the handle here).
      if (this.settings.terminalLayout === 'center-window' && this.settings.hud.terminal) {
        const d = new Date();
        const utc = `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}`;
        if (this.termStatusLeft) this.termStatusLeft.textContent = `SECTOR 7 · UTC ${utc}`;
        // Inject persona into title slug if narrative is running
        const handleText = (this.promptHandleEl?.textContent || '').replace(':~', '').trim();
        if (this.termTitleLabel) {
          this.termTitleLabel.textContent = handleText
            ? `CORP TERMINAL.APP v4.1  —  ${handleText}`
            : 'CORP TERMINAL.APP v4.1';
        }
      }

      // Radar
      if (this.settings.hud.radar) this.drawRadar();

      // Matrix rain
      if (this.settings.fx.matrix.on) this.drawMatrix();

      // Scanline drift
      if (this.settings.fx.scanlineDrift.on) {
        prevDriftY = (prevDriftY + this.settings.fx.scanlineDrift.speed * 0.6) % 4;
        this.scanlines.style.backgroundPositionY = prevDriftY + 'px';
        // Sync-tear ~2% chance
        if (Math.random() < 0.002) {
          this.scanlines.style.transform = `translateY(${(Math.random() - 0.5) * 6}px)`;
          setTimeout(() => this.scanlines.style.transform = '', 80);
        }
      }

      // Radar ping
      if (this.settings.fx.radarPing.on && now > this.nextPingTime) {
        this.nextPingTime = now + this.settings.fx.radarPing.interval * 1000;
        this.firePing();
      }

      // Noise bursts
      if (this.settings.fx.noiseBursts.on && now > this.nextNoiseTime) {
        const meanGap = 60_000 / Math.max(0.1, this.settings.fx.noiseBursts.freq);
        this.nextNoiseTime = now + meanGap * (0.5 + Math.random());
        this.fireNoise();
      }

      // Subliminal flash
      if (this.settings.subliminalFlashes && now > this.nextFlashTime) {
        const meanGap = this.settings.flashFrequencyMean * 1000;
        this.nextFlashTime = now + meanGap * (0.6 + Math.random() * 0.8);
        this.flashPhrase(pickFrom(DICT.FLASH_PHRASES, Math.random));
      }

      // Easter-egg alert (~10min)
      if (this.settings.easterEggAlerts && now > this.nextAlertTime) {
        if (this.nextAlertTime === 0) this.nextAlertTime = now + 8 * 60_000 + Math.random() * 4 * 60_000;
        else { this.nextAlertTime = now + 9 * 60_000 + Math.random() * 4 * 60_000; this.flashAlert(pickFrom(DICT.ALERT_PHRASES, Math.random)); }
      }

      // Terminal scroller — only runs when narrative mode is OFF (legacy fallback).
      // Narrative mode drives addLine() externally via the NarrativeRunner.
      if (this.settings.hud.terminal && !this.settings.narrativeTerminal && now > this.nextTerminalTime) {
        if (Math.random() < 0.18) {
          const sessionMs = this.runCommandSession(this.terminalRng);
          this.nextTerminalTime = now + sessionMs + 3000 + Math.random() * 3000;
        } else {
          this.nextTerminalTime = now + 2100 + Math.random() * 2300;
          const line = pickTerminalLine(this.settings.loreIntensity, this.terminalRng);
          this.addLine(line.text, line.category);
        }
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() { cancelAnimationFrame(this.rafId); }

  private drawRadar() {
    const c = this.color.rgb;
    const rgb = `${c[0]},${c[1]},${c[2]}`;
    const ctx = this.rctx;
    ctx.clearRect(0, 0, 88, 88);
    ctx.strokeStyle = `rgba(${rgb},.13)`; ctx.lineWidth = 0.5;
    [14, 24, 36].forEach(r => { ctx.beginPath(); ctx.arc(44, 44, r, 0, Math.PI * 2); ctx.stroke(); });
    ctx.strokeStyle = `rgba(${rgb},.1)`;
    ctx.beginPath(); ctx.moveTo(44, 4); ctx.lineTo(44, 84); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 44); ctx.lineTo(84, 44); ctx.stroke();
    this.rA = (this.rA + 0.042) % (Math.PI * 2);
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = `rgba(${rgb},${(1 - i / 30) * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(44, 44);
      ctx.lineTo(44 + Math.cos(this.rA - i * 0.07) * 42, 44 + Math.sin(this.rA - i * 0.07) * 42);
      ctx.stroke();
    }
    ctx.save(); ctx.translate(44, 44); ctx.rotate(this.rA);
    ctx.strokeStyle = this.color.css; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(42, 0); ctx.stroke();
    ctx.restore();
    for (const b of this.blips) {
      ctx.beginPath();
      ctx.arc(44 + Math.cos(b.a) * b.r, 44 + Math.sin(b.a) * b.r, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${b.l})`; ctx.fill();
      b.l -= 0.005;
      if (b.l < 0) { b.a = Math.random() * Math.PI * 2; b.r = 10 + Math.random() * 32; b.l = 0.85; }
    }
    ctx.beginPath(); ctx.arc(44, 44, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = this.color.css; ctx.fill();
  }

  private drawMatrix() {
    const ctx = this.mctx;
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    ctx.fillRect(0, 0, this.matrixCanvas.width, this.matrixCanvas.height);
    ctx.font = '12px "Share Tech Mono"';
    ctx.fillStyle = this.color.css;
    const CHARS = 'アイウエオカキクABCDEFGHIJKLM0123456789#@!%*';
    const density = this.settings.fx.matrix.density;
    for (let x = 0; x < this.matrixCols.length; x++) {
      if (Math.random() > density) continue;
      const y = this.matrixCols[x];
      ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0], x * 13, y * 13);
      if (y * 13 > this.matrixCanvas.height && Math.random() > 0.97) this.matrixCols[x] = 0;
      else this.matrixCols[x]++;
    }
  }

  private firePing() {
    const el = this.pingEl;
    el.style.color = this.color.css;
    el.style.transition = 'none';
    el.style.width = '4px'; el.style.height = '4px'; el.style.opacity = '1';
    requestAnimationFrame(() => {
      el.style.transition = 'all 1500ms ease-out';
      el.style.width = '900px'; el.style.height = '900px'; el.style.opacity = '0';
    });
  }

  private fireNoise() {
    const el = this.noiseEl;
    const c = document.createElement('canvas');
    const W = 200, H = 120;
    c.width = W; c.height = H;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 60;
    }
    cx.putImageData(img, 0, 0);
    el.style.background = `url(${c.toDataURL()})`;
    el.style.opacity = '0.4';
    setTimeout(() => el.style.opacity = '0', 60);
  }

  dispose() {
    this.stopLoop();
    document.getElementById('ks-style')?.remove();
  }
}
