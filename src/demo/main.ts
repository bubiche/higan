import { createGL } from "../render/gl";
import { createBulletRenderer, type Overlay } from "../render/bullets";
import { createLaserRenderer } from "../render/lasers";
import { createSimulation, PATTERN_TICKS } from "../core/sim";
import { createSimDriver } from "../core/runtime";
import { assertDeterministic } from "../core/determinism";
import { PLAYFIELD_W, PLAYFIELD_H, DT } from "../core/playfield";
import { Shape } from "../api";
import { createKeyboardInput } from "./keyboard";
import { SHOWCASE } from "./patterns/showcase";
import type { ScenePattern } from "../api";
import type { InputFrame } from "../core/input";

const CSS_SCALE = 1.6;
const SEED = 0x1a9e;

const canvas = document.getElementById("playfield") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const gl = createGL(canvas);

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${PLAYFIELD_W * CSS_SCALE}px`;
  canvas.style.height = `${PLAYFIELD_H * CSS_SCALE}px`;
  // Bullets are sized in sim units and projected through the GL viewport, so DPR
  // is handled entirely here — no per-instance pixel scaling.
  canvas.width = Math.round(PLAYFIELD_W * CSS_SCALE * dpr);
  canvas.height = Math.round(PLAYFIELD_H * CSS_SCALE * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
window.addEventListener("resize", resize);

// The showcase patterns the scene cycles through. A reassignable binding so a
// hot-reload can swap in edited pattern code (see the HMR hook below).
let patterns: readonly ScenePattern[] = SHOWCASE;

// The determinism run must span at least one full pattern cycle, or aimed/home
// (the trig-and-target-dependent behaviours) never get exercised by the guard.
// Sized to the cycle length plus headroom for a couple of added patterns.
const scripted: InputFrame[] = [];
const scriptedTicks = PATTERN_TICKS * (patterns.length + 2);
for (let i = 0; i < scriptedTicks; i++) {
  scripted.push({
    dx: ((i >> 4) % 3) - 1,
    dy: ((i >> 5) % 3) - 1,
    shoot: (i & 8) !== 0,
    focus: i % 120 < 30,
    bomb: false,
  });
}

// Continuous determinism guard: same seed + scripted input + patterns, twice,
// must hash identically. Runs on every (re)load so any nondeterminism regression
// trips immediately (Hard Rule 2).
const det = assertDeterministic(SEED, scripted, DT, patterns);
console.info(
  `[higan] determinism OK — hash 0x${det.hashA.toString(16).padStart(8, "0")} over ${det.ticks} ticks`,
);

// Sim is recreated on backward-scrub / hot-reload, so it's a reassignable binding
// the driver callbacks close over.
let sim = createSimulation(SEED, DT, patterns);
const keyboard = createKeyboardInput();
const renderer = createBulletRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, sim.system.capacity);
const laserRenderer = createLaserRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, sim.lasers.lasers.length);

const playerMarker: Overlay = {
  x: 0,
  y: 0,
  radius: 7,
  color: [0.85, 0.95, 1.0],
  sprite: Shape.BigOrb,
};

function render(): void {
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const { system } = sim;
  playerMarker.x = sim.playerX;
  playerMarker.y = sim.playerY;
  // Beams first (behind the bullet glow); both draw additively.
  const beams = laserRenderer.draw(sim.lasers.lasers);
  const drawn = renderer.draw(system.store, system.alive, system.highWater, playerMarker);

  hud.textContent =
    `tick    ${driver.tick}\n` +
    `pattern ${sim.patternName}\n` +
    `bullets ${system.liveCount}\n` +
    `beams   ${beams}\n` +
    `drawn   ${drawn}\n` +
    `hash    0x${sim.hash().toString(16).padStart(8, "0")}\n` +
    `speed   ${driver.speed}x${driver.paused ? "   ❚❚ PAUSED" : ""}`;
}

const driver = createSimDriver({
  dt: DT,
  sampleInput: (tick) => keyboard.sample(tick),
  step: (input) => sim.step(input),
  rebuild: () => {
    sim = createSimulation(SEED, DT, patterns);
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

// Hot-reload: when the pattern module is edited, swap in the new code, re-check
// determinism against it (the purity invariant's edit-time tripwire), then
// rebuild + replay to the current tick so the scene continues with the new code.
if (import.meta.hot) {
  import.meta.hot.accept("./patterns/showcase", (mod) => {
    if (!mod) return;
    patterns = (mod as unknown as { SHOWCASE: readonly ScenePattern[] }).SHOWCASE;
    assertDeterministic(SEED, scripted, DT, patterns);
    driver.resync();
    console.info("[higan] patterns hot-reloaded");
  });
}
