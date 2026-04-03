export const REQUEST_TYPE = Object.freeze({
  JOIN: "join",
  CHAT: "chat",
  GIFT: "gift",
  TAP: "tap",
});

export const COMMAND_KEY = Object.freeze({
  DANCE: "dance",
  MISSILE: "missile",
});

export const NON_ADMIN_ACTION_COOLDOWN_MS = 60 * 60 * 1000;

const MISSILE_ALIASES = new Set(["misil a muneca", "lanza misil a la muneca"]);
const DANCE_ALIASES = new Set(["pon a bailar a la muneca", "muneca baila"]);
const JOIN_ALIASES = new Set(["jugar"]);

export function normalizeUserText(value) {
  return (value ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function getCommandKeyFromMessage(message) {
  const normalized = normalizeUserText(message);
  if (MISSILE_ALIASES.has(normalized)) return COMMAND_KEY.MISSILE;
  if (DANCE_ALIASES.has(normalized)) return COMMAND_KEY.DANCE;
  return null;
}

export function isJoinMessage(message) {
  return JOIN_ALIASES.has(normalizeUserText(message));
}

export function createChatRequest(payload) {
  const username = payload?.username ?? `user_${Math.floor(Math.random() * 9999)}`;
  const message = normalizeUserText(payload?.message);
  return {
    type: REQUEST_TYPE.CHAT,
    username,
    message,
    commandKey: getCommandKeyFromMessage(message),
    createdAt: Date.now(),
  };
}

export function createGiftRequest(payload) {
  const username = payload?.username ?? `user_${Math.floor(Math.random() * 9999)}`;
  const gift = normalizeUserText(payload?.gift ?? "rose");
  return {
    type: REQUEST_TYPE.GIFT,
    username,
    gift,
    createdAt: Date.now(),
  };
}

export function createTapRequest(payload) {
  return {
    type: REQUEST_TYPE.TAP,
    username: payload?.username ?? null,
    createdAt: Date.now(),
  };
}
