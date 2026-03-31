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
const GUARDS = [
  { id: 1, x: 108, y: 256, mask: "○" },
  { id: 2, x: 188, y: 272, mask: "△" },
  { id: 3, x: 352, y: 272, mask: "□" },
  { id: 4, x: 432, y: 256, mask: "○" },
];

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
    this.autoTap = false;
    this.nextAutoTapAt = performance.now();
    this.autoTapInterval = 320;
    this.dangerSinceAt = 0;
    this.aggressiveScan = false;
    this.aggressiveProgress = 0;
    this.dollPose = this.#computeDollPose(performance.now());
    this.cookieStrike = null;
    this.nextCookieAttackAt = Infinity;
    this.effect = null;
    this.lastFrameAt = performance.now();

    this.bridge = new EventBridge({
      onJoinCommand: (username) => this.spawnPlayer(username),
      onGift: (username, gift) => this.handleGift(username, gift),
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
    this.nextCookieAttackAt = now + this.#cookieAttackIntervalMs();
    this.sounds.playIdle();
    requestAnimationFrame((t) => this.#loop(t));
  }

  spawnPlayer(username) {
    this.sounds.enable();
    const name = username ?? `${USER_POOL[Math.floor(Math.random() * USER_POOL.length)]}${Math.floor(Math.random() * 90 + 10)}`;
    if (this.players.getAliveByUsername(name)) {
      this.uiManager.announce(`${name} ya está jugando`, "neutral");
      return;
    }
    this.players.addPlayer(name);
    this.uiManager.announce(`${name} entró al juego`, "ok");
    this.chat.sendChatMessage("Nuevo jugador ha entrado al juego");
  }

  handleGift(username, gift) {
    this.sounds.enable();
    const normalized = (gift ?? "").toLowerCase();
    if (normalized === "rose" || normalized === "rosa") {
      const p = this.players.addShieldByUsername(username, 1);
      if (p) this.uiManager.announce(`🌹 +1 escudo para ${username} (${p.shields})`, "ok");
      return;
    }
    if (normalized === "donut" || normalized === "dona") {
      const p = this.players.addShieldByUsername(username, 5);
      if (p) this.uiManager.announce(`🍩 +5 escudos para ${username} (${p.shields})`, "ok");
      return;
    }
    if (normalized === "dance") this.#activateEffect("dance", 20000, username);
    if (normalized === "freeze") this.#activateEffect("freeze", 10000, username);
    if (normalized === "pause") this.#activateEffect("pause", 20000, username);
    if (normalized === "mass") this.#massExplosion(username);
  }

  handleTap(username) {
    this.sounds.enable();
    const now = performance.now();
    const isDanger = this.doll.isDanger();

    if (username) {
      if (this.effect?.type === "freeze" && this.effect.actor !== username) return;
      if (this.effect?.type === "pause" || this.effect?.type === "dance") return;
      const candidate = this.players.getAll().find((p) => p.username === username);
      if (candidate && this.players.applyTap(candidate.id, now, isDanger)) {
        this.sounds.playStep();
        this.uiManager.floatingText(`+tap ${candidate.username}`, candidate.x, candidate.y - 30);
      }
      return;
    }

    if ((this.effect?.type === "pause") || (this.effect?.type === "dance") || (this.effect?.type === "freeze")) return;
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
    this.ui.playBtn.addEventListener("click", () => this.spawnPlayer("lsnoglos"));
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
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;
    const locked = this.effect && now < this.effect.endsAt;
    if (locked) {
      this.roundStartAt += delta;
      this.doll.shiftTime(delta);
      if (this.cookieStrike) {
        this.cookieStrike.explodeAt += delta;
        if (this.cookieStrike.impactAt) this.cookieStrike.impactAt += delta;
      }
      this.uiManager.setContextMessage(`${this.#effectLabel()} ${Math.ceil((this.effect.endsAt - now) / 1000)}s`);
    }
    if (this.effect && now >= this.effect.endsAt) {
      this.uiManager.announce("Efecto finalizado", "neutral");
      this.effect = null;
      this.sounds.stopDance();
    }

    const stateEvent = locked ? null : this.doll.update(now);

    if (stateEvent === "turn") {
      this.sounds.playTurn();
      this.uiManager.triggerTurnFX();
      this.uiManager.announce("¡Se está volteando!", "danger");
      this.uiManager.setContextMessage("¡Se está volteando!");
    }

    if (stateEvent === "dangerHold") {
      this.uiManager.setContextMessage("¡Quietos!");
      this.uiManager.announce("Ojos rojos...", "danger");
      this.uiManager.setDangerMode(true);
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

    this.players.update(now, {
      isDanger: this.doll.isDanger(),
      freezeExcept: this.effect?.type === "freeze" ? this.effect.actor : this.effect ? "__none__" : null,
    });
    if (!locked) this.#updateCookieHazard(now);
    this.#checkGoal(now);
    if (!locked) this.#checkRoundTimer(now);

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
        if (eliminated?.blockedByShield) {
          this.uiManager.announce(`🛡️ ${mover.username} bloqueó el disparo`, "ok");
        } else if (eliminated?.player) {
          this.sounds.playElimination();
          this.uiManager.announce(`${eliminated.player.username} eliminado`, "danger");
          this.chat.sendChatMessage(`${eliminated.player.username} salió del juego 💀 escribe jugar para volver`);
        }
      }
    }
    this.players.clearDangerMovementFlags();
  }

  #checkGoal(now) {
    for (const p of this.players.getAlive()) {
      if (p.y > CONFIG.game.finishLineY + CONFIG.game.finishWindow) continue;
      const registered = this.ranking.registerWinner(p);
      if (!registered) continue;

      const goalY = p.y;
      p.y = CONFIG.game.startLineY;
      p.velocityY = 0;
      p.pendingImpulses = [];
      this.sounds.playVictory();
      this.uiManager.floatingText(`¡${p.username} llegó a la meta!`, p.x, goalY - 24, "victory");
      this.uiManager.announce(`¡${p.username} llegó a la meta!`, "ok");
      this.uiManager.triggerTurnFX();
      this.chat.sendChatMessage(`${p.username} llegó a la meta 🏁 ${registered.place}er lugar`);
    }
  }

  #checkRoundTimer(now) {
    const elapsed = now - this.roundStartAt;
    if (elapsed < this.roundDurationMs) return;

    if (this.players.getAliveCount() > 0) {
      this.level += 1;
      this.uiManager.announce(`Nivel ${this.level}`, "ok");
    } else {
      this.uiManager.announce("Sin jugadores en campo: nivel sin cambios", "neutral");
    }

    this.ranking.reset();
    this.roundStartAt = now;
    this.roundDurationMs = CONFIG.game.roundSeconds * 1000;
    this.doll.start(now, this.level);
    this.vision.setLevel(this.level);
    this.nextCookieAttackAt = now + this.#cookieAttackIntervalMs();
    this.cookieStrike = null;
  }

  #syncHud(now) {
    const remainSec = Math.max(0, (this.roundDurationMs - (now - this.roundStartAt)) / 1000);
    this.uiManager.updateHud({
      timeLeft: remainSec,
      aliveCount: this.players.getAliveCount(),
      gameState: this.doll.state === "safe" ? "safe" : "danger",
      ranking: this.ranking.topWinners(),
      monthlyWinners: this.ranking.monthlyTop(3),
    });
  }

  #render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.#drawField(ctx);
    this.#drawCookieWarning(ctx, now);
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
    ctx.fillStyle = "rgba(240, 247, 255, 0.9)";
    ctx.font = "900 56px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(26, 43, 65, 0.55)";
    ctx.lineWidth = 6;
    const levelLabel = `NIVEL ${this.level}`;
    ctx.strokeText(levelLabel, this.canvas.width / 2, 84);
    ctx.fillText(levelLabel, this.canvas.width / 2, 84);

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
    ctx.shadowColor = "rgba(255, 255, 180, 0.95)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(255,255,220,0.98)";
    ctx.fillRect(0, finishY, this.canvas.width, 7);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, finishY - 3);
    ctx.lineTo(this.canvas.width, finishY - 3);
    ctx.stroke();

    ctx.strokeStyle = "rgba(25,25,25,0.88)";
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.moveTo(0, finishY + 9);
    ctx.lineTo(this.canvas.width, finishY + 9);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  #drawGuards(ctx, now) {
    for (const g of GUARDS) {
      const breath = Math.sin(now * 0.004 + g.x) * 1.7;
      const throwing = this.cookieStrike?.guardId === g.id && this.cookieStrike.state === "throw";
      ctx.save();
      ctx.translate(g.x, g.y + breath);
      ctx.fillStyle = "#cc2d44";
      ctx.fillRect(-11, -33, 22, 45);
      ctx.strokeStyle = "#1b1117";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-11, -18);
      ctx.lineTo(-22, throwing ? -50 : -8);
      ctx.moveTo(11, -18);
      ctx.lineTo(22, -8);
      ctx.stroke();
      ctx.fillStyle = "#1a1518";
      ctx.fillRect(-10, -48, 20, 17);
      ctx.fillStyle = "#f3f3f3";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(g.mask, 0, -35);
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(`${g.id}`, 0, -18);
      ctx.restore();
    }
  }

  #drawCookieWarning(ctx, now) {
    if (!this.cookieStrike) return;

    const blinkOn = Math.floor(now / 260) % 2 === 0;
    if (this.cookieStrike.state === "throw") {
      const progress = Math.min(1, (now - this.cookieStrike.createdAt) / 900);
      const startX = this.cookieStrike.throwStart.x;
      const startY = this.cookieStrike.throwStart.y;
      const endX = this.cookieStrike.x;
      const endY = this.cookieStrike.y;
      const arcLift = Math.sin(progress * Math.PI) * 120;
      const bx = startX + (endX - startX) * progress;
      const by = startY + (endY - startY) * progress - arcLift;
      ctx.save();
      ctx.fillStyle = "#ff3030";
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.cookieStrike.state === "warning" && blinkOn) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 80, 80, 0.95)";
      ctx.strokeStyle = "rgba(255, 225, 225, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.cookieStrike.x, this.cookieStrike.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (this.cookieStrike.state === "impact") {
      const elapsed = now - this.cookieStrike.impactAt;
      const progress = Math.min(1, elapsed / 480);
      const radius = 10 + progress * 20;
      const alpha = 0.9 - progress * 0.9;
      if (alpha <= 0) return;
      ctx.save();
      ctx.fillStyle = `rgba(255, 120, 36, ${alpha})`;
      ctx.strokeStyle = `rgba(255, 236, 186, ${alpha})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(this.cookieStrike.x, this.cookieStrike.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  #updateCookieHazard(now) {
    if (!this.cookieStrike && now >= this.nextCookieAttackAt) {
      this.#startCookieStrike(now);
    }
    if (!this.cookieStrike) return;

    if (this.cookieStrike.state === "throw" && now - this.cookieStrike.createdAt >= 900) {
      this.cookieStrike.state = "warning";
      this.cookieStrike.explodeAt = now + 2200;
    }

    if (this.cookieStrike.state === "warning" && now >= this.cookieStrike.explodeAt) {
      this.cookieStrike.state = "impact";
      this.cookieStrike.impactAt = now;
      this.sounds.playCookieImpact();
      this.#applyCookieBlast(now);
    }

    if (this.cookieStrike.state === "impact" && now - this.cookieStrike.impactAt >= 520) {
      this.cookieStrike = null;
    }
  }

  #startCookieStrike(now) {
    const shuffled = [...GUARDS].sort(() => Math.random() - 0.5);
    const candidates = shuffled.slice(0, 2);
    const thrower = candidates[Math.floor(Math.random() * candidates.length)];
    this.cookieStrike = {
      guardId: thrower.id,
      x: this.#randomBetween(68, this.canvas.width - 68),
      y: this.#randomBetween(CONFIG.game.finishLineY + 18, CONFIG.game.startLineY - 48),
      state: "warning",
      throwStart: { x: thrower.x, y: thrower.y - 42 },
      createdAt: now,
      explodeAt: now + 2200,
      impactAt: null,
    };
    this.cookieStrike.state = "throw";
    this.nextCookieAttackAt = now + this.#cookieAttackIntervalMs();
    this.uiManager.announce(`Guardia ${thrower.id} lanzó galleta`, "danger");
    this.sounds.playCookieWarning();
  }

  #applyCookieBlast(now) {
    if (!this.cookieStrike) return;
    const blastRadius = 10;
    for (const p of this.players.getAlive()) {
      const distance = Math.hypot(p.x - this.cookieStrike.x, p.y - this.cookieStrike.y);
      if (distance > blastRadius) continue;
      const eliminated = this.players.eliminatePlayer(p.id, now);
      if (eliminated?.blockedByShield) {
        this.uiManager.announce(`🛡️ ${p.username} resistió la bola`, "ok");
      } else if (eliminated?.player) {
        this.uiManager.announce(`${eliminated.player.username} fue alcanzado por la bola`, "danger");
      }
    }
  }

  #cookieAttackIntervalMs() {
    const perLevelSeconds = [48, 44, 40, 36, 33, 30, 28, 25, 22, 20];
    const index = Math.min(10, Math.max(1, this.level)) - 1;
    return perLevelSeconds[index] * 1000;
  }

  #randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  #activateEffect(type, durationMs, actor) {
    this.effect = {
      type,
      actor,
      endsAt: performance.now() + durationMs,
    };
    if (type === "dance") {
      this.uiManager.announce("💃 La muñeca se puso a bailar", "ok");
      this.sounds.playDance();
    }
    if (type === "freeze") this.uiManager.announce(`❄️ Tiempo detenido por ${actor}`, "danger");
    if (type === "pause") this.uiManager.announce("⏸️ Juego en pausa", "neutral");
  }

  #massExplosion(actor) {
    const now = performance.now();
    for (const p of this.players.getAlive()) {
      if (p.username === actor) continue;
      p.y = CONFIG.game.startLineY;
      p.velocityY = 0;
      p.pendingImpulses = [];
      this.uiManager.floatingText("💥", p.x, p.y - 18, "danger");
    }
    this.uiManager.announce(`💥 Explosión masiva por ${actor}`, "danger");
  }

  #effectLabel() {
    if (!this.effect) return "";
    if (this.effect.type === "dance") return "Baile";
    if (this.effect.type === "freeze") return "Tiempo detenido";
    if (this.effect.type === "pause") return "Pausa";
    return "Efecto";
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
    const dancing = this.effect?.type === "dance";
    const bob = dancing ? Math.sin(now * 0.018) * 8 : this.doll.state === "safe" ? Math.sin(now * 0.006) * 1.4 : 0;
    const turnP = this.doll.turnProgress(now);
    const scanning = this.doll.isScanning();
    const scanHeadRotation = this.vision.getDirection() - Math.PI / 2;
    const headRotation = dancing
      ? Math.PI + Math.sin(now * 0.02) * 0.7
      : this.doll.state === "turn"
        ? Math.PI - turnP * Math.PI
        : scanning
          ? scanHeadRotation
          : this.doll.state === "safe"
            ? Math.PI
            : 0;
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

      const suitColor = p.state === "eliminated" ? "#ff3b3b" : "#0e8f64";
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, -15, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = suitColor;
      ctx.fillRect(-7, -8, 14, 20);
      ctx.strokeStyle = "#f3f3f3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, -8);
      ctx.lineTo(-11, 7);
      ctx.moveTo(7, -8);
      ctx.lineTo(11, 7);
      ctx.moveTo(-4, 12);
      ctx.lineTo(-4, 26);
      ctx.moveTo(4, 12);
      ctx.lineTo(4, 26);
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
      if (p.shields > 0 && p.state === "alive") {
        ctx.fillStyle = "#9cecff";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(`🛡️${p.shields}`, p.x, p.y - 42);
      }
    }
  }
}
