export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  enable() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    this.enabled = true;
  }

  tap() {
    this.#blip(660, 0.03, "square", 0.04);
  }

  turn() {
    this.#sweep(210, 690, 0.22);
  }

  elimination() {
    this.#blip(120, 0.15, "sawtooth", 0.08);
  }

  win() {
    this.#blip(820, 0.12, "triangle", 0.05);
    this.#blip(1040, 0.09, "triangle", 0.05, 0.1);
  }

  #blip(freq, duration, type, gain = 0.04, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const vol = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    vol.gain.value = gain;
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(vol);
    vol.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  #sweep(from, to, duration) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const vol = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    vol.gain.setValueAtTime(0.06, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(vol);
    vol.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }
}
