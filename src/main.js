import { CONFIG } from "./config.js";
import { GameController } from "./GameController.js";

const canvas = document.getElementById("game-canvas");
canvas.width = CONFIG.canvas.width;
canvas.height = CONFIG.canvas.height;

const ui = {
  shell: document.getElementById("app-shell"),
  timeLeft: document.getElementById("time-left"),
  gameState: document.getElementById("game-state"),
  aliveCount: document.getElementById("alive-count"),
  rankingList: document.getElementById("ranking-list"),
  monthlyList: document.getElementById("monthly-ranking-list"),
  levelLabel: document.getElementById("level-label"),
  giftButtons: document.querySelectorAll(".gift-btn"),
  playBtn: document.getElementById("play-btn"),
  spawnBtn: document.getElementById("spawn-btn"),
  tapBtn: document.getElementById("tap-btn"),
  autoTapBtn: document.getElementById("auto-tap-btn"),
  flash: document.getElementById("flash-overlay"),
  rankingMessage: document.getElementById("ranking-message"),
  alertText: document.getElementById("alert-text"),
  floatLayer: document.getElementById("float-layer"),
};

const game = new GameController(canvas, ui);
game.start();
