import { CONFIG } from "./config.js";

export class VisionSystem {
  constructor() {
    this.origin = { x: CONFIG.canvas.width / 2, y: CONFIG.game.cone.originY };
    this.radius = CONFIG.game.cone.radius;
    this.halfAngle = CONFIG.game.cone.halfAngle;
    this.baseDirection = CONFIG.game.cone.baseDirection;
    this.sweepArc = CONFIG.game.cone.sweepArc;
    this.currentDirection = this.baseDirection;
    this.levelFactor = 1;
    this.scanState = {
      directionSign: Math.random() > 0.5 ? 1 : -1,
      angularSpeed: CONFIG.game.cone.minAngularSpeed,
      nextVariationAt: 0,
      pausedUntil: 0,
      halfAngle: this.halfAngle,
    };
  }

  setLevel(level) {
    const profile = profileForLevel(level);
    this.levelFactor = 1 + (level - 1) * 0.28;
    this.scanState.angularSpeed = (CONFIG.game.cone.minAngularSpeed + profile.turnMs * 0.00001) * this.levelFactor;
    this.scanState.nextVariationAt = 0;
    this.scanState.pausedUntil = 0;
    this.scanState.halfAngle = this.halfAngle;
  }

  update(now, { scanning = false, aggressive = false } = {}) {
    if (!scanning) {
      this.currentDirection = this.baseDirection;
      this.scanState.halfAngle = this.halfAngle;
      return;
    }

    const maxOffset = this.sweepArc / 2;
    const speedMultiplier = aggressive ? CONFIG.game.cone.speedMultiplier : 1;
    this.scanState.halfAngle = aggressive
      ? this.halfAngle * CONFIG.game.cone.aggressiveHalfAngleScale
      : this.halfAngle;

    if (now >= this.scanState.nextVariationAt) {
      const minSpeed = CONFIG.game.cone.minAngularSpeed * this.levelFactor;
      const maxSpeed = CONFIG.game.cone.maxAngularSpeed * this.levelFactor;
      this.scanState.angularSpeed = randomInRange(minSpeed, maxSpeed);
      this.scanState.directionSign = Math.random() > 0.5 ? 1 : -1;
      this.scanState.nextVariationAt = now + randomInRange(70, 220);

      if (Math.random() < CONFIG.game.cone.pauseChance) {
        this.scanState.pausedUntil = now + randomInRange(45, 125);
      }
      if (Math.random() < CONFIG.game.cone.jumpChance) {
        this.currentDirection += randomInRange(-0.2, 0.2);
      }
    }

    if (now >= this.scanState.pausedUntil) {
      this.currentDirection += this.scanState.directionSign * this.scanState.angularSpeed * speedMultiplier;
    }

    const minDir = this.baseDirection - maxOffset;
    const maxDir = this.baseDirection + maxOffset;
    if (this.currentDirection < minDir) {
      this.currentDirection = minDir + randomInRange(0.03, 0.12);
      this.scanState.directionSign = 1;
    } else if (this.currentDirection > maxDir) {
      this.currentDirection = maxDir - randomInRange(0.03, 0.12);
      this.scanState.directionSign = -1;
    }
  }

  getCone() {
    const activeHalfAngle = this.scanState.halfAngle;
    const left = this.currentDirection - activeHalfAngle;
    const right = this.currentDirection + activeHalfAngle;
    return {
      origin: this.origin,
      radius: this.radius,
      direction: this.currentDirection,
      leftAngle: left,
      rightAngle: right,
      p1: {
        x: this.origin.x + Math.cos(left) * this.radius,
        y: this.origin.y + Math.sin(left) * this.radius,
      },
      p2: {
        x: this.origin.x + Math.cos(right) * this.radius,
        y: this.origin.y + Math.sin(right) * this.radius,
      },
    };
  }

  isPointInside(point) {
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > this.radius) return false;

    const pointAngle = Math.atan2(dy, dx);
    const diff = shortestAngle(pointAngle, this.currentDirection);
    return Math.abs(diff) <= this.scanState.halfAngle;
  }
}

function shortestAngle(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function profileForLevel(level) {
  const profiles = CONFIG.game.levelProfiles;
  return profiles[Math.min(profiles.length - 1, Math.max(0, level - 1))];
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}
