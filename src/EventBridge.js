export class EventBridge {
  constructor({ onJoinCommand, onGift, onTap, onChatCommand }) {
    this.onJoinCommand = onJoinCommand;
    this.onGift = onGift;
    this.onTap = onTap;
    this.onChatCommand = onChatCommand;
  }

  connectGlobalBridge() {
    window.LiveGameBridge = {
      receiveGift: (payload) => {
        const username = payload?.username ?? `user_${Math.floor(Math.random() * 9999)}`;
        const gift = payload?.gift ?? "rose";
        this.onGift(username, gift.toLowerCase());
      },
      receiveChat: (payload) => {
        const username = payload?.username ?? `user_${Math.floor(Math.random() * 9999)}`;
        const message = (payload?.message ?? "").trim().toLowerCase();
        if (message === "jugar") {
          this.onJoinCommand(username);
          return;
        }
        this.onChatCommand?.(username, message);
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
