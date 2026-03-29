import { CONFIG } from "./config.js";

const ROTATING_MESSAGES = [
  "Envía una rosa para entrar 🌹",
  "Dale tap tap para avanzar",
  "¿Podrás quedar en 1er lugar?",
  "La muñeca está molesta…",
  "¡No te muevas!",
];

export class UIManager {
  constructor(ui) {
    this.ui = ui;
    this.currentMessageIdx = 0;
    this.lastRotateAt = 0;
  }

  updateHud({ timeLeft, aliveCount, gameState, ranking, level }) {
    this.ui.timeLeft.textContent = Math.ceil(timeLeft).toString();
    this.ui.aliveCount.textContent = aliveCount.toString();
    this.ui.levelTag.textContent = `Nivel ${level}`;

    this.ui.gameState.textContent = gameState === "safe" ? "LUZ VERDE" : "LUZ ROJA";
    this.ui.gameState.dataset.state = gameState === "safe" ? "safe" : "danger";

    for (let i = 0; i < 3; i += 1) {
      this.ui.rankingItems[i].textContent = ranking[i] ? `${medal(i)} ${ranking[i].username}` : `${medal(i)} —`;
    }
  }

  rotateBottomMessage(now) {
    if (now - this.lastRotateAt < CONFIG.ui.messageRotateMs) return;
    this.lastRotateAt = now;
    this.currentMessageIdx = (this.currentMessageIdx + 1) % ROTATING_MESSAGES.length;
    this.ui.gameMessage.textContent = ROTATING_MESSAGES[this.currentMessageIdx];
  }

  announce(message, tone = "neutral") {
    this.ui.alertText.textContent = message;
    this.ui.alertText.dataset.tone = tone;
    this.ui.alertText.classList.remove("show");
    void this.ui.alertText.offsetWidth;
    this.ui.alertText.classList.add("show");
  }

  floatingText(text, x, y, tone = "ok") {
    const el = document.createElement("span");
    el.className = `floating-text ${tone}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.ui.floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  triggerTurnFX() {
    this.ui.flash.classList.remove("active");
    void this.ui.flash.offsetWidth;
    this.ui.flash.classList.add("active");

    this.ui.shell.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 180, iterations: 2 },
    );
  }
}

function medal(i) {
  return ["🥇", "🥈", "🥉"][i];
}
