import { LEVEL_CONFIG } from "./levelConfig.js";

export const CONFIG = {
  canvas: {
    width: 540,
    height: 960,
  },
  game: {
    roundSeconds: 120,
    maxWinners: 10,
    startLineY: 914,
    finishLineY: 332,
    finishWindow: 3,
    levelConfig: LEVEL_CONFIG,
    preScanDelayMs: 1000,
    iceBreath: {
      durationMs: 3600,
      pushBackPercent: 0.05,
      tickMs: 900,
    },
    cone: {
      originY: 132,
      radius: 980,
      halfAngle: Math.PI / 6,
      baseDirection: Math.PI / 2,
      sweepArc: Math.PI * 0.94,
      aggressiveAfterMs: 350,
      aggressiveHalfAngleScale: 0.95,
      speedMultiplier: 3.2,
      jumpChance: 0.35,
      pauseChance: 0.13,
      minAngularSpeed: 0.008,
      maxAngularSpeed: 0.03,
      criticalZonePercent: 0.8,
    },
  },
  player: {
    radius: 12,
    spawnMinY: 920,
    spawnMaxY: 948,
    speedPerTap: 0.32,
    tapDelayMs: 120,
    speedDamping: 0.84,
    lanePadding: 34,
    eliminationFadeMs: 400,
    rankTravelMs: 550,
    iceTint: "#8ddfff",
  },
  ui: {
    messageRotateMs: 2500,
  },
  debug: {
    testDriverUsername: "lsnoglos",
  },
  admin: {
    usernames: ["lsnoglos"],
  },
};
