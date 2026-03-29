import { CONFIG } from "./config.js";
import { PlayerManager } from "./PlayerManager.js";
import { DollAI } from "./DollAI.js";
import { RankingSystem } from "./RankingSystem.js";
import { SoundSystem } from "./SoundSystem.js";
import { EventBridge } from "./EventBridge.js";

const USER_POOL = [
  "NinjaFox",
  "LunaTap",
  "PixelRosa",
  "NeoKoi",
  "MayaRush",
  "TicoLive",
  "RexArcade",
  "YukiStar",
  "Gio99",
  "CataPlay",
];

export class GameController {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;

    this.players = new PlayerManager();
    this.doll = new DollAI();
    this.ranking = new RankingSystem();
    this.sounds = new SoundSystem();

    this.roundStartAt = performance.now();
    this.roundDurationMs = CONFIG.game.roundSeconds * 1000;
    this.lastFrame = performance.now();
    this.autoTap = false;
    this.autoTapInterval = 160;
    this.nextAutoTapAt = performance.now();

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
    this.doll.start(now);
    requestAnimationFrame((t) => this.#loop(t));
  }

  spawnPlayer(username) {
    this.sounds.enable();
    this.players.addPlayer(username);
    this.#syncHud();
  }

  handleTap(username) {
    this.sounds.enable();
    const now = performance.now();
    const isDanger = this.doll.isDanger();

    if (username) {
      const candidate = this.players.getAll().find((p) => p.username === username);
      if (candidate) {
        this.players.applyTap(candidate.id, now, isDanger);
        this.sounds.tap();
      }
      return;
    }

    this.players.applyGlobalTap(now, isDanger);
    this.sounds.tap();
  }

  #wireUI() {
    this.ui.spawnBtn.addEventListener("click", () => {
      const randomName = USER_POOL[Math.floor(Math.random() * USER_POOL.length)] + Math.floor(Math.random() * 90 + 10);
      this.spawnPlayer(randomName);
    });

    this.ui.tapBtn.addEventListener("mousedown", () => this.handleTap());
    this.ui.tapBtn.addEventListener("touchstart", () => this.handleTap(), { passive: true });

    this.ui.autoTapBtn.addEventListener("click", () => {
      this.autoTap = !this.autoTap;
      this.ui.autoTapBtn.textContent = `Auto Tap: ${this.autoTap ? "ON" : "OFF"}`;
    });

