import { CONFIG } from "./config.js";

export class PlayerManager {
  constructor() {
    this.players = new Map();
    this.sequence = 1;
  }

  addPlayer(username) {
    const id = `p_${this.sequence++}`;
    const player = {
      id,
      username,
      x: this.#lanePosition(),
      y: randomInRange(CONFIG.player.spawnMinY, CONFIG.player.spawnMaxY),
      startY: CONFIG.game.startLineY,
      color: randomPaletteColor(),
      state: "alive", // alive | eliminated | winner | ranking
      shields: 0,
      lastMoveAt: 0,
      movedInDanger: false,
      eliminatedAt: 0,
      rank: null,
      rankAnimStartAt: 0,
      rankFrom: null,
      bounce: 0,
      velocityY: 0,
      pendingImpulses: [],
      explosionParticles: [],
      frozenUntil: 0,
    };
    this.players.set(id, player);
    return player;
  }

  applyTap(id, now, isDanger) {
    const p = this.players.get(id);
    if (!p || p.state !== "alive") return false;
    p.pendingImpulses.push({
      dueAt: now + CONFIG.player.tapDelayMs,
      danger: isDanger,
    });
    return true;
  }

  applyGlobalTap(now, isDanger) {
    let moved = false;
    for (const p of this.players.values()) {
      if (p.state !== "alive") continue;
      p.pendingImpulses.push({
        dueAt: now + CONFIG.player.tapDelayMs,
        danger: isDanger,
      });
      moved = true;
    }
    return moved;
  }

  eliminatePlayer(id, now, { bypassShield = false } = {}) {
    const p = this.players.get(id);
    if (!p || p.state !== "alive") return null;
    if (!bypassShield && p.shields > 0) {
      p.shields -= 1;
      return { player: p, blockedByShield: true };
    }
    p.state = "eliminated";
    p.eliminatedAt = now;
    p.explosionParticles = createExplosionParticles();
    return { player: p, blockedByShield: false };
  }

  markWinner(id, place, now) {
    const p = this.players.get(id);
    if (!p || p.state !== "alive") return null;
    p.state = "winner";
    p.rank = place;
    p.rankAnimStartAt = now;
    p.rankFrom = { x: p.x, y: p.y };
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  update(now, { isDanger = false, freezeExcept = null, forceFrozen = false } = {}) {
    for (const [id, p] of this.players.entries()) {
      const frozenByGift = freezeExcept && p.username !== freezeExcept;
      const frozenByIce = forceFrozen && p.frozenUntil > now;
      const frozen = frozenByGift || frozenByIce;
      if (p.bounce > 0) p.bounce = Math.max(0, p.bounce - 0.08);
      while (!frozen && p.pendingImpulses.length > 0 && p.pendingImpulses[0].dueAt <= now) {
        const impulse = p.pendingImpulses.shift();
        p.velocityY += CONFIG.player.speedPerTap;
        p.lastMoveAt = now;
        p.bounce = 1;
        if (impulse?.danger) p.movedInDanger = true;
      }

      if (!frozen && p.velocityY > 0) {
        p.y -= p.velocityY;
        if (p.y <= CONFIG.game.finishLineY) {
          p.y = CONFIG.game.finishLineY;
          p.velocityY = 0;
          p.pendingImpulses = [];
        }
        if (isDanger && p.velocityY > 0.01) {
          p.movedInDanger = true;
        }
        p.velocityY *= CONFIG.player.speedDamping;
        if (p.velocityY < 0.02) p.velocityY = 0;
      }

      if (p.state === "winner") {
        const t = Math.min(1, (now - p.rankAnimStartAt) / CONFIG.player.rankTravelMs);
        p.x = lerp(p.rankFrom.x, 500, t);
        p.y = lerp(p.rankFrom.y, 94 + p.rank * 26, t);
        if (t >= 1) {
          p.state = "ranking";
          this.players.delete(id);
        }
      }

      if (p.state === "eliminated" && now - p.eliminatedAt > CONFIG.player.eliminationFadeMs) {
        this.players.delete(id);
      }

      if (p.state === "eliminated" && p.explosionParticles.length > 0) {
        const t = (now - p.eliminatedAt) / CONFIG.player.eliminationFadeMs;
        for (const particle of p.explosionParticles) {
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.vy += 0.02;
          particle.life = Math.max(0, 1 - t);
        }
      }
    }
  }

  resetRoundToStart() {
    for (const p of this.players.values()) {
      if (p.state === "alive") {
        p.y = randomInRange(CONFIG.player.spawnMinY, CONFIG.player.spawnMaxY);
        p.movedInDanger = false;
        p.velocityY = 0;
        p.pendingImpulses = [];
      }
    }
  }

  clearAll() {
    this.players.clear();
  }

  addShieldByUsername(username, amount) {
    const p = this.getAliveByUsername(username);
    if (!p) return null;
    p.shields += amount;
    return p;
  }

  applyIceBreath(now, pushBackPercent) {
    for (const p of this.getAlive()) {
      if (p.shields > 0) {
        p.shields -= 1;
        continue;
      }
      p.frozenUntil = now + CONFIG.game.iceBreath.durationMs;
      p.velocityY = 0;
      p.pendingImpulses = [];
      const totalTrack = CONFIG.game.startLineY - CONFIG.game.finishLineY;
      p.y = Math.min(CONFIG.game.startLineY, p.y + totalTrack * pushBackPercent);
    }
  }

  getAliveByUsername(username) {
    return this.getAlive().find((p) => p.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  getAll() {
    return [...this.players.values()];
  }

  getAlive() {
    return this.getAll().filter((p) => p.state === "alive");
  }

  getAliveCount() {
    return this.getAlive().length;
  }

  getMoversInDanger() {
    return this.getAlive().filter((p) => p.movedInDanger);
  }

  clearDangerMovementFlags() {
    for (const p of this.players.values()) p.movedInDanger = false;
  }

  #lanePosition() {
    return randomInRange(CONFIG.player.lanePadding, CONFIG.canvas.width - CONFIG.player.lanePadding);
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomPaletteColor() {
  const palette = ["#80ed99", "#7bdff2", "#ffd166", "#cdb4db", "#ffadad", "#bde0fe"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createExplosionParticles() {
  const amount = 16;
  return Array.from({ length: amount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / amount + Math.random() * 0.35;
    const speed = 1.4 + Math.random() * 2.2;
    return {
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.8,
      size: 2 + Math.random() * 3.5,
      life: 1,
    };
  });
}
