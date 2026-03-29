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
    this.autoTapInterval = 320;
    this.dangerSinceAt = 0;
    this.aggressiveScan = false;
    this.aggressiveProgress = 0;
    this.dollPose = this.#computeDollPose(performance.now());

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
      if (isDanger) {
        this.uiManager.setContextMessage("¡No te muevas!");
      } else {
        this.uiManager.setContextMessage(Math.random() > 0.5 ? "Corre… ahora…" : "Avanza rápido");
      }
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
      this.uiManager.announce("¡Se está volteando!", "danger");
      this.uiManager.setContextMessage("¡Se está volteando!");
    }

    if (stateEvent === "danger") {
      this.sounds.playScan();
      this.dangerSinceAt = now;
      this.aggressiveScan = false;
      this.aggressiveProgress = 0;
      this.uiManager.setContextMessage("¡No te muevas!");
      this.uiManager.announce("La muñeca te está viendo 👁️", "danger");
    }

    if (stateEvent === "safe") {
      this.sounds.playIdle();
      this.uiManager.announce("Corre… ahora…", "ok");
      this.uiManager.setContextMessage(Math.random() > 0.5 ? "Corre… ahora…" : "Avanza rápido");
      this.aggressiveScan = false;
      this.aggressiveProgress = 0;
      this.uiManager.setDangerMode(false);
    }

    if (this.doll.isScanning()) {
      const scanningFor = now - this.dangerSinceAt;
      this.aggressiveScan = scanningFor >= CONFIG.game.cone.aggressiveAfterMs;
      this.aggressiveProgress = Math.min(1, scanningFor / 1600);
      if (this.aggressiveScan) {
        this.uiManager.setContextMessage("¡Te está buscando!");
      }
      this.uiManager.setDangerMode(true);
    }

    this.vision.update(now, {
      scanning: this.doll.isScanning(),
      aggressive: this.aggressiveScan,
      aggressiveProgress: this.aggressiveProgress,
    });
    this.dollPose = this.#computeDollPose(now);
    this.vision.setOrigin(this.dollPose.eyeCenter);

    if (this.doll.isScanning()) {
      this.#scanAndEliminate(now);
    }

    if (this.autoTap && now >= this.nextAutoTapAt) {
      this.handleTap();
      this.nextAutoTapAt = now + this.autoTapInterval;
    }

    this.players.update(now, { isDanger: this.doll.isDanger() });
    this.#checkGoal(now);
    this.#checkRoundTimer(now);

    this.uiManager.rotateBottomMessage(now);
    this.#syncHud(now);
    this.#render(now);

    requestAnimationFrame((t) => this.#loop(t));
  }

  #scanAndEliminate(now) {
    const criticalY =
      CONFIG.game.finishLineY +
      (CONFIG.game.startLineY - CONFIG.game.finishLineY) * (1 - CONFIG.game.cone.criticalZonePercent);

    for (const mover of this.players.getMoversInDanger()) {
      if (mover.y <= CONFIG.game.finishLineY) continue;
      const inCriticalZone = mover.y <= criticalY;
      if (inCriticalZone || this.vision.isPointInside({ x: mover.x, y: mover.y })) {
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
      if (p.y > CONFIG.game.finishLineY - CONFIG.game.finishWindow) continue;
      const registered = this.ranking.registerWinner(p);
      if (!registered) continue;

      this.players.markWinner(p.id, registered.place, now);
      this.sounds.playVictory();
      this.uiManager.floatingText(`¡${p.username} llegó a la meta!`, p.x, p.y - 24, "victory");
      this.uiManager.announce(`¡${p.username} llegó a la meta!`, "ok");
      this.uiManager.triggerTurnFX();
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
    if (this.doll.isScanning()) this.#drawVisionCone(ctx, now);
    this.#drawGuards(ctx, now);
    this.#drawDoll(ctx, now);
    this.#drawPlayers(ctx, now);
  }

  #drawField(ctx) {
    const sceneOffsetY = -22;
    const sky = ctx.createLinearGradient(0, 0, 0, 310);
    sky.addColorStop(0, "#95d7ff");
    sky.addColorStop(1, "#c6e7fb");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.canvas.width, 320);

    ctx.save();
    ctx.globalAlpha = 0.5;

    ctx.fillStyle = "rgba(63, 48, 36, 0.32)";
    ctx.beginPath();
    ctx.ellipse(270, 245 + sceneOffsetY, 102, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    const trunk = new Path2D();
    trunk.moveTo(240, 250 + sceneOffsetY);
    trunk.bezierCurveTo(220, 210 + sceneOffsetY, 228, 170 + sceneOffsetY, 246, 132 + sceneOffsetY);
    trunk.bezierCurveTo(257, 112 + sceneOffsetY, 254, 90 + sceneOffsetY, 268, 72 + sceneOffsetY);
    trunk.bezierCurveTo(284, 94 + sceneOffsetY, 286, 120 + sceneOffsetY, 296, 146 + sceneOffsetY);
    trunk.bezierCurveTo(308, 182 + sceneOffsetY, 318, 214 + sceneOffsetY, 300, 250 + sceneOffsetY);
    trunk.closePath();
    const trunkPaint = ctx.createLinearGradient(232, 74 + sceneOffsetY, 302, 250 + sceneOffsetY);
    trunkPaint.addColorStop(0, "#86624c");
    trunkPaint.addColorStop(0.45, "#a0785b");
    trunkPaint.addColorStop(1, "#755744");
    ctx.fillStyle = trunkPaint;
    ctx.fill(trunk);

    ctx.strokeStyle = "#785843";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(268, 104 + sceneOffsetY);
    ctx.quadraticCurveTo(210, 78 + sceneOffsetY, 156, 46 + sceneOffsetY);
    ctx.moveTo(273, 98 + sceneOffsetY);
    ctx.quadraticCurveTo(330, 78 + sceneOffsetY, 386, 48 + sceneOffsetY);
    ctx.moveTo(264, 128 + sceneOffsetY);
    ctx.quadraticCurveTo(220, 120 + sceneOffsetY, 176, 100 + sceneOffsetY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#f9f9f2";
    ctx.fillRect(422, 154 + sceneOffsetY, 88, 68);
    ctx.fillStyle = "#b84a37";
    ctx.beginPath();
    ctx.moveTo(412, 154 + sceneOffsetY);
    ctx.lineTo(466, 126 + sceneOffsetY);
    ctx.lineTo(520, 154 + sceneOffsetY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#8f5e3e";
    ctx.fillRect(455, 196 + sceneOffsetY, 18, 26);
    ctx.fillStyle = "#d4ecff";
    ctx.fillRect(483, 174 + sceneOffsetY, 16, 14);
    ctx.strokeStyle = "#84644f";
    ctx.lineWidth = 2;
    ctx.strokeRect(483, 174 + sceneOffsetY, 16, 14);
    ctx.beginPath();
    ctx.moveTo(491, 174 + sceneOffsetY);
    ctx.lineTo(491, 188 + sceneOffsetY);
    ctx.moveTo(483, 181 + sceneOffsetY);
    ctx.lineTo(499, 181 + sceneOffsetY);
    ctx.stroke();

    const grassTop = 250 + sceneOffsetY;
    const grassGradient = ctx.createLinearGradient(0, grassTop + 8, this.canvas.width, this.canvas.height);
    grassGradient.addColorStop(0, "#4d6f38");
    grassGradient.addColorStop(0.52, "#6f9051");
    grassGradient.addColorStop(1, "#88ad64");
    ctx.fillStyle = grassGradient;
    ctx.fillRect(0, grassTop, this.canvas.width, this.canvas.height - grassTop);

    const grassPalette = ["#476833", "#628347", "#7ea65c"];
    for (let y = grassTop + 2; y < this.canvas.height; y += 14) {
      for (let x = 0; x < this.canvas.width; x += 12) {
        const n = Math.sin(x * 0.03 + y * 0.018) + Math.cos(y * 0.024 - x * 0.011);
        const idx = n > 0.85 ? 2 : n > -0.15 ? 1 : 0;
        ctx.fillStyle = grassPalette[idx];
        ctx.fillRect(x, y, 11, 12);
      }
    }

    const finishY = CONFIG.game.finishLineY;
    ctx.save();
    ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(0, finishY, this.canvas.width, 5);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, finishY - 2);
    ctx.lineTo(this.canvas.width, finishY - 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(50,50,50,0.65)";
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(0, finishY + 6);
    ctx.lineTo(this.canvas.width, finishY + 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  #drawGuards(ctx, now) {
    const sceneOffsetY = -22;
    const guards = [
      { x: 136, y: 278 + sceneOffsetY, mask: "○" },
      { x: 205, y: 294 + sceneOffsetY, mask: "△" },
      { x: 336, y: 294 + sceneOffsetY, mask: "□" },
      { x: 404, y: 278 + sceneOffsetY, mask: "○" },
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
    const { x, y, bob, headRotation, frontVisible } = this.dollPose ?? this.#computeDollPose(now);
    const backVisible = 1 - frontVisible;

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

    const drawPigtail = (side) => {
      const sx = side * 28;
      ctx.fillStyle = "#161616";
      ctx.beginPath();
      ctx.ellipse(sx, -6, 12, 16, side * 0.42, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#2f2f2f";
      ctx.lineWidth = 2.3;
      ctx.beginPath();
      ctx.ellipse(sx, -6, 8, 11, side * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    };
    drawPigtail(-1);
    drawPigtail(1);

    ctx.globalAlpha = backVisible;
    ctx.fillStyle = "#1b120e";
    ctx.beginPath();
    ctx.ellipse(-15, -2, 10, 20, -0.25, 0, Math.PI * 2);
    ctx.ellipse(15, -2, 10, 20, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#211610";
    ctx.beginPath();
    ctx.arc(0, -3, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = frontVisible;
    ctx.fillStyle = "#f6d9ba";
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    const firingLaser = this.doll.isScanning() && frontVisible > 0.35;
    ctx.fillStyle = firingLaser ? "#ffd1d1" : "#fff";
    ctx.beginPath();
    ctx.arc(-8, -2, 5.3, 0, Math.PI * 2);
    ctx.arc(8, -2, 5.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = firingLaser ? "#8b0000" : "#111";
    ctx.beginPath();
    ctx.arc(-8, -2, 2.7, 0, Math.PI * 2);
    ctx.arc(8, -2, 2.7, 0, Math.PI * 2);
    ctx.fill();
    if (firingLaser) {
      const pulse = 0.75 + Math.sin(now * 0.05) * 0.25;
      for (const eyeX of [-8, 8]) {
        ctx.fillStyle = "rgba(255,0,0,0.9)";
        ctx.beginPath();
        ctx.arc(eyeX, -2, 3.6 + pulse * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = "#8f5a4b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 10);
    ctx.quadraticCurveTo(0, 13, 6, 10);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
    ctx.restore();
  }

  #drawVisionCone(ctx, now) {
    const cone = this.vision.getCone();

    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const glow = ctx.createRadialGradient(cone.origin.x, cone.origin.y, 36, cone.origin.x, cone.origin.y, cone.radius);
    glow.addColorStop(0, this.aggressiveScan ? "rgba(255,50,50,0.5)" : "rgba(255,60,60,0.34)");
    glow.addColorStop(1, "rgba(255,60,60,0.02)");

    ctx.beginPath();
    ctx.moveTo(cone.origin.x, cone.origin.y);
    ctx.lineTo(cone.p1.x, cone.p1.y);
    ctx.lineTo(cone.p2.x, cone.p2.y);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.strokeStyle = this.aggressiveScan ? "rgba(255,176,176,0.95)" : "rgba(255,128,128,0.8)";
    ctx.lineWidth = this.aggressiveScan ? 3 : 2;
    ctx.stroke();

    if (!this.dollPose) return;
    const pulse = 0.82 + Math.sin(now * 0.06) * 0.18;
    const centerLength = cone.radius * 0.96;
    const edgeLength = cone.radius * 0.9;

    for (const eye of [this.dollPose.leftEye, this.dollPose.rightEye]) {
      const cx = eye.x + Math.cos(cone.direction) * centerLength;
      const cy = eye.y + Math.sin(cone.direction) * centerLength;
      ctx.strokeStyle = `rgba(255,40,40,${0.65 + pulse * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      for (const edgeAngle of [cone.leftAngle, cone.rightAngle]) {
        const ex = eye.x + Math.cos(edgeAngle) * edgeLength;
        const ey = eye.y + Math.sin(edgeAngle) * edgeLength;
        ctx.strokeStyle = `rgba(255,100,100,${0.25 + pulse * 0.2})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(eye.x, eye.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
  }

  #computeDollPose(now) {
    const x = this.canvas.width / 2;
    const y = 264;
    const bob = this.doll.state === "safe" ? Math.sin(now * 0.006) * 1.4 : 0;
    const turnP = this.doll.turnProgress(now);
    const scanning = this.doll.isScanning();
    const scanHeadRotation = this.vision.getDirection() - Math.PI / 2;
    const headRotation = this.doll.state === "turn" ? Math.PI - turnP * Math.PI : scanning ? scanHeadRotation : this.doll.state === "safe" ? Math.PI : 0;
    const frontVisible = Math.max(0, Math.cos(headRotation));
    const cos = Math.cos(headRotation);
    const sin = Math.sin(headRotation);
    const rotatePoint = (px, py) => ({
      x: x + px * cos - py * sin,
      y: y + bob + px * sin + py * cos,
    });
    const leftEye = rotatePoint(-8, -64);
    const rightEye = rotatePoint(8, -64);
    const eyeCenter = rotatePoint(0, -64);
    return {
      x,
      y,
      bob,
      headRotation,
      frontVisible,
      leftEye,
      rightEye,
      eyeCenter,
    };
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

      if (p.state === "eliminated" && p.explosionParticles.length > 0) {
        for (const particle of p.explosionParticles) {
          if (particle.life <= 0) continue;
          ctx.fillStyle = `rgba(255,${120 + Math.floor(Math.random() * 80)},30,${particle.life})`;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          ctx.fill();
        }
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
