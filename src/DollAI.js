import { CONFIG } from "./config.js";

export class DollAI {
  constructor() {
    this.state = "safe"; // safe | turn | dangerHold | danger
    this.stateUntil = 0;
    this.level = 1;
    this.rotation = Math.PI;
    this.turnStartAt = 0;
    this.turnDuration = 190;
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
      this.turnDuration = profileForLevel(this.level).turnMs;
      this.stateUntil = now + this.turnDuration;
      return "turn";
    }

    if (this.state === "turn") {
      this.state = "dangerHold";
      this.rotation = 0;
      this.stateUntil = now + CONFIG.game.preScanDelayMs;
      return "dangerHold";
    }

    if (this.state === "dangerHold") {
      this.#setDanger(now);
      return "danger";
    }

    this.#setSafe(now);
    return "safe";
  }

  shiftTime(deltaMs) {
    this.stateUntil += deltaMs;
    this.turnStartAt += deltaMs;
  }

  #setSafe(now) {
    this.state = "safe";
    this.rotation = Math.PI;
    const profile = profileForLevel(this.level);
    this.stateUntil = now + randomInRange(profile.safeMinMs, profile.safeMaxMs);
  }

  #setDanger(now) {
    this.state = "danger";
    this.rotation = 0;
    const profile = profileForLevel(this.level);
    this.stateUntil = now + randomInRange(profile.dangerMinMs, profile.dangerMaxMs);
  }

  isDanger() {
    return this.state === "danger" || this.state === "turn" || this.state === "dangerHold";
  }

  isScanning() {
    return this.state === "danger";
  }

  turnProgress(now) {
    if (this.state !== "turn") return this.state === "danger" ? 1 : 0;
    return Math.min(1, (now - this.turnStartAt) / this.turnDuration);
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function profileForLevel(level) {
  const profiles = CONFIG.game.levelProfiles;
  return profiles[Math.min(profiles.length - 1, Math.max(0, level - 1))];
}
