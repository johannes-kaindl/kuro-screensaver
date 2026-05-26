// Web Audio synthetic sound layer.
import type { ScreensaverSettings } from '../data/defaults';

export class AudioLayer {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  humOsc: OscillatorNode | null = null;
  humGain: GainNode | null = null;
  whineOsc: OscillatorNode | null = null;
  whineGain: GainNode | null = null;

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

  dispose() {
    try { this.humOsc?.stop(); this.whineOsc?.stop(); } catch {}
    this.ctx?.close();
    this.ctx = null;
  }
}