    window.addEventListener("keydown", (ev) => {
      if (ev.key.toLowerCase() === "r") {
        const randomName = `view_${Math.floor(Math.random() * 9999)}`;
        this.spawnPlayer(randomName);
      }
      if (ev.code === "Space") {
        ev.preventDefault();
        this.handleTap();
      }
    });
  }

  #loop(now) {
    const stateEvent = this.doll.update(now);
    this.players.cleanupEliminated(now);

    if (stateEvent === "turn") {
      this.sounds.turn();
      this.#triggerFlash();
      this.#shakeScreen();
    }

    if (stateEvent === "danger") {
      const beam = this.doll.getBeamPolygon();
      const movers = this.players.getMoversInDanger();
      for (const mover of movers) {
        if (pointInTriangle({ x: mover.x, y: mover.y }, beam.origin, beam.a, beam.b)) {
          this.players.eliminatePlayer(mover.id, now);
          this.sounds.elimination();
        }
      }
      this.players.clearDangerMovementFlags();
    }

    if (this.autoTap && now >= this.nextAutoTapAt) {
      this.handleTap();
      this.nextAutoTapAt = now + this.autoTapInterval;
    }

    this.#checkGoal();
    this.#checkRoundTimer(now);
    this.#render(now);
    this.#syncHud(now);

    this.lastFrame = now;
    requestAnimationFrame((t) => this.#loop(t));
  }

  #checkGoal() {
    for (const p of this.players.getAll()) {
      if (p.state === "alive" && p.y <= 228) {
        this.ranking.registerWinner(p);
        this.players.markWinner(p.id, this.ranking.winners.length);
        this.sounds.win();
      }
    }
  }

  #checkRoundTimer(now) {
    const elapsed = now - this.roundStartAt;
    if (elapsed < this.roundDurationMs) return;

    this.players.resetRound();
    this.ranking.reset();
    this.roundStartAt = now;
    this.doll.start(now);
  }

  #syncHud(now = performance.now()) {
    const remainMs = Math.max(0, this.roundDurationMs - (now - this.roundStartAt));
    this.ui.timeLeft.textContent = Math.ceil(remainMs / 1000).toString();
    this.ui.aliveCount.textContent = this.players.getAliveCount().toString();

    const stateLabel = this.doll.state === "safe" ? "SAFE" : "DANGER";
    this.ui.gameState.textContent = stateLabel;
    this.ui.gameState.dataset.state = this.doll.state === "safe" ? "safe" : "danger";

    const top3 = this.ranking.top3();
    for (let i = 0; i < 3; i++) {
      const item = this.ui.rankingItems[i];
      item.textContent = top3[i] ? `${medal(i)} ${top3[i].username}` : `${medal(i)} —`;
    }
  }

  #triggerFlash() {
    this.ui.flash.classList.remove("active");
    void this.ui.flash.offsetWidth;
    this.ui.flash.classList.add("active");
  }

  #shakeScreen() {
    this.ui.shell.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 170, iterations: 2 },
    );
  }

  #render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.#drawField(ctx);
    this.#drawDoll(ctx, now);

    if (this.doll.state !== "safe") {
      this.#drawBeam(ctx, this.doll.getBeamPolygon());
    }

    this.#drawPlayers(ctx);
  }

  #drawField(ctx) {
    ctx.fillStyle = "#c79566";
    ctx.fillRect(0, 0, this.canvas.width, 230);
    ctx.fillStyle = "#1e6749";
    ctx.fillRect(0, 230, this.canvas.width, this.canvas.height - 230);

    ctx.fillStyle = "#ff3e45";
    ctx.fillRect(0, 230, this.canvas.width, 6);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    for (let y = 250; y < this.canvas.height; y += 72) {
      ctx.fillRect(20, y, this.canvas.width - 40, 1);
    }
  }

  #drawDoll(ctx, now) {
    const x = this.canvas.width / 2;
    const y = 156;
    const bob = Math.sin(now * 0.008) * 3;

    ctx.save();
    ctx.translate(x, y + bob);

    ctx.fillStyle = "#121212";
    ctx.fillRect(-14, -26, 28, 28);
    ctx.fillStyle = "#f6d6b8";
    ctx.fillRect(-13, -12, 26, 24);
    ctx.fillStyle = "#f78f29";
    ctx.fillRect(-18, 12, 36, 55);

    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("MUÑECA", x, 80);
  }

  #drawBeam(ctx, beam) {
    ctx.fillStyle = this.doll.state === "transition" ? "rgba(255,255,255,0.23)" : "rgba(255,65,65,0.2)";
    ctx.beginPath();
    ctx.moveTo(beam.origin.x, beam.origin.y);
    ctx.lineTo(beam.a.x, beam.a.y);
    ctx.lineTo(beam.b.x, beam.b.y);
    ctx.closePath();
    ctx.fill();
  }

  #drawPlayers(ctx) {
    for (const p of this.players.getLiveAndWinners()) {
      if (p.state === "winner") {
        ctx.fillStyle = "rgba(255, 217, 87, 0.3)";
        ctx.fillRect(p.x - 18, p.y - 18, 36, 36);
      }

      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 9, p.y - 15, 18, 24);
      ctx.fillStyle = p.state === "eliminated" ? "#8a1313" : "#1ce67b";
      ctx.fillRect(p.x - 8, p.y + 8, 16, 10);
      ctx.fillStyle = "#ffe07a";
      ctx.fillRect(p.x - 8, p.y - 21, 16, 6);

      ctx.fillStyle = "#0f0f0f";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.username, p.x, p.y - 28);
    }
  }
}

function medal(index) {
  return ["🥇", "🥈", "🥉"][index] ?? "•";
}

function pointInTriangle(point, a, b, c) {
  const area = 0.5 * (-b.y * c.x + a.y * (-b.x + c.x) + a.x * (b.y - c.y) + b.x * c.y);
  const s = (1 / (2 * area)) * (a.y * c.x - a.x * c.y + (c.y - a.y) * point.x + (a.x - c.x) * point.y);
  const t = (1 / (2 * area)) * (a.x * b.y - a.y * b.x + (a.y - b.y) * point.x + (b.x - a.x) * point.y);

  return s >= 0 && t >= 0 && 1 - s - t >= 0;
}
