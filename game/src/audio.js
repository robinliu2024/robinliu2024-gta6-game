// Solmar Heat — audio: synthesized WebAudio only, no audio files.
// Engine hum (oscillator pitch follows speed), siren, gunshot, crash thud,
// mission sting, UI clicks. Everything is guarded: if WebAudio is missing
// or the context cannot start, every call is a safe no-op.

import { state } from './state.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = null;
    this.rotorOsc = null;
    this.rotorGain = null;
    this.rotorLfo = null;
    this.rotorLfoGain = null;
    this.ready = false;
  }

  // Call from the first user gesture (start button). Safe to call repeatedly.
  init() {
    if (this.ready) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = state.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.ready = true;
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* autoplay policy */ });
    }
  }

  setMuted(muted) {
    state.muted = !!muted;
    if (this.master && this.ctx) this.master.gain.value = muted ? 0 : 0.5;
  }

  _tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ready || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch { /* audio unavailable */ }
  }

  _noise(dur, vol = 0.4, lowpass = 1200) {
    if (!this.ready || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t);
    } catch { /* audio unavailable */ }
  }

  click() { this._tone(880, 0.06, 'square', 0.12); }

  gunshot(weaponId = 'pistol') {
    // Per-weapon report: pistol cracks, shotgun booms, rifle snaps.
    if (weaponId === 'shotgun') {
      this._noise(0.28, 0.7, 1400);
      this._tone(110, 0.22, 'square', 0.35, 45);
    } else if (weaponId === 'rifle') {
      this._noise(0.1, 0.5, 4200);
      this._tone(220, 0.07, 'square', 0.22, 70);
    } else {
      this._noise(0.14, 0.55, 3000);
      this._tone(160, 0.1, 'square', 0.25, 60);
    }
  }

  dryFire() { this._tone(1200, 0.04, 'square', 0.12); }

  reload() {
    this._tone(500, 0.05, 'square', 0.12);
    setTimeout(() => this._tone(700, 0.05, 'square', 0.12), 140);
  }

  punch() { this._noise(0.08, 0.3, 800); }

  crash() {
    this._noise(0.3, 0.5, 500);
    this._tone(90, 0.25, 'sine', 0.4, 40);
  }

  pickup() { this._tone(660, 0.1, 'sine', 0.25); this._tone(990, 0.14, 'sine', 0.25); }

  // Little two-note mission sting.
  sting() {
    if (!this.ready || !this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.22, 'triangle', 0.28), i * 110);
    });
  }

  fail() {
    this._tone(392, 0.25, 'sawtooth', 0.2, 311);
    setTimeout(() => this._tone(311, 0.4, 'sawtooth', 0.2, 233), 200);
  }

  // Continuous engine hum: call every frame with speed in mph.
  engine(speedMph) {
    if (!this.ready || !this.ctx) return;
    try {
      if (!this.engineOsc) {
        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 50;
        this.engineGain.gain.value = 0;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineOsc.start();
      }
      const target = speedMph > 0.5 ? 0.05 + Math.min(0.1, speedMph / 1200) : 0;
      this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
      this.engineOsc.frequency.setTargetAtTime(45 + speedMph * 2.2, this.ctx.currentTime, 0.08);
    } catch { /* audio unavailable */ }
  }

  engineOff() {
    if (this.engineGain && this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  // Two-tone siren while any cop is active.
  siren(on) {
    if (!this.ready || !this.ctx) return;
    try {
      if (on && !this.sirenOsc) {
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenGain = this.ctx.createGain();
        this.sirenOsc.type = 'triangle';
        this.sirenOsc.frequency.value = 700;
        this.sirenGain.gain.value = 0.045;
        this.sirenOsc.connect(this.sirenGain);
        this.sirenGain.connect(this.master);
        this.sirenOsc.start();
        let high = false;
        this.sirenTimer = setInterval(() => {
          if (!this.sirenOsc) return;
          high = !high;
          this.sirenOsc.frequency.setTargetAtTime(high ? 950 : 650, this.ctx.currentTime, 0.05);
        }, 380);
      } else if (!on && this.sirenOsc) {
        clearInterval(this.sirenTimer);
        this.sirenTimer = null;
        const osc = this.sirenOsc;
        const gain = this.sirenGain;
        this.sirenOsc = null;
        this.sirenGain = null;
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 400);
      }
    } catch { /* audio unavailable */ }
  }

  // Helicopter rotor chop while the air unit is overhead: a low sawtooth
  // through a lowpass, with an 11 Hz LFO chopping its gain.
  heli(on) {
    if (!this.ready || !this.ctx) return;
    try {
      if (on && !this.rotorOsc) {
        this.rotorOsc = this.ctx.createOscillator();
        this.rotorGain = this.ctx.createGain();
        this.rotorOsc.type = 'sawtooth';
        this.rotorOsc.frequency.value = 55;
        this.rotorGain.gain.value = 0;
        this.rotorLfo = this.ctx.createOscillator();
        this.rotorLfoGain = this.ctx.createGain();
        this.rotorLfo.type = 'sine';
        this.rotorLfo.frequency.value = 11;
        this.rotorLfoGain.gain.value = 0.025;
        this.rotorLfo.connect(this.rotorLfoGain);
        this.rotorLfoGain.connect(this.rotorGain.gain);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 220;
        this.rotorOsc.connect(filter);
        filter.connect(this.rotorGain);
        this.rotorGain.connect(this.master);
        this.rotorOsc.start();
        this.rotorLfo.start();
        this.rotorGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.3);
      } else if (!on && this.rotorOsc) {
        const osc = this.rotorOsc;
        const lfo = this.rotorLfo;
        const gain = this.rotorGain;
        this.rotorOsc = null;
        this.rotorLfo = null;
        this.rotorGain = null;
        this.rotorLfoGain = null;
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
        setTimeout(() => { try { osc.stop(); lfo.stop(); } catch { /* already stopped */ } }, 500);
      }
    } catch { /* audio unavailable */ }
  }
}

export const audio = new AudioEngine();
export default audio;
