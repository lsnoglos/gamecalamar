export class RankingSystem {
  constructor() {
    this.winners = [];
  }

  registerWinner(player) {
    if (this.winners.some((w) => w.id === player.id)) return null;
    const result = {
      id: player.id,
      username: player.username,
      timestamp: performance.now(),
      place: this.winners.length + 1,
    };
    this.winners.push(result);
    return result;
  }

  top3() {
    return this.winners.slice(0, 3);
  }

  hasTop3() {
    return this.winners.length >= 3;
  }

  reset() {
    this.winners = [];
  }
}
