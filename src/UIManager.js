import { CONFIG } from "./config.js";

export class UIManager {
  constructor(ui) {
    this.ui = ui;
    this.lastBottomMessage = "";
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

  rotateBottomMessage() {
    // Se conserva por compatibilidad. Ahora los mensajes se sincronizan por estado real.
  }

  setContextMessage(message) {
    if (!message || message === this.lastBottomMessage) return;
    this.lastBottomMessage = message;
    this.ui.gameMessage.textContent = message;
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
        { transform: "translateX(-3px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 170, iterations: 2 },
    );

    this.ui.shell.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "ease-out" },
    );
  }

  setDangerMode(enabled) {
    this.ui.shell.classList.toggle("danger-mode", enabled);
  }
}

function medal(i) {
  return ["🥇", "🥈", "🥉"][i];
}
