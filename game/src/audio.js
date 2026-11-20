// audio.js — all sound is synthesized with WebAudio: no audio files, no network.
// A tiny synth: engine hum (oscillator + filter tied to speed), siren (two-tone),
// and one-shot blips for gunshots, punches, coins, UI and mission stings.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // Engine: a low sawtooth through a low-pass filter, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // Siren: a sine that alternates between two notes.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

  function blip(freq, dur, type, vol, slideTo) {
    if (!started || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!started || !ctx) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  return {
    /** Call from a user gesture (start button) so the context is allowed to run. */
    unlock() { if (ensure()) resume(); },
    setMuted(m) {
      muted = m;
      if (master && ctx) master.gain.setValueAtTime(m ? 0 : 0.5, ctx.currentTime);
    },
    isMuted() { return muted; },
    /** Continuous engine note: speedRatio 0..1, on when the player drives. */
    setEngine(speedRatio, on) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(on ? 0.05 + speedRatio * 0.09 : 0, t, 0.08);
      engineOsc.frequency.setTargetAtTime(55 + speedRatio * 130, t, 0.1);
      engineFilter.frequency.setTargetAtTime(300 + speedRatio * 900, t, 0.1);
    },
    /** Siren wail; call every frame with wanted > 0 to keep it wailing. */
    setSiren(on, time) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.2);
      if (on) sirenOsc.frequency.setTargetAtTime(Math.sin(time * 2.4) > 0 ? 820 : 620, t, 0.05);
    },
    shoot() { noise(0.12, 0.5, 2600); blip(190, 0.08, 'square', 0.22, 60); },
    punch() { noise(0.09, 0.35, 900); },
    crash() { noise(0.35, 0.5, 700); },
    coin() { blip(880, 0.09, 'sine', 0.25); setTimeout(() => blip(1320, 0.14, 'sine', 0.25), 70); },
    ui() { blip(660, 0.06, 'sine', 0.18); },
    missionStart() { [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.25), i * 110)); },
    missionDone() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.28), i * 120)); },
    busted() { [392, 311, 233].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sawtooth', 0.2), i * 180)); },
    skid() { noise(0.18, 0.12, 1400); },
  };
}
