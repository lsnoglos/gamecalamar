import { CONFIG } from "./config.js";
import { PlayerManager } from "./PlayerManager.js";
import { DollAI } from "./DollAI.js";
import { VisionSystem } from "./VisionSystem.js";
import { RankingSystem } from "./RankingSystem.js";
import { EventBridge } from "./EventBridge.js";
import { SoundManager } from "./SoundManager.js";
import { UIManager } from "./UIManager.js";
import { ChatSystem } from "./ChatSystem.js";
import { COMMAND_KEY, NON_ADMIN_ACTION_COOLDOWN_MS, createChatRequest } from "./GameRequests.js";

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
    this.clouds = this.#createClouds(9);
    this.remainingIceBreaths = this.#levelRule().iceBreathCount;
    this.activeIceBreath = null;
    this.dangerGraceEndsAt = 0;
    this.missileStrike = null;
    this.commandCooldowns = new Map();
    this.adminUsers = new Set((CONFIG.admin?.usernames ?? []).map((name) => name.toLowerCase()));

    this.bridge = new EventBridge({
      onJoinCommand: (request) => this.spawnPlayer(request?.username),
      onGift: (request) => this.handleGift(request),
      onTap: (request) => this.handleTap(request?.username),
      onChatCommand: (request) => this.handleChatCommand(request),
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
    this.remainingIceBreaths = this.#levelRule().iceBreathCount;
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

  handleGift(request) {
    this.sounds.enable();
    const username = request?.username;
    const gift = request?.gift;
    const normalized = (gift ?? "").toLowerCase();
    this.#resetCommandCooldown(username);
    if (normalized === "rose" || normalized === "rosa") {
      const p = this.players.addShieldByUsername(username, 1);
      if (p) this.uiManager.announce(`🌹 +1 escudo protector para ${username} (${p.shields})`, "ok");
      return;
    }
    if (normalized === "corazon" || normalized === "heart") this.#activateEffect("freeze", 10000, username);
    if (normalized === "gorra" || normalized === "cap" || normalized === "sombrero" || normalized === "hat") this.#massExplosion(username);
  }

  handleChatCommand(request) {
    const username = request?.username;
    const commandKey = request?.commandKey;
    if (commandKey === COMMAND_KEY.MISSILE) {
      this.#triggerCommandWithRoleLimits(commandKey, username, () => this.#activateMissileStrike(username));
      return;
    }
    if (commandKey === COMMAND_KEY.DANCE) {
      this.#triggerCommandWithRoleLimits(commandKey, username, () => this.#activateEffect("dance", 25000, username));
    }
  }

  handleTap(username) {
    this.sounds.enable();
    const now = performance.now();
    const isDanger = this.doll.isDanger() && !this.#isDangerSuppressed();
    const freezeActorSlowdown = this.effect?.type === "freeze" ? 0.65 : 1;

    if (username) {
      const candidate = this.players.getAliveByUsername(username);
      if (this.effect?.type === "freeze" && candidate && this.effect.actorId !== candidate.id) return;
      if (this.effect?.type === "iceBreath") return;
      if (this.effect?.type === "pause" || this.effect?.type === "dance") return;
      const speedScale = this.effect?.type === "freeze" && candidate && this.effect.actorId === candidate.id ? freezeActorSlowdown : 1;
      if (candidate && this.players.applyTap(candidate.id, now, isDanger, speedScale)) {
        this.sounds.playStep();
        this.uiManager.floatingText(`+tap ${candidate.username}`, candidate.x, candidate.y - 30);
      }
      return;
    }

    if ((this.effect?.type === "pause") || (this.effect?.type === "dance") || (this.effect?.type === "iceBreath")) return;
    if (this.effect?.type === "freeze") {
      const moved = this.players.applyTapByUsername(CONFIG.debug.testDriverUsername, now, isDanger, freezeActorSlowdown);
      if (moved) {
        this.sounds.playStep();
        const tester = this.players.getAliveByUsername(CONFIG.debug.testDriverUsername);
        if (tester) this.uiManager.floatingText(`+tap ${tester.username}`, tester.x, tester.y - 30);
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
    this.ui.playBtn.addEventListener("click", () => this.spawnPlayer(CONFIG.debug.testDriverUsername));
    this.ui.spawnBtn.addEventListener("click", () => this.spawnPlayer());
    this.ui.tapBtn.addEventListener("mousedown", () => this.handleTap());
    this.ui.tapBtn.addEventListener("touchstart", () => this.handleTap(), { passive: true });
    this.ui.autoTapBtn.addEventListener("click", () => {
      this.autoTap = !this.autoTap;
      this.ui.autoTapBtn.textContent = `Auto Tap: ${this.autoTap ? "ON" : "OFF"}`;
      this.uiManager.announce(this.autoTap ? "Auto Tap activado" : "Auto Tap desactivado", "neutral");
    });

    for (const giftBtn of this.ui.giftButtons) {
      giftBtn.addEventListener("click", () => {
        const trigger = giftBtn.dataset.trigger;
        if (trigger === "chat") {
          const message = giftBtn.dataset.message ?? "";
          this.handleChatCommand(createChatRequest({ username: CONFIG.debug.testDriverUsername, message }));
          this.uiManager.announce(`Mensaje enviado: ${message}`, "ok");
          return;
        }
        const gift = giftBtn.dataset.gift;
        this.handleGift({ username: CONFIG.debug.testDriverUsername, gift });
        this.uiManager.announce(`Regalo activado: ${gift}`, "ok");
      });
    }
  }

  #loop(now) {
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;
    const locked = this.effect && now < this.effect.endsAt;
    const flashWindowActive = this.doll.state === "turn" && now >= this.dangerGraceEndsAt;
    if (locked) {
      this.roundStartAt += delta;
      this.doll.shiftTime(delta);
      if (this.cookieStrike) {
        this.cookieStrike.explodeAt += delta;
        if (this.cookieStrike.impactAt) this.cookieStrike.impactAt += delta;
      }
      this.uiManager.setContextMessage(`${this.#effectLabel()} ${Math.ceil((this.effect.endsAt - now) / 1000)}s`);
      if (this.effect.type === "iceBreath") this.#updateIceBreath(now);
      if (this.effect.type === "missile") this.#updateMissileStrike(now);
    }
    if (this.effect && now >= this.effect.endsAt) {
      this.uiManager.announce("Efecto finalizado", "neutral");
      if (this.effect.type === "iceBreath") this.activeIceBreath = null;
      if (this.effect.type === "missile") this.missileStrike = null;
      this.effect = null;
      this.sounds.stopDance();
    }

    const stateEvent = locked ? null : this.doll.update(now);

    if (stateEvent === "turn") {
      this.sounds.playTurn();
      this.uiManager.triggerTurnFX();
      this.uiManager.announce("¡Se está volteando!", "danger");
      this.uiManager.setContextMessage("¡Se está volteando!");
      this.dangerGraceEndsAt = now + CONFIG.game.flashGraceMs;
    }

    if (stateEvent === "dangerHold") {
      this.uiManager.setContextMessage("¡Quietos!");
      this.uiManager.announce("Ojos rojos...", "danger");
      this.uiManager.setDangerMode(true);
    }

    if (stateEvent === "danger") {
      if (this.#isDangerSuppressed()) {
        this.#interruptDollThreat(now);
      } else if (this.#shouldTriggerIceBreath()) {
        this.#startIceBreath(now);
      } else {
        this.#eliminateFlashViolators(now);
        this.sounds.playScan();
        this.dangerSinceAt = now;
        this.aggressiveScan = false;
        this.aggressiveProgress = 0;
        this.uiManager.setContextMessage("¡No te muevas!");
        this.uiManager.announce("La muñeca te está viendo 👁️", "danger");
      }
    }

    if (stateEvent === "safe") {
      this.sounds.playIdle();
      this.uiManager.announce("Corre… ahora…", "ok");
      this.uiManager.setContextMessage(Math.random() > 0.5 ? "Corre… ahora…" : "Avanza rápido");
      this.aggressiveScan = false;
      this.aggressiveProgress = 0;
      this.uiManager.setDangerMode(false);
      this.dangerGraceEndsAt = 0;
    }

    const scanActive = this.#isScanActive();
    if (scanActive) {
      const scanningFor = now - this.dangerSinceAt;
      this.aggressiveScan = scanningFor >= CONFIG.game.cone.aggressiveAfterMs;
      this.aggressiveProgress = Math.min(1, scanningFor / 1600);
      if (this.aggressiveScan) {
        this.uiManager.setContextMessage("¡Te está buscando!");
      }
      this.uiManager.setDangerMode(true);
    }

    this.vision.update(now, {
      scanning: scanActive,
      aggressive: this.aggressiveScan,
      aggressiveProgress: this.aggressiveProgress,
    });
    this.dollPose = this.#computeDollPose(now);
    this.vision.setOrigin(this.dollPose.eyeCenter);

    if (scanActive) {
      this.#scanAndEliminate(now);
    }

    if (this.autoTap && now >= this.nextAutoTapAt) {
      this.handleTap();
      this.nextAutoTapAt = now + this.autoTapInterval;
    }

    this.players.update(now, {
      isDanger: this.doll.isDanger() && !this.#isDangerSuppressed(),
      freezeExceptId: this.effect?.type === "freeze" ? this.effect.actorId : this.effect ? "__none__" : null,
      freezeExceptIds: this.effect?.type === "freeze" ? [this.effect.actorId].filter(Boolean) : [],
      forceFrozen: this.effect?.type === "iceBreath",
      flashWindowActive,
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
        if (eliminated?.blockedByShield && eliminated.shieldConsumed) {
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
      const registered = this.ranking.registerWinner(p, this.level);
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
    this.remainingIceBreaths = this.#levelRule().iceBreathCount;
    this.activeIceBreath = null;
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
      level: this.level,
    });
  }

  #render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.#drawField(ctx, now);
    this.#drawCookieWarning(ctx, now);
    if (this.#isScanActive()) this.#drawVisionCone(ctx, now);
    this.#drawGuards(ctx, now);
    this.#drawDoll(ctx, now);
    this.#drawPlayers(ctx, now);
    this.#drawMissileSequence(ctx, now);
  }

  #drawField(ctx, now) {
    const sceneOffsetY = -22;
    const danceState = this.#getDanceState(now);
    const danceActive = danceState.active;
    const danceMix = danceState.colorMix;
    const discoPhase = now * 0.004;
    const sky = ctx.createLinearGradient(0, 0, 0, 310);
    if (danceActive) {
      const sat = 24 + danceMix * 66;
      sky.addColorStop(0, `hsl(${(discoPhase * 95) % 360} ${sat}% ${77 - danceMix * 15}%)`);
      sky.addColorStop(0.5, `hsl(${(discoPhase * 95 + 70) % 360} ${sat}% ${76 - danceMix * 18}%)`);
      sky.addColorStop(1, `hsl(${(discoPhase * 95 + 150) % 360} ${sat}% ${79 - danceMix * 27}%)`);
    } else {
      sky.addColorStop(0, "#95d7ff");
      sky.addColorStop(1, "#c6e7fb");
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.canvas.width, 320);
    this.#drawClouds(ctx, now);
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

    ctx.fillStyle = "rgba(63, 48, 36, 0.2)";
    ctx.beginPath();
    ctx.ellipse(270, 246 + sceneOffsetY, 112, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    const pyramid = new Path2D();
    pyramid.moveTo(268, 76 + sceneOffsetY);
    pyramid.lineTo(172, 246 + sceneOffsetY);
    pyramid.lineTo(364, 246 + sceneOffsetY);
    pyramid.closePath();
    const pyramidPaint = ctx.createLinearGradient(176, 84 + sceneOffsetY, 360, 246 + sceneOffsetY);
    if (danceActive) {
      const sat = 20 + danceMix * 75;
      pyramidPaint.addColorStop(0, `hsla(${(discoPhase * 120 + 30) % 360} ${sat}% ${86 - danceMix * 22}% / 0.52)`);
      pyramidPaint.addColorStop(0.5, `hsla(${(discoPhase * 120 + 150) % 360} ${sat}% ${76 - danceMix * 20}% / 0.48)`);
      pyramidPaint.addColorStop(1, `hsla(${(discoPhase * 120 + 255) % 360} ${sat}% ${62 - danceMix * 10}% / 0.5)`);
    } else {
      pyramidPaint.addColorStop(0, "rgba(255, 223, 138, 0.5)");
      pyramidPaint.addColorStop(0.5, "rgba(220, 177, 95, 0.4)");
      pyramidPaint.addColorStop(1, "rgba(160, 118, 64, 0.45)");
    }
    ctx.fillStyle = pyramidPaint;
    ctx.fill(pyramid);
    ctx.strokeStyle = "rgba(133, 98, 56, 0.62)";
    ctx.lineWidth = 5;
    ctx.stroke(pyramid);
    ctx.restore();

    const houseY = 200 + sceneOffsetY;
    ctx.fillStyle = "#f9f9f2";
    ctx.fillRect(422, houseY, 88, 68);
    ctx.fillStyle = "#b84a37";
    ctx.beginPath();
    ctx.moveTo(412, houseY);
    ctx.lineTo(466, houseY - 28);
    ctx.lineTo(520, houseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#8f5e3e";
    ctx.fillRect(455, houseY + 42, 18, 26);
    ctx.fillStyle = "#d4ecff";
    ctx.fillRect(483, houseY + 20, 16, 14);
    ctx.strokeStyle = "#84644f";
    ctx.lineWidth = 2;
    ctx.strokeRect(483, houseY + 20, 16, 14);
    ctx.beginPath();
    ctx.moveTo(491, houseY + 20);
    ctx.lineTo(491, houseY + 34);
    ctx.moveTo(483, houseY + 27);
    ctx.lineTo(499, houseY + 27);
    ctx.stroke();

    const grassTop = 250 + sceneOffsetY;
    const grassGradient = ctx.createLinearGradient(0, grassTop + 8, this.canvas.width, this.canvas.height);
    if (danceActive) {
      const sat = 22 + danceMix * 56;
      grassGradient.addColorStop(0, `hsl(${(discoPhase * 110 + 340) % 360} ${sat}% ${44 - danceMix * 9}%)`);
      grassGradient.addColorStop(0.52, `hsl(${(discoPhase * 110 + 90) % 360} ${sat}% ${50 - danceMix * 7}%)`);
      grassGradient.addColorStop(1, `hsl(${(discoPhase * 110 + 200) % 360} ${sat}% ${54 - danceMix * 14}%)`);
    } else {
      grassGradient.addColorStop(0, "#4d6f38");
      grassGradient.addColorStop(0.52, "#6f9051");
      grassGradient.addColorStop(1, "#88ad64");
    }
    ctx.fillStyle = grassGradient;
    ctx.fillRect(0, grassTop, this.canvas.width, this.canvas.height - grassTop);

    const grassPalette = danceActive
      ? [
          `hsl(${(discoPhase * 130 + 20) % 360} ${20 + danceMix * 62}% ${41 - danceMix * 9}%)`,
          `hsl(${(discoPhase * 130 + 160) % 360} ${24 + danceMix * 58}% ${49 - danceMix * 7}%)`,
          `hsl(${(discoPhase * 130 + 280) % 360} ${28 + danceMix * 54}% ${58 - danceMix * 6}%)`,
        ]
      : ["#476833", "#628347", "#7ea65c"];
    for (let y = grassTop + 2; y < this.canvas.height; y += 14) {
      for (let x = 0; x < this.canvas.width; x += 12) {
        const n = Math.sin(x * 0.03 + y * 0.018) + Math.cos(y * 0.024 - x * 0.011);
        const idx = n > 0.85 ? 2 : n > -0.15 ? 1 : 0;
        ctx.fillStyle = grassPalette[idx];
        ctx.fillRect(x, y, 11, 12);
      }
    }

    const finishY = CONFIG.game.finishLineY;
    const goalDirtTop = finishY - 86;
    const goalDirtBottom = finishY - 8;
    const dirtGradient = ctx.createLinearGradient(0, goalDirtTop, 0, goalDirtBottom);
    dirtGradient.addColorStop(0, "rgba(146, 111, 74, 0.94)");
    dirtGradient.addColorStop(1, "rgba(120, 88, 56, 0.96)");
    ctx.fillStyle = dirtGradient;
    ctx.fillRect(0, goalDirtTop, this.canvas.width, goalDirtBottom - goalDirtTop);
    for (let i = 0; i < 20; i += 1) {
      const stoneX = 18 + i * 27 + Math.sin(i * 1.9) * 6;
      const stoneY = goalDirtTop + 14 + (i % 6) * 10;
      const stoneR = 3 + (i % 3);
      ctx.fillStyle = i % 2 === 0 ? "#91816e" : "#7d6d5d";
      ctx.beginPath();
      ctx.ellipse(stoneX, stoneY, stoneR + 2, stoneR, (i % 4) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 11; i += 1) {
      const patchX = 20 + i * 49;
      const patchY = goalDirtTop + 8 + (i % 4) * 16;
      ctx.fillStyle = i % 2 === 0 ? "#7ead5a" : "#6f9a4d";
      ctx.beginPath();
      ctx.ellipse(patchX, patchY, 16, 7, 0.08 * (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }

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
    const dance = this.#getDanceFormation(now);
    const missilePhase = this.missileStrike?.phase;
    const elapsedMissile = this.missileStrike ? now - this.missileStrike.startedAt : 0;
    for (const g of GUARDS) {
      const guardDance = dance?.guardsById.get(g.id);
      let gx = guardDance?.x ?? g.x;
      let gy = guardDance?.y ?? g.y;
      const cleanupP = Math.min(1, Math.max(0, (elapsedMissile - 4000) / 6000));
      const carryP = Math.min(1, Math.max(0, (cleanupP - 0.36) / 0.64));

      if (missilePhase === "recovery") {
        const laneY = CONFIG.game.finishLineY + 30 + (g.id - 1) * 8;
        const partIndex = (g.id - 1) % this.missileStrike.parts.length;
        const part = this.missileStrike.parts[partIndex];
        const partX = part.x;
        const partY = part.y;
        const collectX = partX + (this.canvas.width + 80 - partX) * carryP;
        const collectY = partY + (laneY - partY) * carryP;
        gx = g.x + (collectX - g.x) * cleanupP;
        gy = g.y + (collectY - g.y) * cleanupP;
      }

      if (missilePhase === "push" || missilePhase === "return") {
        const pushP = Math.min(1, Math.max(0, (elapsedMissile - 9000) / 4000));
        const returnP = Math.min(1, Math.max(0, (elapsedMissile - 13000) / 2000));
        const carrier = this.#getCarrierPose(pushP);
        const slots = [
          { x: carrier.dollX + 34, y: carrier.dollY - 26 },
          { x: carrier.dollX + 54, y: carrier.dollY - 10 },
          { x: carrier.dollX + 34, y: carrier.dollY + 14 },
          { x: carrier.dollX + 54, y: carrier.dollY + 30 },
        ];
        const slot = slots[g.id - 1];
        gx = missilePhase === "return" ? slot.x + (g.x - slot.x) * returnP : slot.x;
        gy = missilePhase === "return" ? slot.y + (g.y - slot.y) * returnP : slot.y;
      }
      const breath = Math.sin(now * 0.004 + g.x) * 1.7;
      const throwing = this.cookieStrike?.guardId === g.id && this.cookieStrike.state === "throw";
      const torsoLean = guardDance?.torsoLean ?? 0;
      const armSwing = guardDance?.armSwing ?? 0;
      const legSwing = guardDance?.legSwing ?? 0;
      ctx.save();
      ctx.translate(gx, gy + breath);
      ctx.rotate(torsoLean);
      ctx.fillStyle = "#cc2d44";
      ctx.fillRect(-11, -33, 22, 45);
      ctx.strokeStyle = "#1b1117";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-10, -18);
      ctx.lineTo(-22 + armSwing * 8, throwing ? -50 : -8 + armSwing * 10);
      ctx.moveTo(10, -18);
      ctx.lineTo(22 - armSwing * 8, -8 - armSwing * 10);
      ctx.moveTo(-6, 12);
      ctx.lineTo(-8 + legSwing * 6, 32);
      ctx.moveTo(6, 12);
      ctx.lineTo(8 - legSwing * 6, 32);
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
      if (missilePhase === "recovery" || missilePhase === "push" || missilePhase === "return") {
        ctx.fillStyle = "#f6d9ba";
        ctx.fillRect(-5, -54, 10, 6);
      }
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
      if (eliminated?.blockedByShield && eliminated.shieldConsumed) {
        this.uiManager.announce(`🛡️ ${p.username} resistió la bola`, "ok");
      } else if (eliminated?.player) {
        this.uiManager.announce(`${eliminated.player.username} fue alcanzado por la bola`, "danger");
      }
    }
  }

  #cookieAttackIntervalMs() {
    const seconds = this.#levelRule().cookieEverySeconds;
    if (!seconds) return Infinity;
    return seconds * 1000;
  }

  #randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  #activateEffect(type, durationMs, actor) {
    const now = performance.now();
    const actorPlayer = actor ? this.players.getAliveByUsername(actor) : null;
    this.effect = {
      type,
      actor,
      actorId: actorPlayer?.id ?? null,
      durationMs,
      endsAt: now + durationMs,
    };
    if (type === "dance") {
      this.#interruptDollThreat(now);
      this.uiManager.announce("💃 La muñeca se puso a bailar", "ok");
      this.sounds.playDance();
    }
    if (type === "freeze") {
      this.#interruptDollThreat(now);
      this.uiManager.announce(`❄️ Tiempo detenido 10s por ${actor}`, "danger");
    }
    if (type === "pause") this.uiManager.announce("⏸️ Juego en pausa", "neutral");
  }

  #massExplosion(actor) {
    const now = performance.now();
    this.#interruptDollThreat(now);
    const testId = this.players.getAliveByUsername(CONFIG.debug.testDriverUsername)?.id;
    this.players.launchEveryoneToStart(now, { excludeIds: [testId] });
    for (const p of this.players.getAlive()) this.uiManager.floatingText("💥", p.x, p.y - 18, "danger");
    this.uiManager.announce(`💥 Todos al inicio por ${actor}`, "danger");
  }

  #effectLabel() {
    if (!this.effect) return "";
    if (this.effect.type === "dance") return "Baile";
    if (this.effect.type === "freeze") return "Congelar 10s";
    if (this.effect.type === "pause") return "Pausa";
    if (this.effect.type === "iceBreath") return "Soplo de hielo";
    if (this.effect.type === "missile") return "Misil";
    return "Efecto";
  }

  #levelRule() {
    const configs = CONFIG.game.levelConfig;
    const idx = Math.min(configs.length, Math.max(1, this.level)) - 1;
    return configs[idx];
  }

  #shouldTriggerIceBreath() {
    if (this.remainingIceBreaths <= 0) return false;
    return Math.random() < 0.45;
  }

  #startIceBreath(now) {
    this.remainingIceBreaths -= 1;
    this.effect = {
      type: "iceBreath",
      actor: "doll",
      durationMs: CONFIG.game.iceBreath.durationMs,
      endsAt: now + CONFIG.game.iceBreath.durationMs,
    };
    this.activeIceBreath = { nextTickAt: now + CONFIG.game.iceBreath.tickMs, pulsesDone: 0 };
    this.uiManager.announce("❄️ Soplo de hielo: jugadores congelados", "danger");
  }

  #updateIceBreath(now) {
    if (!this.activeIceBreath || now < this.activeIceBreath.nextTickAt) return;
    if (this.activeIceBreath.pulsesDone >= 3) return;
    const push = CONFIG.game.iceBreath.pushBackPercent;
    for (const p of this.players.getAlive()) {
      if (p.shields > 0) {
        p.shields -= 1;
        continue;
      }
      p.frozenUntil = now + 900;
      const track = CONFIG.game.startLineY - CONFIG.game.finishLineY;
      p.y = Math.min(CONFIG.game.startLineY, p.y + track * push);
      this.uiManager.floatingText("🧊", p.x, p.y - 22, "danger");
    }
    this.activeIceBreath.pulsesDone += 1;
    this.activeIceBreath.nextTickAt = now + CONFIG.game.iceBreath.tickMs;
  }

  #eliminateFlashViolators(now) {
    for (const mover of this.players.getFlashViolators()) {
      const eliminated = this.players.eliminatePlayer(mover.id, now);
      if (eliminated?.blockedByShield && eliminated.shieldConsumed) {
        this.uiManager.announce(`🛡️ ${mover.username} resistió el escaneo`, "ok");
      } else if (eliminated?.player) {
        this.sounds.playElimination();
        this.uiManager.announce(`${eliminated.player.username} eliminado por moverse en parpadeo`, "danger");
      }
    }
  }

  #activateMissileStrike(actor) {
    const now = performance.now();
    const launcher = this.players.getAliveByUsername(actor);
    const launchFrom = launcher
      ? { x: launcher.x, y: launcher.y - 22 }
      : { x: this.canvas.width * 0.5, y: CONFIG.game.startLineY - 20 };
    const target = { x: this.canvas.width / 2 + 52, y: 252 };
    this.effect = {
      type: "missile",
      actor,
      durationMs: 15000,
      endsAt: now + 15000,
    };
    this.missileStrike = {
      startedAt: now,
      launchFrom,
      target,
      phase: "flight",
      impactAt: now + 4000,
      impactHandled: false,
      explosion: this.#createExplosionBursts(target),
      parts: this.#createDollParts(target),
      fireTrail: [],
    };
    this.uiManager.announce(`🚀 ${actor} lanzó misil a la muñeca`, "danger");
  }

  #triggerCommandWithRoleLimits(commandKey, username, activate) {
    if (!username) return;
    if (!this.#isAdminUser(username)) {
      const remainingMs = this.#remainingCooldownMs(username, commandKey);
      if (remainingMs > 0) {
        this.uiManager.announce(`⏱️ ${username}, espera ${this.#formatCooldown(remainingMs)} para volver a usar ${this.#commandLabel(commandKey)}`, "neutral");
        return;
      }
      this.#setCooldown(username, commandKey);
    }
    activate();
  }

  #isAdminUser(username) {
    return this.adminUsers.has((username ?? "").toLowerCase());
  }

  #cooldownEntryKey(username, commandKey) {
    return `${(username ?? "").toLowerCase()}::${commandKey}`;
  }

  #setCooldown(username, commandKey) {
    this.commandCooldowns.set(this.#cooldownEntryKey(username, commandKey), Date.now() + NON_ADMIN_ACTION_COOLDOWN_MS);
  }

  #remainingCooldownMs(username, commandKey) {
    const endsAt = this.commandCooldowns.get(this.#cooldownEntryKey(username, commandKey));
    if (!endsAt) return 0;
    return Math.max(0, endsAt - Date.now());
  }

  #resetCommandCooldown(username) {
    if (!username) return;
    for (const commandKey of Object.values(COMMAND_KEY)) {
      this.commandCooldowns.delete(this.#cooldownEntryKey(username, commandKey));
    }
  }

  #commandLabel(commandKey) {
    if (commandKey === COMMAND_KEY.DANCE) return "baile";
    if (commandKey === COMMAND_KEY.MISSILE) return "misil";
    return "acción";
  }

  #formatCooldown(remainingMs) {
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  #updateMissileStrike(now) {
    if (!this.missileStrike || !this.effect) return;
    const elapsed = now - this.missileStrike.startedAt;
    if (!this.missileStrike.impactHandled && now >= this.missileStrike.impactAt) {
      this.missileStrike.impactHandled = true;
      this.#interruptDollThreat(now);
    }
    this.missileStrike.phase = elapsed < 4000 ? "flight" : elapsed < 9000 ? "recovery" : elapsed < 13000 ? "push" : "return";
    if (this.missileStrike.phase === "recovery") {
      this.#updateMissilePartsPhysics(now);
    }
  }

  #isDangerSuppressed() {
    return this.effect?.type === "dance" || this.effect?.type === "freeze";
  }

  #isScanActive() {
    if (this.#isDangerSuppressed()) return false;
    return this.doll.isScanning();
  }

  #interruptDollThreat(now) {
    this.doll.forceSafe(now);
    this.aggressiveScan = false;
    this.aggressiveProgress = 0;
    this.dangerSinceAt = 0;
    this.dangerGraceEndsAt = 0;
    this.uiManager.setDangerMode(false);
    this.players.clearDangerMovementFlags();
  }

  #createClouds(amount) {
    return Array.from({ length: amount }, () => ({
      x: this.#randomBetween(0, this.canvas.width),
      y: this.#randomBetween(18, 210),
      width: this.#randomBetween(74, 148),
      speed: this.#randomBetween(0.22, 0.52),
      alpha: this.#randomBetween(0.34, 0.78),
    }));
  }

  #drawClouds(ctx, now) {
    for (const cloud of this.clouds) {
      cloud.x -= cloud.speed;
      if (cloud.x < -cloud.width - 40) {
        cloud.x = this.canvas.width + this.#randomBetween(20, 120);
        cloud.y = this.#randomBetween(22, 210);
      }
      const wobble = Math.sin((now + cloud.x * 8) * 0.0018) * 4;
      ctx.save();
      ctx.globalAlpha = cloud.alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(cloud.x, cloud.y + wobble, cloud.width * 0.26, cloud.width * 0.18, 0, 0, Math.PI * 2);
      ctx.ellipse(cloud.x + cloud.width * 0.18, cloud.y - 6 + wobble, cloud.width * 0.22, cloud.width * 0.16, 0, 0, Math.PI * 2);
      ctx.ellipse(cloud.x - cloud.width * 0.2, cloud.y - 5 + wobble, cloud.width * 0.2, cloud.width * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  #drawDoll(ctx, now) {
    if (this.missileStrike?.phase === "recovery") {
      this.#drawMissileDollParts(ctx, now);
      return;
    }
    if (this.missileStrike?.phase === "push" || this.missileStrike?.phase === "return") {
      this.#drawReplacementDoll(ctx, now);
      return;
    }
    const { x, y, bob, headRotation, frontVisible, armSwing, legSwing, torsoLean } = this.dollPose ?? this.#computeDollPose(now);
    const backVisible = 1 - frontVisible;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(torsoLean);

    ctx.fillStyle = "#f6d9ba";
    ctx.fillRect(-22, -46, 44, 21);

    ctx.fillStyle = "#f27f20";
    ctx.beginPath();
    ctx.moveTo(-43, -26);
    ctx.lineTo(43, -26);
    ctx.lineTo(62, 86);
    ctx.lineTo(-62, 86);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#cf5f10";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "rgba(157, 66, 12, 0.6)";
    ctx.lineWidth = 2.2;
    for (const pleatX of [-23, -8, 8, 23]) {
      ctx.beginPath();
      ctx.moveTo(pleatX, -18);
      ctx.lineTo(pleatX + 5, 79);
      ctx.stroke();
    }

    ctx.fillStyle = "#f6dc5c";
    ctx.fillRect(-36, -28, 72, 20);
    ctx.fillStyle = "#efe0b5";
    ctx.fillRect(-15, -52, 30, 7);

    ctx.fillStyle = "#f6d9ba";
    ctx.save();
    ctx.translate(-52, -12);
    ctx.rotate(-0.22 + armSwing * 0.9);
    ctx.fillRect(-6, 0, 13, 54);
    ctx.restore();
    ctx.save();
    ctx.translate(52, -12);
    ctx.rotate(0.22 - armSwing * 0.9);
    ctx.fillRect(-6, 0, 13, 54);
    ctx.restore();
    ctx.save();
    ctx.translate(-24, 84);
    ctx.rotate(-0.08 + legSwing * 0.5);
    ctx.fillRect(-9, 0, 18, 70);
    ctx.restore();
    ctx.save();
    ctx.translate(24, 84);
    ctx.rotate(0.08 - legSwing * 0.5);
    ctx.fillRect(-9, 0, 18, 70);
    ctx.restore();

    ctx.save();
    ctx.translate(0, -62);
    ctx.rotate(headRotation);

    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(0, -1, 31, 0, Math.PI * 2);
    ctx.fill();

    const drawPigtail = (side) => {
      const sx = side * 30;
      ctx.fillStyle = "#0f0f0f";
      ctx.beginPath();
      ctx.ellipse(sx, -7, 14, 18, side * 0.42, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#2f2f2f";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(sx, -7, 9, 12, side * 0.42, 0, Math.PI * 2);
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

    const iceBreathOn = this.effect?.type === "iceBreath" && frontVisible > 0.35;
    const firingLaser = this.#isScanActive() && !iceBreathOn && frontVisible > 0.35;
    ctx.fillStyle = firingLaser ? "#ffd1d1" : "#fff";
    ctx.beginPath();
    ctx.arc(-8, -2, 5.3, 0, Math.PI * 2);
    ctx.arc(8, -2, 5.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = firingLaser ? "#8b0000" : iceBreathOn ? "#1e90ff" : "#111";
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
    if (iceBreathOn) {
      const pulse = 0.7 + Math.sin(now * 0.04) * 0.2;
      ctx.strokeStyle = `rgba(120,210,255,${0.45 + pulse * 0.35})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.quadraticCurveTo(0, 22, 0, 42);
      ctx.stroke();
    }

    const dancing = this.effect?.type === "dance";
    ctx.strokeStyle = "#8f5a4b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (dancing) {
      ctx.moveTo(-9, 8);
      ctx.quadraticCurveTo(0, 17, 9, 8);
    } else {
      ctx.moveTo(-6, 10);
      ctx.quadraticCurveTo(0, 13, 6, 10);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
    ctx.restore();
  }

  #drawVisionCone(ctx, now) {
    const cone = this.vision.getCone();
    const iceMode = this.effect?.type === "iceBreath";

    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const glow = ctx.createRadialGradient(cone.origin.x, cone.origin.y, 36, cone.origin.x, cone.origin.y, cone.radius);
    glow.addColorStop(0, iceMode ? "rgba(90,180,255,0.45)" : this.aggressiveScan ? "rgba(255,50,50,0.5)" : "rgba(255,60,60,0.34)");
    glow.addColorStop(1, iceMode ? "rgba(90,180,255,0.04)" : "rgba(255,60,60,0.02)");

    ctx.beginPath();
    ctx.moveTo(cone.origin.x, cone.origin.y);
    ctx.lineTo(cone.p1.x, cone.p1.y);
    ctx.lineTo(cone.p2.x, cone.p2.y);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.strokeStyle = iceMode ? "rgba(170,225,255,0.95)" : this.aggressiveScan ? "rgba(255,176,176,0.95)" : "rgba(255,128,128,0.8)";
    ctx.lineWidth = this.aggressiveScan ? 3 : 2;
    ctx.stroke();

    if (!this.dollPose) return;
    const pulse = 0.82 + Math.sin(now * 0.06) * 0.18;
    const centerLength = cone.radius * 0.96;
    const edgeLength = cone.radius * 0.9;

    for (const eye of [this.dollPose.leftEye, this.dollPose.rightEye]) {
      const cx = eye.x + Math.cos(cone.direction) * centerLength;
      const cy = eye.y + Math.sin(cone.direction) * centerLength;
      ctx.strokeStyle = iceMode ? `rgba(110,210,255,${0.6 + pulse * 0.24})` : `rgba(255,40,40,${0.65 + pulse * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      for (const edgeAngle of [cone.leftAngle, cone.rightAngle]) {
        const ex = eye.x + Math.cos(edgeAngle) * edgeLength;
        const ey = eye.y + Math.sin(edgeAngle) * edgeLength;
        ctx.strokeStyle = iceMode ? `rgba(165,230,255,${0.3 + pulse * 0.2})` : `rgba(255,100,100,${0.25 + pulse * 0.2})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(eye.x, eye.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
  }

  #computeDollPose(now) {
    const dance = this.#getDanceFormation(now);
    const x = dance?.doll.x ?? this.canvas.width / 2;
    const y = dance?.doll.y ?? 264;
    const dancing = this.effect?.type === "dance";
    const bob = dancing ? Math.sin(now * 0.018) * 8 : this.doll.state === "safe" ? Math.sin(now * 0.006) * 1.4 : 0;
    const turnP = this.doll.turnProgress(now);
    const scanning = this.#isScanActive();
    const scanHeadRotation = this.vision.getDirection() - Math.PI / 2;
    const headRotation = dancing
      ? 0
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
      armSwing: dance?.doll.armSwing ?? (dancing ? Math.sin(now * 0.016) : 0),
      legSwing: dance?.doll.legSwing ?? (dancing ? Math.sin(now * 0.013 + 1.2) : 0),
      torsoLean: dance?.doll.torsoLean ?? (dancing ? Math.sin(now * 0.01) * 0.14 : 0),
      leftEye,
      rightEye,
      eyeCenter,
    };
  }

  #getDanceFormation(now) {
    if (this.effect?.type !== "dance") return null;
    const danceState = this.#getDanceState(now);
    const progress = danceState.introProgress;
    const returnProgress = danceState.returnProgress;
    const swingScale = 1 - returnProgress;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height * 0.53;
    const ease = 1 - Math.pow(1 - progress, 3);
    const beat = now * 0.014;
    const groupWaveX = Math.sin(beat * 0.9) * 24 * swingScale;
    const groupWaveY = Math.cos(beat * 0.7) * 10 * swingScale;
    const lerp = (from, to, alpha) => from + (to - from) * alpha;

    const dollStart = { x: this.canvas.width / 2, y: 264 };
    const movedDollX = lerp(dollStart.x, centerX + groupWaveX, ease);
    const movedDollY = lerp(dollStart.y, centerY - 34 + groupWaveY, ease);
    const doll = {
      x: lerp(movedDollX, dollStart.x, returnProgress),
      y: lerp(movedDollY + Math.sin(beat * 2.6) * 14 * swingScale, dollStart.y, returnProgress),
      armSwing: Math.sin(beat * 2.4) * 1.35 * swingScale,
      legSwing: Math.cos(beat * 2.1) * 1.1 * swingScale,
      torsoLean: Math.sin(beat * 1.45) * 0.28 * swingScale,
    };

    const guardsById = new Map();
    for (const [index, guard] of GUARDS.entries()) {
      const angle = -Math.PI / 2 + index * (Math.PI / 2);
      const radiusX = 84;
      const radiusY = 56;
      const targetX = centerX + groupWaveX + Math.cos(angle) * radiusX;
      const targetY = centerY + groupWaveY + Math.sin(angle) * radiusY;
      const phase = beat + index * 1.2;
      const movedX = lerp(guard.x, targetX, ease);
      const movedY = lerp(guard.y, targetY, ease);
      guardsById.set(guard.id, {
        x: lerp(movedX + Math.sin(phase * 2.2) * 8 * swingScale, guard.x, returnProgress),
        y: lerp(movedY + Math.cos(phase * 1.9) * 9 * swingScale, guard.y, returnProgress),
        torsoLean: Math.sin(phase * 1.5) * 0.34 * swingScale,
        armSwing: Math.sin(phase * 2.8) * 1.25 * swingScale,
        legSwing: Math.cos(phase * 2.4) * 1.1 * swingScale,
      });
    }
    return { doll, guardsById };
  }

  #getDanceState(now) {
    if (this.effect?.type !== "dance") {
      return {
        active: false,
        introProgress: 0,
        returnProgress: 0,
        colorMix: 0,
      };
    }
    const duration = this.effect.durationMs ?? 25000;
    const startedAt = this.effect.endsAt - duration;
    const elapsed = Math.max(0, now - startedAt);
    const introProgress = Math.min(1, elapsed / 2800);
    const returnWindowMs = 5000;
    const returnProgress = Math.min(1, Math.max(0, (now - (this.effect.endsAt - returnWindowMs)) / returnWindowMs));
    const colorMix = 1 - returnProgress;
    return {
      active: true,
      introProgress,
      returnProgress,
      colorMix,
    };
  }

  #drawPlayers(ctx, now) {
    for (const p of this.players.getAll()) {
      const walkBounce = p.bounce > 0 ? Math.sin(now * 0.03) * 4 * p.bounce : 0;
      const highlighted = this.#isScanActive() && this.vision.isPointInside({ x: p.x, y: p.y }) && p.state === "alive";
      const frozen = p.frozenUntil > now;
      const shieldBlinking = p.shieldBlinkUntil > now;

      ctx.save();
      ctx.translate(p.x, p.y + walkBounce);
      ctx.scale(0.88, 0.88);
      if (shieldBlinking && Math.floor(now / 130) % 2 === 0) {
        ctx.globalAlpha = 0.35;
      }

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

      const suitColor = p.state === "eliminated" ? "#ff3b3b" : p.flashViolation ? "#ff5f5f" : frozen ? CONFIG.player.iceTint : "#0e8f64";
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

      ctx.font = "bold 15px sans-serif";
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
      if (shieldBlinking && p.state === "alive") {
        ctx.fillStyle = "#d9f6ff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(`✨ ${Math.ceil((p.shieldBlinkUntil - now) / 1000)}s`, p.x, p.y - 55);
      }
      if (frozen && p.state === "alive") {
        ctx.fillStyle = "#bdefff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(`🧊 ${Math.ceil((p.frozenUntil - now) / 1000)}s`, p.x, p.y - (shieldBlinking ? 68 : 55));
      }
    }
  }

  #drawMissileSequence(ctx, now) {
    if (!this.missileStrike || this.effect?.type !== "missile") return;
    const elapsed = now - this.missileStrike.startedAt;
    const countdown = Math.max(0, Math.ceil((this.effect.endsAt - now) / 1000));

    ctx.save();
    ctx.fillStyle = "rgba(15,20,30,0.55)";
    ctx.fillRect(170, 8, 200, 34);
    ctx.fillStyle = "#ffecb3";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`MISIL ${countdown}s`, this.canvas.width / 2, 31);
    ctx.restore();

    if (elapsed < 4000) {
      const p = elapsed / 4000;
      const x = this.missileStrike.launchFrom.x + (this.missileStrike.target.x - this.missileStrike.launchFrom.x) * p;
      const y = this.missileStrike.launchFrom.y + (this.missileStrike.target.y - this.missileStrike.launchFrom.y) * p - Math.sin(p * Math.PI) * 60;
      const nextP = Math.min(1, p + 0.02);
      const nx = this.missileStrike.launchFrom.x + (this.missileStrike.target.x - this.missileStrike.launchFrom.x) * nextP;
      const ny =
        this.missileStrike.launchFrom.y +
        (this.missileStrike.target.y - this.missileStrike.launchFrom.y) * nextP -
        Math.sin(nextP * Math.PI) * 60;
      const angle = Math.atan2(ny - y, nx - x);
      this.missileStrike.fireTrail.push({ x: x - Math.cos(angle) * 16, y: y - Math.sin(angle) * 16, life: 1 });
      if (this.missileStrike.fireTrail.length > 48) this.missileStrike.fireTrail.shift();
      ctx.save();
      for (const flame of this.missileStrike.fireTrail) {
        flame.life *= 0.93;
        if (flame.life < 0.04) continue;
        ctx.fillStyle = `rgba(255, ${140 + Math.floor(Math.random() * 80)}, 40, ${flame.life})`;
        ctx.beginPath();
        ctx.arc(flame.x, flame.y, 3 + flame.life * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = "#d7d7d7";
      ctx.fillRect(-14, -4, 28, 8);
      ctx.fillStyle = "#8ea0b8";
      ctx.fillRect(-12, -2, 9, 4);
      ctx.fillStyle = "#ff7a3a";
      ctx.beginPath();
      ctx.moveTo(14, -4);
      ctx.lineTo(24, 0);
      ctx.lineTo(14, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(-14, -3);
      ctx.lineTo(-24 - Math.random() * 8, 0);
      ctx.lineTo(-14, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      const explosion = Math.min(1, (elapsed - 4000) / 900);
      const radius = 24 + explosion * 48;
      ctx.save();
      ctx.fillStyle = `rgba(255,120,40,${0.65 - explosion * 0.45})`;
      ctx.beginPath();
      ctx.arc(this.canvas.width / 2, 192, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  #createDollParts(target) {
    return [
      { type: "head", x: target.x, y: target.y - 56, vx: -2.2, vy: -10.5, rot: 0, vr: -0.05 },
      { type: "hairL", x: target.x - 28, y: target.y - 64, vx: -4.4, vy: -8.2, rot: 0, vr: -0.1 },
      { type: "hairR", x: target.x + 28, y: target.y - 64, vx: 4.4, vy: -8.2, rot: 0, vr: 0.1 },
      { type: "torso", x: target.x, y: target.y - 2, vx: 0.1, vy: -7.6, rot: 0, vr: 0.02 },
      { type: "belt", x: target.x, y: target.y - 28, vx: 0.8, vy: -8.8, rot: 0, vr: 0.08 },
      { type: "armL", x: target.x - 50, y: target.y - 12, vx: -3.2, vy: -6.1, rot: -0.2, vr: -0.16 },
      { type: "armR", x: target.x + 50, y: target.y - 12, vx: 3.2, vy: -6.1, rot: 0.2, vr: 0.16 },
      { type: "legL", x: target.x - 24, y: target.y + 84, vx: -2.8, vy: -4.8, rot: -0.1, vr: -0.08 },
      { type: "legR", x: target.x + 24, y: target.y + 84, vx: 2.8, vy: -4.8, rot: 0.1, vr: 0.08 },
    ];
  }

  #createExplosionBursts(target) {
    return Array.from({ length: 10 }, (_, i) => ({
      x: target.x,
      y: target.y - 10,
      vx: Math.cos((i / 10) * Math.PI * 2) * (2.5 + Math.random() * 2.8),
      vy: -5.2 + Math.random() * -4.8,
      life: 1,
      size: 7 + Math.random() * 12,
    }));
  }

  #updateMissilePartsPhysics() {
    if (!this.missileStrike) return;
    const floorY = CONFIG.game.finishLineY + 36;
    for (const part of this.missileStrike.parts) {
      if (part.atRest) continue;
      part.vy += 0.58;
      part.vx *= 0.992;
      part.x += part.vx;
      part.y += part.vy;
      part.rot += part.vr;
      if (part.y >= floorY) {
        part.y = floorY;
        part.vy *= -0.28;
        part.vx *= 0.82;
        part.vr *= 0.76;
        if (Math.abs(part.vy) < 0.8) {
          part.vy = 0;
          part.vx *= 0.5;
          if (Math.abs(part.vx) < 0.1) part.atRest = true;
        }
      }
    }
  }

  #drawMissileDollParts(ctx, now) {
    const elapsed = now - this.missileStrike.startedAt;
    const impactP = Math.min(1, Math.max(0, (elapsed - 4000) / 1200));
    const cleanupP = Math.min(1, Math.max(0, (elapsed - 5000) / 5500));
    const carryP = Math.min(1, Math.max(0, (cleanupP - 0.36) / 0.64));

    ctx.save();
    for (const burst of this.missileStrike.explosion) {
      burst.vy += 0.36;
      burst.x += burst.vx;
      burst.y += burst.vy;
      burst.life *= 0.94;
      if (burst.life <= 0.02) continue;
      ctx.fillStyle = `rgba(255, ${120 + Math.floor(Math.random() * 90)}, 45, ${burst.life})`;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, burst.size * burst.life, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const [index, part] of this.missileStrike.parts.entries()) {
      const pickupX = this.canvas.width + 80;
      const pickupY = CONFIG.game.finishLineY + 24 + (index % 4) * 10;
      const x = part.x + (pickupX - part.x) * carryP;
      const y = part.y + (pickupY - part.y) * carryP;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(part.rot + carryP * 0.2);
      this.#drawDollPiece(ctx, part.type);
      ctx.restore();
    }
    ctx.restore();

    if (impactP < 1) {
      const flashAlpha = 0.8 - impactP * 0.8;
      ctx.save();
      ctx.fillStyle = `rgba(255,240,190,${flashAlpha})`;
      ctx.beginPath();
      ctx.arc(this.canvas.width / 2, 192, 30 + impactP * 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  #drawReplacementDoll(ctx, now) {
    const elapsed = now - this.missileStrike.startedAt;
    const pushP = Math.min(1, Math.max(0, (elapsed - 9000) / 4000));
    const returnP = Math.min(1, Math.max(0, (elapsed - 13000) / 2000));
    const carrier = this.#getCarrierPose(pushP);
    const x = carrier.dollX;
    const y = carrier.dollY;
    const bounce = Math.sin(pushP * Math.PI * 2.4) * 2.5 * (1 - returnP);

    ctx.save();
    ctx.translate(x, y + bounce);
    this.#paintDollSilhouette(ctx);
    ctx.restore();
  }

  #getCarrierPose(progress) {
    const startX = this.canvas.width + 84;
    const endX = this.canvas.width / 2;
    return {
      dollX: startX + (endX - startX) * progress,
      dollY: 264,
    };
  }

  #paintDollSilhouette(ctx) {
    this.#drawDollPiece(ctx, "torso");
    this.#drawDollPiece(ctx, "belt");
    ctx.save();
    ctx.translate(-52, -12);
    this.#drawDollPiece(ctx, "armL");
    ctx.restore();
    ctx.save();
    ctx.translate(52, -12);
    this.#drawDollPiece(ctx, "armR");
    ctx.restore();
    ctx.save();
    ctx.translate(-24, 84);
    this.#drawDollPiece(ctx, "legL");
    ctx.restore();
    ctx.save();
    ctx.translate(24, 84);
    this.#drawDollPiece(ctx, "legR");
    ctx.restore();
    ctx.save();
    ctx.translate(0, -62);
    this.#drawDollPiece(ctx, "head");
    this.#drawDollPiece(ctx, "hairL");
    this.#drawDollPiece(ctx, "hairR");
    ctx.restore();
  }

  #drawDollPiece(ctx, partType) {
    if (partType === "head") {
      ctx.fillStyle = "#2d1f1a";
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f6d9ba";
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-8, -2, 4.7, 0, Math.PI * 2);
      ctx.arc(8, -2, 4.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(-8, -2, 2.4, 0, Math.PI * 2);
      ctx.arc(8, -2, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8f5a4b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.quadraticCurveTo(0, 13, 6, 10);
      ctx.stroke();
      return;
    }
    if (partType === "hairL" || partType === "hairR") {
      const side = partType === "hairL" ? -1 : 1;
      ctx.fillStyle = "#161616";
      ctx.beginPath();
      ctx.ellipse(side * 28, -6, 12, 16, side * 0.42, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (partType === "torso") {
      ctx.fillStyle = "#f29339";
      ctx.beginPath();
      ctx.moveTo(-44, -26);
      ctx.lineTo(44, -26);
      ctx.lineTo(62, 84);
      ctx.lineTo(-62, 84);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (partType === "belt") {
      ctx.fillStyle = "#f2cc41";
      ctx.fillRect(-35, -27, 70, 18);
      return;
    }
    ctx.fillStyle = "#f6d9ba";
    if (partType === "armL" || partType === "armR") {
      ctx.fillRect(-6, 0, 13, 54);
    } else if (partType === "legL" || partType === "legR") {
      ctx.fillRect(-9, 0, 18, 70);
    }
  }
}
