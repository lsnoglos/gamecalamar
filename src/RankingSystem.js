import { CONFIG } from "./config.js";

const STORAGE_KEY = "gamecalamar_ranking_v1";

export class RankingSystem {
  constructor() {
    this.winners = [];
    this.activeDay = currentGameDayKey();
    this.activeMonth = currentMonthKey();
    this.dailyWins = new Map();
    this.monthlyWins = new Map();

    this.#loadFromStorage();
    this.#ensureDayBoundary();
    this.#ensureMonthBoundary();
  }

  registerWinner(player) {
    this.#ensureDayBoundary();
    this.#ensureMonthBoundary();

    const now = Date.now();
    const currentDaily = this.dailyWins.get(player.username);
    const updatedDaily = {
      username: player.username,
      wins: (currentDaily?.wins ?? 0) + 1,
      firstWinAt: currentDaily?.firstWinAt ?? now,
      lastWinAt: now,
    };

    this.dailyWins.set(player.username, updatedDaily);

    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    monthMap.set(player.username, (monthMap.get(player.username) ?? 0) + 1);
    this.monthlyWins.set(this.activeMonth, monthMap);

    const result = {
      id: player.id,
      username: player.username,
      timestamp: now,
      place: this.winners.length + 1,
      wins: updatedDaily.wins,
    };

    this.winners.push(result);
    this.#persist();
    return result;
  }

  topWinners(limit = CONFIG.game.maxWinners) {
    this.#ensureDayBoundary();
    return [...this.dailyWins.values()]
      .sort((a, b) => b.wins - a.wins || a.lastWinAt - b.lastWinAt || a.firstWinAt - b.firstWinAt)
      .slice(0, limit)
      .map(({ username, wins }) => ({ username, wins }));
  }

  monthlyTop(limit = 3) {
    this.#ensureMonthBoundary();
    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    return [...monthMap.entries()]
      .map(([username, wins]) => ({ username, wins }))
      .sort((a, b) => b.wins - a.wins || a.username.localeCompare(b.username))
      .slice(0, limit);
  }

  hasDailyPlacementsToday() {
    this.#ensureDayBoundary();
    return this.dailyWins.size > 0;
  }

  reset() {
    this.winners = [];
  }

  #ensureMonthBoundary() {
    const currentMonth = currentMonthKey();
    if (this.activeMonth === currentMonth) return;
    this.activeMonth = currentMonth;
    this.#persist();
  }

  #ensureDayBoundary() {
    const currentDay = currentGameDayKey();
    if (this.activeDay === currentDay) return;
    this.activeDay = currentDay;
    this.dailyWins.clear();
    this.winners = [];
    this.#persist();
  }

  #loadFromStorage() {
    const storage = safeLocalStorage();
    if (!storage) return;

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (typeof parsed?.activeDay === "string") {
        this.activeDay = parsed.activeDay;
      }

      if (typeof parsed?.activeMonth === "string") {
        this.activeMonth = parsed.activeMonth;
      }

      if (Array.isArray(parsed?.dailyBoard)) {
        this.dailyWins = new Map(
          parsed.dailyBoard
            .filter((row) => typeof row?.username === "string" && Number.isFinite(row?.wins))
            .map((row) => [
              row.username,
              {
                username: row.username,
                wins: Number(row.wins),
                firstWinAt: Number(row.firstWinAt) || Date.now(),
                lastWinAt: Number(row.lastWinAt) || Date.now(),
              },
            ]),
        );
      }

      if (parsed?.monthlyBoard && typeof parsed.monthlyBoard === "object") {
        this.monthlyWins = new Map(
          Object.entries(parsed.monthlyBoard).map(([monthKey, entries]) => [
            monthKey,
            new Map(
              Array.isArray(entries)
                ? entries
                    .filter((entry) => typeof entry?.username === "string" && Number.isFinite(entry?.wins))
                    .map((entry) => [entry.username, Number(entry.wins)])
                : [],
            ),
          ]),
        );
      }
    } catch {
      // Ignora datos corruptos del almacenamiento.
    }
  }

  #persist() {
    const storage = safeLocalStorage();
    if (!storage) return;

    const monthlyBoard = {};
    for (const [monthKey, monthMap] of this.monthlyWins.entries()) {
      monthlyBoard[monthKey] = [...monthMap.entries()].map(([username, wins]) => ({ username, wins }));
    }

    const payload = {
      activeDay: this.activeDay,
      activeMonth: this.activeMonth,
      dailyBoard: [...this.dailyWins.values()],
      monthlyBoard,
    };

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Sin espacio o bloqueo de almacenamiento.
    }
  }
}

function safeLocalStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
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
