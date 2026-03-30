import { CONFIG } from "./config.js";

export class RankingSystem {
  constructor() {
    this.winners = [];
    this.dailyWins = new Map();
    this.monthlyWins = new Map();
    this.activeDay = currentGameDayKey();
    this.activeMonth = currentMonthKey();
  }

  registerWinner(player) {
    if (this.winners.some((w) => w.id === player.id)) return null;
    this.#ensureDayBoundary();
    this.#ensureMonthBoundary();

    const dailyWins = (this.dailyWins.get(player.username) ?? 0) + 1;
    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    const monthlyWins = (monthMap.get(player.username) ?? 0) + 1;
    monthMap.set(player.username, monthlyWins);
    this.monthlyWins.set(this.activeMonth, monthMap);
    this.dailyWins.set(player.username, dailyWins);

    const result = {
      id: player.id,
      username: player.username,
      timestamp: Date.now(),
      place: this.winners.length + 1,
      wins: dailyWins,
    };
    this.winners.push(result);
    return result;
  }

  topWinners(limit = CONFIG.game.maxWinners) {
    this.#ensureDayBoundary();
    return [...this.dailyWins.entries()]
      .map(([username, wins]) => ({ username, wins }))
      .sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username))
      .slice(0, limit);
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

  #ensureDayBoundary() {
    const currentDay = currentGameDayKey();
    if (this.activeDay === currentDay) return;
    this.activeDay = currentDay;
    this.dailyWins.clear();
  }
}

function currentGameDayKey() {
  const date = new Date();
  const shifted = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function currentMonthKey() {
  const date = new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
