// Web Audio synthetic sound layer.
import type { ScreensaverSettings } from '../data/defaults';

export class AudioLayer {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  humOsc: OscillatorNode | null = null;
  humGain: GainNode | null = null;
  whineOsc: OscillatorNode | null = null;
  whineGain: GainNode | null = null;

  // Carpenter soundscape — minimalist 80s synth score.
  private synthMaster: GainNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private bassFilterLFO: OscillatorNode | null = null;
  private bassFilterLFOGain: GainNode | null = null;
  private droneA: OscillatorNode | null = null;
  private droneE: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneFilterLFO: OscillatorNode | null = null;
  private droneFilterLFOGain: GainNode | null = null;
  private arpInterval: number | null = null;
  private bassInterval: number | null = null;
  private arpStep = 0;

  constructor(public settings: ScreensaverSettings) {}

  start() {
    if (!this.settings.sound.master) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.sound.volume;
      this.master.connect(this.ctx.destination);
      if (this.settings.sound.hum) this.startHum();
      if (this.settings.sound.scanlineWhine) this.startWhine();
      const sscape = this.settings.sound.synthSoundscape;
      if (sscape === 'carpenter') this.startCarpenterSoundscape();
      else if (sscape === 'bach') console.info('Bach soundscape pending');
    } catch (e) {
      console.warn('AudioLayer init failed:', e);
    }
  }

  private startHum() {
    if (!this.ctx || !this.master) return;
    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = 'sine'; this.humOsc.frequency.value = 60;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    this.humGain = this.ctx.createGain(); this.humGain.gain.value = 0.025;
    this.humOsc.connect(lp).connect(this.humGain).connect(this.master);
    this.humOsc.start();
  }

  private startWhine() {
    if (!this.ctx || !this.master) return;
    this.whineOsc = this.ctx.createOscillator();
    this.whineOsc.type = 'sine'; this.whineOsc.frequency.value = 15700;
    this.whineGain = this.ctx.createGain(); this.whineGain.gain.value = 0.005;
    this.whineOsc.connect(this.whineGain).connect(this.master);
    this.whineOsc.start();
  }

  bootBeep() {
    if (!this.ctx || !this.master || !this.settings.sound.bootSounds) return;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 880;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, this.ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);
    o.connect(g).connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.09);
  }

  sceneSwitch() {
    if (!this.ctx || !this.master || !this.settings.sound.sceneSwitch) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.4);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + 0.55);
  }

  boostStart() {
    if (!this.ctx || !this.master || !this.settings.sound.boost) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.6, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(60, t);
    lp.frequency.exponentialRampToValueAtTime(2000, t + 0.6);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(lp).connect(g).connect(this.master); src.start(t);
  }

  ping() {
    if (!this.ctx || !this.master || !this.settings.sound.radarPing) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 800;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.55);
  }

  setVolume(v: number) { if (this.master) this.master.gain.value = v; }

  // ── Carpenter-80s soundscape ──────────────────────────────────────────
  // Layered Dorian-on-A: arpeggio (square @80 BPM 16th) + bass-pulse (saw
  // through LP-LFO filter) + drone-pad (triangle A2+E3 through slow filter
  // sweep). Idle-drift pauses arpeggio + bass, drone stays.
  private startCarpenterSoundscape() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;

    this.synthMaster = ctx.createGain();
    this.synthMaster.gain.value = 0.4;        // 40% of master sub-bus
    this.synthMaster.connect(this.master);

    // ── Bass filter (lowpass) with slow LFO (period 4s, 300–900 Hz) ──
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.frequency.value = 600;
    this.bassFilter.Q.value = 1.2;
    this.bassFilterLFO = ctx.createOscillator();
    this.bassFilterLFO.type = 'sine';
    this.bassFilterLFO.frequency.value = 0.25;    // 4s period
    this.bassFilterLFOGain = ctx.createGain();
    this.bassFilterLFOGain.gain.value = 300;      // ±300 around 600
    this.bassFilterLFO.connect(this.bassFilterLFOGain).connect(this.bassFilter.frequency);
    this.bassFilterLFO.start();
    // Bass sub-bus
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.55;
    this.bassFilter.connect(bassGain).connect(this.synthMaster);

    // ── Drone pad (A2 + E3 triangles) through slow filter sweep ──
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 1200;
    this.droneFilter.Q.value = 0.6;
    this.droneFilterLFO = ctx.createOscillator();
    this.droneFilterLFO.type = 'sine';
    this.droneFilterLFO.frequency.value = 1 / 30;  // 30s period
    this.droneFilterLFOGain = ctx.createGain();
    this.droneFilterLFOGain.gain.value = 800;      // 400–2000
    this.droneFilterLFO.connect(this.droneFilterLFOGain).connect(this.droneFilter.frequency);
    this.droneFilterLFO.start();
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.25;
    this.droneFilter.connect(droneGain).connect(this.synthMaster);
    this.droneA = ctx.createOscillator();
    this.droneA.type = 'triangle';
    this.droneA.frequency.value = 110;             // A2
    this.droneE = ctx.createOscillator();
    this.droneE.type = 'triangle';
    this.droneE.frequency.value = 164.81;          // E3
    this.droneA.connect(this.droneFilter);
    this.droneE.connect(this.droneFilter);
    this.droneA.start();
    this.droneE.start();

    this.startArpeggio();
    this.startBassPulse();
  }

  private startArpeggio() {
    if (!this.ctx || !this.synthMaster) return;
    // A4 → E4 → A4 → D5 — 16th notes @ 80 BPM = 187.5 ms each.
    const pattern = [440, 329.63, 440, 587.33];
    this.arpStep = 0;
    const tick = () => {
      if (!this.ctx || !this.synthMaster) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = pattern[this.arpStep % pattern.length];
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(env).connect(this.synthMaster);
      o.start(t);
      o.stop(t + 0.2);
      this.arpStep++;
    };
    this.arpInterval = window.setInterval(tick, 187.5) as unknown as number;
  }

  private startBassPulse() {
    if (!this.ctx || !this.synthMaster || !this.bassFilter) return;
    // A2 pulse on each quarter note @ 80 BPM = 750 ms.
    const tick = () => {
      if (!this.ctx || !this.bassFilter) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 110;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(env).connect(this.bassFilter);
      o.start(t);
      o.stop(t + 0.7);
    };
    this.bassInterval = window.setInterval(tick, 750) as unknown as number;
  }

  /** Pause arpeggio + bass (idle-drift). Drone stays sustained. */
  pauseSoundscape() {
    if (this.arpInterval != null) { clearInterval(this.arpInterval); this.arpInterval = null; }
    if (this.bassInterval != null) { clearInterval(this.bassInterval); this.bassInterval = null; }
  }

  /** Resume arpeggio + bass after idle-drift wakeup. */
  resumeSoundscape() {
    if (!this.synthMaster) return;
    if (this.arpInterval == null) this.startArpeggio();
    if (this.bassInterval == null) this.startBassPulse();
  }

  private stopSoundscape() {
    this.pauseSoundscape();
    try {
      this.droneA?.stop(); this.droneE?.stop();
      this.bassFilterLFO?.stop(); this.droneFilterLFO?.stop();
    } catch {}
    this.synthMaster = null;
    this.bassFilter = this.bassFilterLFO = this.bassFilterLFOGain = null;
    this.droneA = this.droneE = this.droneFilterLFO = null;
    this.droneFilter = null;
    this.droneFilterLFOGain = null;
  }

  dispose() {
    try { this.humOsc?.stop(); this.whineOsc?.stop(); } catch {}
    this.stopSoundscape();
    this.ctx?.close();
    this.ctx = null;
  }
}
