export class EventBridge {
  constructor({ onRoseGift, onTap }) {
    this.onRoseGift = onRoseGift;
    this.onTap = onTap;
  }

  connectGlobalBridge() {
    window.LiveGameBridge = {
      receiveGift: (payload) => {
        const username = payload?.username ?? `user_${Math.floor(Math.random() * 9999)}`;
        const gift = payload?.gift ?? "rose";
        if (gift.toLowerCase() === "rose") {
          this.onRoseGift(username);
        }
      },
      receiveTap: (payload) => {
        if (payload?.username) {
          this.onTap(payload.username);
          return;
        }
        this.onTap();
      },
    };
  }
}
