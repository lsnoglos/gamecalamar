export const CONFIG = {
  canvas: {
    width: 540,
    height: 960,
  },
  game: {
    roundSeconds: 90,
    safeMinMs: 2400,
    safeMaxMs: 4200,
    transitionMs: 460,
    dangerMinMs: 1300,
    dangerMaxMs: 2600,
    beamAngle: Math.PI / 2.2,
    beamLength: 650,
  },
  player: {
    radius: 11,
    spawnMinY: 855,
    spawnMaxY: 920,
    speedPerTap: 5,
    lanePadding: 35,
    eliminationFadeMs: 540,
  },
};
