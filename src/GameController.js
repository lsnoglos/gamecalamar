import { CONFIG } from "./config.js";
import { PlayerManager } from "./PlayerManager.js";
import { DollAI } from "./DollAI.js";
import { VisionSystem } from "./VisionSystem.js";
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
    this.vision = new VisionSystem();
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
    this.vision.setLevel(this.level);
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
      this.uiManager.announce("Corre… ahora…", "neutral");
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
      this.uiManager.announce("La muñeca te está mirando 👁️", "danger");
    }

    if (stateEvent === "danger") {
      this.sounds.playScan();
    }

    if (stateEvent === "safe") {
      this.sounds.playIdle();
      this.uiManager.announce("No te muevas…", "ok");
    }

    this.vision.update(now);

    if (this.doll.isScanning()) {
      this.#scanAndEliminate(now);
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
      if (mover.y <= CONFIG.game.finishLineY) continue;
      if (this.vision.isPointInside({ x: mover.x, y: mover.y })) {
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
    this.vision.setLevel(this.level);
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
    if (this.doll.isScanning()) this.#drawVisionCone(ctx);
    this.#drawGuards(ctx, now);
    this.#drawDoll(ctx, now);
    this.#drawPlayers(ctx, now);
  }

  #drawField(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, 310);
    sky.addColorStop(0, "#95d7ff");
    sky.addColorStop(1, "#c6e7fb");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.canvas.width, 320);

    ctx.fillStyle = "#3d2f29";
    ctx.beginPath();
    ctx.ellipse(270, 212, 34, 172, -0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2b201d";
    ctx.lineWidth = 6;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(262 + i * 3, 102 + i * 3);
      ctx.lineTo(162 + i * 24, 26 + i * 4);
      ctx.stroke();
    }

    ctx.fillStyle = "#f9f9f2";
    ctx.fillRect(420, 176, 92, 72);
    ctx.fillStyle = "#b84a37";
    ctx.beginPath();
    ctx.moveTo(410, 176);
    ctx.lineTo(466, 146);
    ctx.lineTo(522, 176);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#d7bf7a";
    ctx.fillRect(0, 250, this.canvas.width, this.canvas.height - 250);
    for (let y = 252; y < this.canvas.height; y += 14) {
      for (let x = 0; x < this.canvas.width; x += 12) {
        const n = Math.sin(x * 0.03 + y * 0.018);
        ctx.fillStyle = n > 0 ? "#af9d58" : "#8da063";
        ctx.fillRect(x, y, 11, 12);
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillRect(0, CONFIG.game.finishLineY, this.canvas.width, 7);
    ctx.strokeStyle = "rgba(20,20,20,0.55)";
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(0, CONFIG.game.finishLineY + 7);
    ctx.lineTo(this.canvas.width, CONFIG.game.finishLineY + 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  #drawGuards(ctx, now) {
    const guards = [
      { x: 136, y: 278, mask: "○" },
      { x: 205, y: 294, mask: "△" },
      { x: 336, y: 294, mask: "□" },
      { x: 404, y: 278, mask: "○" },
    ];
    for (const g of guards) {
      const breath = Math.sin(now * 0.004 + g.x) * 1.7;
      ctx.save();
      ctx.translate(g.x, g.y + breath);
      ctx.fillStyle = "#cc2d44";
      ctx.fillRect(-11, -33, 22, 45);
      ctx.fillStyle = "#1a1518";
      ctx.fillRect(-10, -48, 20, 17);
      ctx.fillStyle = "#f3f3f3";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(g.mask, 0, -35);
      ctx.restore();
    }
  }

  #drawDoll(ctx, now) {
    const x = this.canvas.width / 2;
    const y = 286;
    const bob = this.doll.state === "safe" ? Math.sin(now * 0.006) * 1.4 : 0;
    const turnP = this.doll.turnProgress(now);
    const headRotation = this.doll.state === "turn" ? Math.PI - turnP * Math.PI : this.doll.state === "safe" ? Math.PI : 0;

    ctx.save();
    ctx.translate(x, y + bob);

    ctx.fillStyle = "#f6d9ba";
    ctx.fillRect(-20, -46, 40, 20);

    ctx.fillStyle = "#f29339";
    ctx.beginPath();
    ctx.moveTo(-44, -26);
    ctx.lineTo(44, -26);
    ctx.lineTo(62, 84);
    ctx.lineTo(-62, 84);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#f2cc41";
    ctx.fillRect(-35, -27, 70, 18);

    ctx.fillStyle = "#f6d9ba";
    ctx.fillRect(-58, -12, 13, 54);
    ctx.fillRect(45, -12, 13, 54);
    ctx.fillRect(-33, 84, 18, 70);
    ctx.fillRect(15, 84, 18, 70);

    ctx.save();
    ctx.translate(0, -62);
    ctx.rotate(headRotation);

    ctx.fillStyle = "#2d1f1a";
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f6d9ba";
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2f231d";
    ctx.beginPath();
    ctx.arc(-24, -4, 9, 0, Math.PI * 2);
    ctx.arc(24, -4, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f6d9ba";
    ctx.beginPath();
    ctx.arc(-24, -4, 5, 0, Math.PI * 2);
    ctx.arc(24, -4, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-8, -2, 5.3, 0, Math.PI * 2);
    ctx.arc(8, -2, 5.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(-8, -2, 2.7, 0, Math.PI * 2);
    ctx.arc(8, -2, 2.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#8f5a4b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 10);
    ctx.quadraticCurveTo(0, 13, 6, 10);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  #drawVisionCone(ctx) {
    const cone = this.vision.getCone();

    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const glow = ctx.createRadialGradient(cone.origin.x, cone.origin.y, 40, cone.origin.x, cone.origin.y, cone.radius);
    glow.addColorStop(0, "rgba(255,60,60,0.34)");
    glow.addColorStop(1, "rgba(255,60,60,0.02)");

    ctx.beginPath();
    ctx.moveTo(cone.origin.x, cone.origin.y);
    ctx.lineTo(cone.p1.x, cone.p1.y);
    ctx.lineTo(cone.p2.x, cone.p2.y);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.strokeStyle = "rgba(255,128,128,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  #drawPlayers(ctx, now) {
    for (const p of this.players.getAll()) {
      const walkBounce = p.bounce > 0 ? Math.sin(now * 0.03) * 4 * p.bounce : 0;
      const highlighted = this.doll.isScanning() && this.vision.isPointInside({ x: p.x, y: p.y }) && p.state === "alive";

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

      if (highlighted) {
        ctx.shadowColor = "rgba(255,120,120,0.95)";
        ctx.shadowBlur = 16;
        ctx.strokeStyle = "#ffd1d1";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 2, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000";
      ctx.strokeText(p.username, p.x, p.y - 28);
      ctx.fillStyle = highlighted ? "#ffd7d7" : "#fff";
      ctx.fillText(p.username, p.x, p.y - 28);
    }
  }
}
