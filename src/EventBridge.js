import { createChatRequest, createGiftRequest, createTapRequest, isJoinMessage } from "./GameRequests.js";

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
        const request = createGiftRequest(payload);
        this.onGift(request);
      },
      receiveChat: (payload) => {
        const request = createChatRequest(payload);
        if (isJoinMessage(request.message)) {
          this.onJoinCommand(request);
          return;
        }
        this.onChatCommand?.(request);
      },
      receiveTap: (payload) => {
        const request = createTapRequest(payload);
        this.onTap(request);
      },
    };
  }
}
