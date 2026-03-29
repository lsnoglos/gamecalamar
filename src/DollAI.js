import { CONFIG } from "./config.js";

export class DollAI {
  constructor() {
    this.state = "safe"; // safe | turn | danger
    this.stateUntil = 0;
    this.level = 1;
    this.rotation = Math.PI;
    this.turnStartAt = 0;
  }

  start(now, level = 1) {
    this.level = level;
    this.#setSafe(now);
  }

  update(now) {
    if (now < this.stateUntil) return null;

    if (this.state === "safe") {
      this.state = "turn";
      this.turnStartAt = now;
      this.stateUntil = now + CONFIG.game.turnMs;
      return "turn";
    }

    if (this.state === "turn") {
      this.#setDanger(now);
      return "danger";
    }

    this.#setSafe(now);
    return "safe";
  }

  #setSafe(now) {
    this.state = "safe";
    this.rotation = Math.PI;
    const minMs = Math.max(CONFIG.game.minSafeMs, CONFIG.game.safeMinMs - (this.level - 1) * CONFIG.game.levelSafeReduction);
    const maxMs = Math.max(minMs + 250, CONFIG.game.safeMaxMs - (this.level - 1) * CONFIG.game.levelSafeReduction * 1.2);
    this.stateUntil = now + randomInRange(minMs, maxMs);
  }

  #setDanger(now) {
    this.state = "danger";
    this.rotation = 0;
    const minMs = Math.max(CONFIG.game.minDangerMs, CONFIG.game.dangerMinMs - (this.level - 1) * CONFIG.game.levelDangerReduction);
    const maxMs = Math.max(minMs + 200, CONFIG.game.dangerMaxMs - (this.level - 1) * CONFIG.game.levelDangerReduction * 1.25);
    this.stateUntil = now + randomInRange(minMs, maxMs);
  }

  isDanger() {
    return this.state === "danger" || this.state === "turn";
  }

  getBeamRect() {
    const x = CONFIG.canvas.width / 2 - CONFIG.game.beamWidth / 2;
    const y = 190;
    return {
      x,
      y,
      width: CONFIG.game.beamWidth,
      height: CONFIG.game.beamLength,
    };
  }

  isInsideBeam(point) {
    const beam = this.getBeamRect();
    return point.x >= beam.x && point.x <= beam.x + beam.width && point.y >= beam.y && point.y <= beam.y + beam.height;
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}
