import { CONFIG } from "./config.js";

const STORAGE_KEY = "gamecalamar_ranking_v2";

export class RankingSystem {
  constructor() {
    this.winners = [];
    this.activeDay = currentGameDayKey();
    this.activeMonth = currentMonthKey();
    this.dailyWinsByLevel = new Map();
    this.monthlyWins = new Map();

    this.#loadFromStorage();
    this.#ensureDayBoundary();
    this.#ensureMonthBoundary();
  }

  registerWinner(player, level) {
    this.#ensureDayBoundary();
    this.#ensureMonthBoundary();
    const safeLevel = normalizeLevel(level);

    const now = Date.now();
    const levelMap = this.dailyWinsByLevel.get(safeLevel) ?? new Map();
    const currentDaily = levelMap.get(player.username);
    const updatedDaily = {
      username: player.username,
      level: safeLevel,
      wins: (currentDaily?.wins ?? 0) + 1,
      firstWinAt: currentDaily?.firstWinAt ?? now,
      lastWinAt: now,
      reachedWinsAt: now,
    };
    levelMap.set(player.username, updatedDaily);
    this.dailyWinsByLevel.set(safeLevel, levelMap);

    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    const monthlyRecord = monthMap.get(player.username) ?? {
      username: player.username,
      wins: 0,
      levelWins: {},
    };
    monthlyRecord.wins += 1;
    monthlyRecord.levelWins[safeLevel] = (monthlyRecord.levelWins[safeLevel] ?? 0) + 1;
    monthMap.set(player.username, monthlyRecord);
    this.monthlyWins.set(this.activeMonth, monthMap);

    const levelStanding = this.topWinners().find((row) => row.level === safeLevel);
    const result = {
      id: player.id,
      username: player.username,
      level: safeLevel,
      timestamp: now,
      place: levelStanding ? levelStanding.position : 1,
      wins: updatedDaily.wins,
    };

    this.winners.push(result);
    this.#persist();
    return result;
  }

  topWinners(limit = CONFIG.game.maxWinners) {
    this.#ensureDayBoundary();
    const board = [];
    for (let level = 1; level <= limit; level += 1) {
      const levelMap = this.dailyWinsByLevel.get(level);
      const ranked = levelMap
        ? [...levelMap.values()].sort(
            (a, b) =>
              b.wins - a.wins ||
              a.reachedWinsAt - b.reachedWinsAt ||
              a.firstWinAt - b.firstWinAt ||
              a.username.localeCompare(b.username),
          )
        : [];
      const leader = ranked[0];
      board.push({
        level,
        username: leader?.username ?? "",
        wins: leader?.wins ?? 0,
        position: leader ? 1 : 0,
      });
    }
    return board;
  }

  monthlyTop(limit = 3) {
    this.#ensureMonthBoundary();
    const monthMap = this.monthlyWins.get(this.activeMonth) ?? new Map();
    return [...monthMap.entries()]
      .map(([, data]) => ({
        username: data.username,
        wins: data.wins,
        level: preferredLevel(data.levelWins),
      }))
      .sort((a, b) => b.wins - a.wins || a.level - b.level || a.username.localeCompare(b.username))
      .slice(0, limit);
  }

  hasDailyPlacementsToday() {
    this.#ensureDayBoundary();
    return [...this.dailyWinsByLevel.values()].some((levelMap) => levelMap.size > 0);
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
    this.dailyWinsByLevel.clear();
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
        this.dailyWinsByLevel = new Map();
        for (const row of parsed.dailyBoard) {
          if (typeof row?.username !== "string" || !Number.isFinite(row?.wins) || !Number.isFinite(row?.level)) continue;
          const level = normalizeLevel(row.level);
          const levelMap = this.dailyWinsByLevel.get(level) ?? new Map();
          levelMap.set(row.username, {
            username: row.username,
            level,
            wins: Number(row.wins),
            firstWinAt: Number(row.firstWinAt) || Date.now(),
            lastWinAt: Number(row.lastWinAt) || Date.now(),
            reachedWinsAt: Number(row.reachedWinsAt) || Number(row.lastWinAt) || Date.now(),
          });
          this.dailyWinsByLevel.set(level, levelMap);
        }
      }

      if (parsed?.monthlyBoard && typeof parsed.monthlyBoard === "object") {
        this.monthlyWins = new Map(
          Object.entries(parsed.monthlyBoard).map(([monthKey, entries]) => [
            monthKey,
            new Map(
              Array.isArray(entries)
                ? entries
                    .filter((entry) => typeof entry?.username === "string" && Number.isFinite(entry?.wins))
                    .map((entry) => [
                      entry.username,
                      {
                        username: entry.username,
                        wins: Number(entry.wins),
                        levelWins: entry?.levelWins && typeof entry.levelWins === "object" ? entry.levelWins : {},
                      },
                    ])
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
      monthlyBoard[monthKey] = [...monthMap.values()].map((entry) => ({
        username: entry.username,
        wins: entry.wins,
        levelWins: entry.levelWins,
      }));
    }

    const dailyBoard = [];
    for (const levelMap of this.dailyWinsByLevel.values()) {
      dailyBoard.push(...levelMap.values());
    }

    const payload = {
      activeDay: this.activeDay,
      activeMonth: this.activeMonth,
      dailyBoard,
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

function normalizeLevel(level) {
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(10, Math.max(1, Math.floor(parsed)));
}

function preferredLevel(levelWins) {
  const entries = Object.entries(levelWins ?? {}).map(([level, wins]) => ({ level: Number(level), wins: Number(wins) }));
  if (!entries.length) return 1;
  entries.sort((a, b) => b.wins - a.wins || a.level - b.level);
  return entries[0].level;
}
