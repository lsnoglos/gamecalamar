import { CONFIG } from "./config.js";
import { PlayerManager } from "./PlayerManager.js";
import { DollAI } from "./DollAI.js";
import { RankingSystem } from "./RankingSystem.js";
import { EventBridge } from "./EventBridge.js";
import { SoundManager } from "./SoundManager.js";
import { UIManager } from "./UIManager.js";
import { ChatSystem } from "./ChatSystem.js";

const USER_POOL = ["NinjaFox", "LunaTap", "PixelRosa", "NeoKoi", "MayaRush", "TicoLive", "RexArcade", "YukiStar"];

export class GameController {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;

    this.players = new PlayerManager();
    this.doll = new DollAI();
    this.ranking = new RankingSystem();
    this.sounds = new SoundManager();
    this.uiManager = new UIManager(ui);
    this.chat = new ChatSystem();

    this.level = 1;
    this.roundStartAt = performance.now();
    this.roundDurationMs = CONFIG.game.roundSeconds * 1000;
    this.extraTimeUsed = false;
    this.autoTap = false;
    this.nextAutoTapAt = performance.now();
    this.autoTapInterval = 160;

    this.bridge = new EventBridge({
      onRoseGift: (username) => this.spawnPlayer(username),
      onTap: (username) => this.handleTap(username),
    });
    this.bridge.connectGlobalBridge();

