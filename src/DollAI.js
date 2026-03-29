import { CONFIG } from "./config.js";

export class DollAI {
  constructor() {
    this.state = "safe"; // safe | transition | danger
    this.stateUntil = 0;
    this.rotation = Math.PI;
    this.bobTimer = 0;
  }

  start(now) {
    this.#setSafe(now);
  }

  update(now) {
    this.bobTimer += 0.08;

    if (now < this.stateUntil) return null;

    if (this.state === "safe") {
      this.state = "transition";
      this.rotation = Math.PI * 0.7;
      this.stateUntil = now + CONFIG.game.transitionMs;
      return "turn";
    }

    if (this.state === "transition") {
      this.#setDanger(now);
      return "danger";
    }

    this.#setSafe(now);
    return "safe";
  }

  #setSafe(now) {
    this.state = "safe";
    this.rotation = Math.PI;
    this.stateUntil = now + randomInRange(CONFIG.game.safeMinMs, CONFIG.game.safeMaxMs);
  }

  #setDanger(now) {
    this.state = "danger";
    this.rotation = 0;
    this.stateUntil = now + randomInRange(CONFIG.game.dangerMinMs, CONFIG.game.dangerMaxMs);
  }

  isDanger() {
    return this.state === "danger" || this.state === "transition";
  }

  getBeamPolygon() {
    const x = CONFIG.canvas.width / 2;
    const y = 180;
    const spread = CONFIG.game.beamAngle / 2;
    return {
      origin: { x, y },
      a: {
        x: x - Math.sin(spread) * CONFIG.game.beamLength,
        y: y + Math.cos(spread) * CONFIG.game.beamLength,
      },
      b: {
        x: x + Math.sin(spread) * CONFIG.game.beamLength,
        y: y + Math.cos(spread) * CONFIG.game.beamLength,
      },
    };
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}
