export const CONFIG = {
  canvas: {
    width: 540,
    height: 960,
  },
  game: {
    roundSeconds: 70,
    extraTimeSeconds: 18,
    maxWinners: 3,
    startLineY: 884,
    finishLineY: 204,
    levelProfiles: [
      {
        turnMs: 200,
        coneSweepSpeed: 0.00065,
        safeMinMs: 3200,
        safeMaxMs: 5200,
        dangerMinMs: 1500,
        dangerMaxMs: 2450,
      },
      {
        turnMs: 175,
        coneSweepSpeed: 0.00105,
        safeMinMs: 2200,
        safeMaxMs: 3600,
        dangerMinMs: 1300,
        dangerMaxMs: 2100,
      },
      {
        turnMs: 155,
        coneSweepSpeed: 0.00145,
        safeMinMs: 1250,
        safeMaxMs: 2200,
        dangerMinMs: 1100,
        dangerMaxMs: 1800,
      },
    ],
    cone: {
      originY: 132,
      radius: 760,
      halfAngle: Math.PI / 10,
      baseDirection: Math.PI / 2,
      sweepArc: Math.PI / 2.8,
    },
  },
  player: {
    radius: 12,
    spawnMinY: 890,
    spawnMaxY: 932,
    speedPerTap: 5.4,
    lanePadding: 34,
    eliminationFadeMs: 400,
    rankTravelMs: 550,
  },
  ui: {
    messageRotateMs: 2500,
  },
};
