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
  rankingItems: [...document.querySelectorAll("#ranking-list li")],
  spawnBtn: document.getElementById("spawn-btn"),
  tapBtn: document.getElementById("tap-btn"),
  autoTapBtn: document.getElementById("auto-tap-btn"),
  flash: document.getElementById("flash-overlay"),
};

const game = new GameController(canvas, ui);
game.start();
