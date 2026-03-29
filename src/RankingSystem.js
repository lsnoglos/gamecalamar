export class RankingSystem {
  constructor() {
    this.winners = [];
  }

  registerWinner(player) {
    if (this.winners.some((winner) => winner.id === player.id)) return;
    this.winners.push({
      id: player.id,
      username: player.username,
      timestamp: performance.now(),
    });
  }

  top3() {
    return this.winners.slice(0, 3);
  }

  reset() {
    this.winners = [];
  }
}
