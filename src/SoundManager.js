const SOUND_FILES = {
  doll_idle: "/sonido/doll_idle.mp3",
  doll_turn: "/sonido/doll_turn.mp3",
  elimination: "/sonido/elimination.mp3",
  victory: "/sonido/victory.mp3",
  step: "/sonido/step.mp3",
  cookie_warning: "/audio/cookie_warning.mp3",
  cookie_impact: "/audio/cookie_impact.mp3",
};

export class SoundManager {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.bank = new Map();
    this.idleLoop = null;

    Object.entries(SOUND_FILES).forEach(([name, src]) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      this.bank.set(name, audio);
    });
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.ctx = new AudioContext();
  }

  playStep() {
    this.#play("step", 0.35);
  }

  playTurn() {
    this.stopIdle();
    this.#play("doll_turn", 0.6, () => this.#sweep(260, 780, 0.2));
  }

  playScan() {
    this.#sweep(700, 320, 0.32);
  }

  playElimination() {
    this.#play("elimination", 0.55, () => this.#blip(130, 0.14, "sawtooth", 0.08));
  }

  playVictory() {
    this.#play("victory", 0.7, () => {
      this.#blip(830, 0.11, "triangle", 0.05);
      this.#blip(1020, 0.1, "triangle", 0.05, 0.12);
    });
  }

  playCookieWarning() {
    this.#play("cookie_warning", 0.5, () => {
      this.#blip(900, 0.1, "square", 0.05);
      this.#blip(900, 0.1, "square", 0.05, 0.18);
      this.#blip(900, 0.1, "square", 0.05, 0.36);
    });
  }

  playCookieImpact() {
    this.#play("cookie_impact", 0.65, () => this.#sweep(180, 45, 0.4));
  }

  playIdle() {
    if (!this.enabled) return;
    if (this.idleLoop) return;
    const a = this.#clone("doll_idle");
    if (!a) return;
    a.loop = true;
    a.volume = 0.35;
    a.play().catch(() => this.#hum());
    this.idleLoop = a;
  }

  stopIdle() {
    if (!this.idleLoop) return;
    this.idleLoop.pause();
    this.idleLoop.currentTime = 0;
    this.idleLoop = null;
  }

  #play(name, volume = 0.5, fallback = null) {
    if (!this.enabled) return;
    const audio = this.#clone(name);
    if (!audio) {
      fallback?.();
      return;
    }
    audio.volume = volume;
    audio.play().catch(() => fallback?.());
  }

  #clone(name) {
    const a = this.bank.get(name);
    return a ? a.cloneNode() : null;
  }

  #blip(freq, duration, type, gain = 0.04, delay = 0) {
    if (!this.ctx) return;
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
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const vol = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    vol.gain.setValueAtTime(0.055, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(vol);
    vol.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  #hum() {
    this.#blip(180, 0.5, "sine", 0.01);
  }
}
