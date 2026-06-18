import { createGL } from "../render/gl";
import { createSimulation } from "../core/sim";
import { createSimDriver } from "../core/runtime";
import { assertDeterministic } from "../core/determinism";
import { PLAYFIELD_W, PLAYFIELD_H, DT } from "../core/playfield";
import { createKeyboardInput } from "./keyboard";
import { createPointRenderer } from "./render";
import type { InputFrame } from "../core/input";

const CSS_SCALE = 1.6;
const SEED = 0x1a9e;

const canvas = document.getElementById("playfield") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const gl = createGL(canvas);

// Device pixels per sim unit; kept current by resize() and used to size points.
let pxScale = CSS_SCALE;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pxScale = CSS_SCALE * dpr;
  canvas.style.width = `${PLAYFIELD_W * CSS_SCALE}px`;
  canvas.style.height = `${PLAYFIELD_H * CSS_SCALE}px`;
  canvas.width = Math.round(PLAYFIELD_W * pxScale);
  canvas.height = Math.round(PLAYFIELD_H * pxScale);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
window.addEventListener("resize", resize);

// Continuous determinism guard: same seed + scripted input, twice, must hash
// identically. Runs on every (re)load so any nondeterminism regression trips
// immediately (Hard Rule 2).
const scripted: InputFrame[] = [];
for (let i = 0; i < 600; i++) {
  scripted.push({
    dx: ((i >> 4) % 3) - 1,
    dy: ((i >> 5) % 3) - 1,
    shoot: (i & 8) !== 0,
    focus: i % 120 < 30,
    bomb: false,
  });
}
const det = assertDeterministic(SEED, scripted, DT);
console.info(
  `[higan] determinism OK — hash 0x${det.hashA.toString(16).padStart(8, "0")} over ${det.ticks} ticks`,
);

// Sim is recreated on backward-scrub, so it's a reassignable binding the driver
// callbacks close over.
let sim = createSimulation(SEED, DT);
const keyboard = createKeyboardInput();
const capacity = sim.moteCount + 1; // motes + player
const points = createPointRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, capacity);
const instance = new Float32Array(capacity * 6);

function render(): void {
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const { store, moteCount } = sim;
  let o = 0;
  for (let i = 0; i < moteCount; i++) {
    instance[o++] = store.x[i];
    instance[o++] = store.y[i];
    instance[o++] = store.r[i];
    instance[o++] = store.g[i];
    instance[o++] = store.b[i];
    instance[o++] = store.radius[i] * 2 * pxScale;
  }
  instance[o++] = sim.playerX;
  instance[o++] = sim.playerY;
  instance[o++] = 1.0;
  instance[o++] = 1.0;
  instance[o++] = 1.0;
  instance[o++] = sim.playerRadius * 2 * pxScale;

  points.draw(instance, capacity);

  hud.textContent =
    `tick  ${driver.tick}\n` +
    `hash  0x${sim.hash().toString(16).padStart(8, "0")}\n` +
    `speed ${driver.speed}x${driver.paused ? "   ❚❚ PAUSED" : ""}`;
}

const driver = createSimDriver({
  dt: DT,
  sampleInput: (tick) => keyboard.sample(tick),
  step: (input) => sim.step(input),
  rebuild: () => {
    sim = createSimulation(SEED, DT);
  },
  render,
});

// Debugger controls drive the loop, NOT the simulation — they are deliberately
// kept out of the input record so they can never poison a replay.
window.addEventListener("keydown", (e) => {
  switch (e.code) {
    case "Space":
      e.preventDefault();
      driver.togglePause();
      break;
    case "Period":
      driver.singleStep();
      break;
    case "Comma":
      driver.stepBack();
      break;
    case "Digit1":
      driver.setSpeed(0.25);
      break;
    case "Digit2":
      driver.setSpeed(0.5);
      break;
    case "Digit3":
      driver.setSpeed(1);
      break;
  }
});
