import { CONFIG } from "./config.js";

export class UIManager {
  constructor(ui) {
    this.ui = ui;
    this.lastBottomMessage = "";
  }

  updateHud({ timeLeft, aliveCount, gameState, ranking, monthlyWinners, level }) {
    this.ui.timeLeft.textContent = formatTimeDisplay(timeLeft);
    this.ui.aliveCount.textContent = aliveCount.toString();

    this.ui.gameState.textContent = gameState === "safe" ? "LUZ VERDE" : "LUZ ROJA";
    this.ui.gameState.dataset.state = gameState === "safe" ? "safe" : "danger";
    this.ui.levelLabel.textContent = `Nivel ${level}`;

    this.ui.rankingList.innerHTML = "";
    for (let i = 0; i < 10; i += 1) {
      const li = document.createElement("li");
      li.className = "ranking-row";
      const row = ranking[i];
      const level = row?.level ?? i + 1;
      li.innerHTML = `
        <span class="col-level">${level}</span>
        <span class="col-player">${row?.username ? truncateName(row.username) : "—"}</span>
        <span class="col-wins">${row?.wins ? row.wins : "—"}</span>
      `;
      this.ui.rankingList.appendChild(li);
    }

    this.ui.monthlyList.innerHTML = "";
    for (let i = 0; i < 3; i += 1) {
      const li = document.createElement("li");
      const row = monthlyWinners[i];
      li.textContent = row ? `Lvl ${row.level} ${truncateName(row.username)} ${row.wins}` : "—";
      this.ui.monthlyList.appendChild(li);
    }
  }

  rotateBottomMessage() {
    // Se conserva por compatibilidad. Ahora los mensajes se sincronizan por estado real.
  }

  setContextMessage(message) {
    if (!message || message === this.lastBottomMessage) return;
    this.lastBottomMessage = message;
    this.ui.rankingMessage.textContent = message;
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

function truncateName(name, max = 10) {
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(3, max - 3))}...`;
}

function formatTimeDisplay(timeLeft) {
  const totalSeconds = Math.max(0, Math.ceil(timeLeft));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0 && totalSeconds > 0) {
    return `${Math.max(0, minutes - 1)}:60`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
