import { CONFIG } from "./config.js";

export class RankingSystem {
  constructor() {
    this.winners = [];
    this.winCounts = new Map();
    this.monthlyWins = new Map();
    this.activeMonth = currentMonthKey();
  }

  registerWinner(player) {
    if (this.winners.some((w) => w.id === player.id)) return null;
    this.#ensureMonthBoundary();

    const totalWins = (this.winCounts.get(player.username) ?? 0) + 1;
    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    const monthlyWins = (monthMap.get(player.username) ?? 0) + 1;
    monthMap.set(player.username, monthlyWins);
    this.monthlyWins.set(this.activeMonth, monthMap);
    this.winCounts.set(player.username, totalWins);

    const result = {
      id: player.id,
      username: player.username,
      timestamp: performance.now(),
      place: this.winners.length + 1,
      wins: totalWins,
    };
    this.winners.push(result);
    return result;
  }

  topWinners(limit = CONFIG.game.maxWinners) {
    return this.winners.slice(0, limit);
  }

  monthlyTop(limit = 3) {
    this.#ensureMonthBoundary();
    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    return [...monthMap.entries()]
      .map(([username, wins]) => ({ username, wins }))
      .sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username))
      .slice(0, limit);
  }

  hasRequiredWinners() {
    return this.winners.length >= CONFIG.game.maxWinners;
  }

  reset() {
    this.winners = [];
  }

  #ensureMonthBoundary() {
    const currentMonth = currentMonthKey();
    if (this.activeMonth === currentMonth) return;
    this.activeMonth = currentMonth;
  }
}

function currentMonthKey() {
  const date = new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
