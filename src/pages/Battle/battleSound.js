/**
 * Minimal Web Audio synthesized music + SFX for the battle screen -- no
 * audio asset files are bundled, everything here is generated tones
 * (oscillator + gain envelope), same approach as PFSound in maingame.jsx.
 */
export default class BattleSound {
  constructor() {
    this.ctx = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  /** Browsers block audio until a real user gesture resumes the context -- call this from a click/keydown handler. */
  unlock() {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  beep(freq, duration = 0.12, type = "sine", volume = 0.15, delay = 0) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  ready() {
    this.beep(392, 0.2, "triangle", 0.18);
  }
  fight() {
    this.beep(523, 0.1, "square", 0.2);
    this.beep(659, 0.18, "square", 0.2, 0.09);
  }
  start() {
    this.beep(880, 0.22, "sawtooth", 0.18);
  }
  tap() {
    this.beep(680 + Math.random() * 140, 0.045, "square", 0.05);
  }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.beep(f, 0.2, "sine", 0.16, i * 0.11));
  }
  lose() {
    [392, 330, 262].forEach((f, i) => this.beep(f, 0.3, "sawtooth", 0.14, i * 0.17));
  }

  /** Looping low pulsing "tug-of-war tension" bassline, plays for the duration of the match. */
  startMusic() {
    if (this.musicTimer) return;
    const pattern = [110, 110, 146.83, 110, 130.81, 110, 146.83, 98];
    const step = () => {
      const note = pattern[this.musicStep % pattern.length];
      this.beep(note, 0.24, "triangle", 0.05);
      if (this.musicStep % 4 === 0) this.beep(note * 2, 0.1, "sine", 0.03, 0.05);
      this.musicStep++;
    };
    step();
    this.musicTimer = setInterval(step, 320);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  dispose() {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