    this.#wireUI();
  }

  start() {
    const now = performance.now();
    this.roundStartAt = now;
    this.doll.start(now, this.level);
    this.sounds.playIdle();
    requestAnimationFrame((t) => this.#loop(t));
  }

  spawnPlayer(username) {
    this.sounds.enable();
    const name = username ?? `${USER_POOL[Math.floor(Math.random() * USER_POOL.length)]}${Math.floor(Math.random() * 90 + 10)}`;
    this.players.addPlayer(name);
    this.uiManager.announce(`${name} entró al juego`, "ok");
    this.chat.sendChatMessage("Nuevo jugador ha entrado al juego");
  }

  handleTap(username) {
    this.sounds.enable();
    const now = performance.now();
    const isDanger = this.doll.isDanger();

    if (username) {
      const candidate = this.players.getAll().find((p) => p.username === username);
      if (candidate && this.players.applyTap(candidate.id, now, isDanger)) {
        this.sounds.playStep();
        this.uiManager.floatingText(`+tap ${candidate.username}`, candidate.x, candidate.y - 30);
      }
      return;
    }

    if (this.players.applyGlobalTap(now, isDanger)) {
      this.sounds.playStep();
      this.uiManager.announce("Dale tap tap para avanzar", "neutral");
    }
  }

  #wireUI() {
    this.ui.spawnBtn.addEventListener("click", () => this.spawnPlayer());
    this.ui.tapBtn.addEventListener("mousedown", () => this.handleTap());
    this.ui.tapBtn.addEventListener("touchstart", () => this.handleTap(), { passive: true });
    this.ui.autoTapBtn.addEventListener("click", () => {
      this.autoTap = !this.autoTap;
      this.ui.autoTapBtn.textContent = `Auto Tap: ${this.autoTap ? "ON" : "OFF"}`;
      this.uiManager.announce(this.autoTap ? "Auto Tap activado" : "Auto Tap desactivado", "neutral");
    });
  }

  #loop(now) {
    const stateEvent = this.doll.update(now);

    if (stateEvent === "turn") {
      this.sounds.playTurn();
      this.uiManager.triggerTurnFX();
      this.uiManager.announce("¡No te muevas!", "danger");
    }

    if (stateEvent === "danger") {
      this.#scanAndEliminate(now);
    }

    if (stateEvent === "safe") {
      this.sounds.playIdle();
      this.uiManager.announce("Luz verde: ¡corre!", "ok");
    }

    if (this.autoTap && now >= this.nextAutoTapAt) {
      this.handleTap();
      this.nextAutoTapAt = now + this.autoTapInterval;
    }

    this.players.update(now);
    this.#checkGoal(now);
    this.#checkRoundTimer(now);

    this.uiManager.rotateBottomMessage(now);
    this.#syncHud(now);
    this.#render(now);

    requestAnimationFrame((t) => this.#loop(t));
  }

  #scanAndEliminate(now) {
    for (const mover of this.players.getMoversInDanger()) {
      if (this.doll.isInsideBeam({ x: mover.x, y: mover.y })) {
        const eliminated = this.players.eliminatePlayer(mover.id, now);
        if (eliminated) {
          this.sounds.playElimination();
          this.uiManager.announce(`${eliminated.username} eliminado`, "danger");
          this.chat.sendChatMessage(`${eliminated.username} salió del juego 💀 envía una rosa para entrar`);
        }
      }
    }
    this.players.clearDangerMovementFlags();
  }

  #checkGoal(now) {
    for (const p of this.players.getAlive()) {
      if (p.y > CONFIG.game.finishLineY) continue;
      const registered = this.ranking.registerWinner(p);
      if (!registered) continue;

      this.players.markWinner(p.id, registered.place, now);
      this.sounds.playVictory();
      this.uiManager.floatingText(`¡${p.username} llegó a la meta!`, p.x, p.y - 24, "victory");
      this.uiManager.announce(`¡${p.username} llegó a la meta!`, "ok");
      this.chat.sendChatMessage(`${p.username} llegó a la meta 🏁 ${registered.place}er lugar`);
    }
  }

  #checkRoundTimer(now) {
    const elapsed = now - this.roundStartAt;
    if (elapsed < this.roundDurationMs) return;

    if (!this.ranking.hasTop3() && !this.extraTimeUsed) {
      this.extraTimeUsed = true;
      this.roundDurationMs += CONFIG.game.extraTimeSeconds * 1000;
      this.uiManager.announce("Tiempo extra activado", "neutral");
      return;
    }

    if (this.ranking.hasTop3()) {
      this.level += 1;
      this.uiManager.announce(`Nivel ${this.level}`, "ok");
      this.players.resetRoundToStart();
    } else {
      this.level = 1;
      this.players.clearAll();
      this.uiManager.announce("Ronda terminada: reinicio", "neutral");
    }

    this.ranking.reset();
    this.roundStartAt = now;
    this.roundDurationMs = CONFIG.game.roundSeconds * 1000;
    this.extraTimeUsed = false;
    this.doll.start(now, this.level);
  }

  #syncHud(now) {
    const remainSec = Math.max(0, (this.roundDurationMs - (now - this.roundStartAt)) / 1000);
    this.uiManager.updateHud({
      timeLeft: remainSec,
      aliveCount: this.players.getAliveCount(),
      gameState: this.doll.state === "safe" ? "safe" : "danger",
      ranking: this.ranking.top3(),
      level: this.level,
    });
  }

  #render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.#drawField(ctx);
    this.#drawGuards(ctx, now);
    this.#drawDoll(ctx, now);
    if (this.doll.state !== "safe") this.#drawBeam(ctx);
    this.#drawPlayers(ctx, now);
  }

  #drawField(ctx) {
    ctx.fillStyle = "#d3b08c";
    ctx.fillRect(0, 0, this.canvas.width, 235);
    ctx.fillStyle = "#2f8f57";
    ctx.fillRect(0, 235, this.canvas.width, this.canvas.height - 235);

    for (let y = 236; y < this.canvas.height; y += 16) {
      for (let x = 0; x < this.canvas.width; x += 16) {
        ctx.fillStyle = (x / 16 + y / 16) % 2 === 0 ? "#2d854f" : "#3b9c60";
        ctx.fillRect(x, y, 16, 16);
      }
    }

    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, CONFIG.game.finishLineY, this.canvas.width, 7);
    ctx.fillStyle = "#f7df8d";
    ctx.fillRect(0, CONFIG.game.startLineY, this.canvas.width, 5);
  }

  #drawGuards(ctx, now) {
    const guards = [
      { x: 125, y: 182, mask: "○" },
      { x: 182, y: 196, mask: "△" },
      { x: 357, y: 196, mask: "□" },
      { x: 415, y: 182, mask: "○" },
    ];
    for (const g of guards) {
      const breath = Math.sin(now * 0.005 + g.x) * 2;
      ctx.save();
      ctx.translate(g.x, g.y + breath);
      ctx.fillStyle = "#bd1f29";
      ctx.fillRect(-13, -26, 26, 46);
      ctx.fillStyle = "#111";
      ctx.fillRect(-11, -40, 22, 18);
      ctx.fillStyle = "#f3f3f3";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(g.mask, 0, -27);
      ctx.restore();
    }
  }

  #drawDoll(ctx, now) {
    const x = this.canvas.width / 2;
    const y = 164;
    const bob = Math.sin(now * 0.007) * 2;
    const turning = this.doll.state === "turn";

    ctx.save();
    ctx.translate(x, y + bob);

    if (this.doll.state === "safe") {
      ctx.fillStyle = "#432311";
      ctx.beginPath();
      ctx.arc(0, -12, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f2d1b1";
      ctx.fillRect(-10, -19, 20, 24);
    } else {
      ctx.fillStyle = "#f2d1b1";
      ctx.fillRect(-10, -19, 20, 24);
      ctx.fillStyle = "#3f2412";
      ctx.fillRect(-11, -25, 22, 8);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(-4, -8, 2.2, 0, Math.PI * 2);
      ctx.arc(4, -8, 2.2, 0, Math.PI * 2);
      ctx.fill();

      if (this.doll.state === "danger") {
        ctx.strokeStyle = "rgba(255,80,80,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(0, 700);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#f18a2a";
    ctx.fillRect(-18, 8, 36, 58);
    ctx.fillStyle = "#f2d1b1";
    ctx.fillRect(-28, 14, 10, 34);
    ctx.fillRect(18, 14, 10, 34);

    if (turning) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3;
      ctx.strokeRect(-28, -40, 56, 112);
    }

    ctx.restore();
  }

  #drawBeam(ctx) {
    const beam = this.doll.getBeamRect();
    const grad = ctx.createLinearGradient(0, beam.y, 0, beam.y + beam.height);
    grad.addColorStop(0, "rgba(255,95,95,0.30)");
    grad.addColorStop(1, "rgba(255,95,95,0.03)");
    ctx.fillStyle = grad;
    ctx.fillRect(beam.x, beam.y, beam.width, beam.height);
  }

  #drawPlayers(ctx, now) {
    for (const p of this.players.getAll()) {
      const walkBounce = p.bounce > 0 ? Math.sin(now * 0.03) * 4 * p.bounce : 0;

      ctx.save();
      ctx.translate(p.x, p.y + walkBounce);

      if (p.state === "eliminated") {
        const t = Math.min(1, (now - p.eliminatedAt) / CONFIG.player.eliminationFadeMs);
        const alpha = 1 - t;
        const clipHeight = (1 - t) * 40;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.rect(-15, 20 - clipHeight, 30, clipHeight + 18);
        ctx.clip();
      }

      const bodyColor = p.state === "eliminated" ? "#ff3b3b" : p.color;
      ctx.strokeStyle = bodyColor;
      ctx.fillStyle = bodyColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -14, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 14);
      ctx.moveTo(0, 0);
      ctx.lineTo(-9, 9);
      ctx.moveTo(0, 0);
      ctx.lineTo(9, 9);
      ctx.moveTo(0, 14);
      ctx.lineTo(-7, 26);
      ctx.moveTo(0, 14);
      ctx.lineTo(7, 26);
      ctx.stroke();

      ctx.restore();

      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000";
      ctx.strokeText(p.username, p.x, p.y - 28);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.username, p.x, p.y - 28);
    }
  }
}
