import { CONFIG } from "./config.js";

export class PlayerManager {
  constructor() {
    this.players = new Map();
    this.sequence = 1;
  }

  addPlayer(username) {
    const id = `p_${this.sequence++}`;
    const x = this.#lanePosition();
    const y = randomInRange(CONFIG.player.spawnMinY, CONFIG.player.spawnMaxY);
    const player = {
      id,
      username,
      x,
      y,
      color: "#f6f6f6",
      state: "alive", // alive | eliminated | winner
      lastMoveAt: 0,
      eliminatedAt: 0,
      rank: null,
    };
    this.players.set(id, player);
    return player;
  }

  applyTap(id, now, isDanger) {
    const player = this.players.get(id);
    if (!player || player.state !== "alive") return;

    player.y -= CONFIG.player.speedPerTap;
    player.lastMoveAt = now;

    if (isDanger) {
      player.movedInDanger = true;
    }
  }

  applyGlobalTap(now, isDanger) {
    for (const player of this.players.values()) {
      if (player.state !== "alive") continue;
      player.y -= CONFIG.player.speedPerTap;
      player.lastMoveAt = now;
      if (isDanger) player.movedInDanger = true;
    }
  }

  eliminatePlayer(id, now) {
    const player = this.players.get(id);
    if (!player || player.state !== "alive") return;
    player.state = "eliminated";
    player.color = "#ff4545";
    player.eliminatedAt = now;
  }

  markWinner(id, place) {
    const player = this.players.get(id);
    if (!player || player.state !== "alive") return;
    player.state = "winner";
    player.rank = place;
    player.color = "#ffe066";
  }

  resetRound() {
    this.players.clear();
  }

  getAll() {
    return [...this.players.values()];
  }

  getAliveCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.state === "alive") count += 1;
    }
    return count;
  }

  getMoversInDanger() {
    return this.getAll().filter((p) => p.state === "alive" && p.movedInDanger);
  }

  clearDangerMovementFlags() {
    for (const player of this.players.values()) {
      player.movedInDanger = false;
    }
  }

  cleanupEliminated(now) {
    for (const [id, p] of this.players.entries()) {
      if (p.state === "eliminated" && now - p.eliminatedAt > CONFIG.player.eliminationFadeMs) {
        this.players.delete(id);
      }
    }
  }

  getLiveAndWinners() {
    return this.getAll().filter((p) => p.state === "alive" || p.state === "winner");
  }

  #lanePosition() {
    return randomInRange(CONFIG.player.lanePadding, CONFIG.canvas.width - CONFIG.player.lanePadding);
  }
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}
