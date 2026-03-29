import { CONFIG } from "./config.js";

export class VisionSystem {
  constructor() {
    this.origin = { x: CONFIG.canvas.width / 2, y: CONFIG.game.cone.originY };
    this.radius = CONFIG.game.cone.radius;
    this.halfAngle = CONFIG.game.cone.halfAngle;
    this.baseDirection = CONFIG.game.cone.baseDirection;
    this.sweepArc = CONFIG.game.cone.sweepArc;
    this.sweepSpeed = 0.001;
    this.currentDirection = this.baseDirection;
  }

  setLevel(level) {
    const profile = profileForLevel(level);
    this.sweepSpeed = profile.coneSweepSpeed;
  }

  update(now) {
    const sweep = Math.sin(now * this.sweepSpeed) * (this.sweepArc / 2);
    this.currentDirection = this.baseDirection + sweep;
  }

  getCone() {
    const left = this.currentDirection - this.halfAngle;
    const right = this.currentDirection + this.halfAngle;
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
    return Math.abs(diff) <= this.halfAngle;
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
