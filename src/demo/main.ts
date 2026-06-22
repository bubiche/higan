import { createGL } from "../render/gl";
import { createBulletRenderer, type Overlay } from "../render/bullets";
import { createLaserRenderer } from "../render/lasers";
import { createSimulation, PATTERN_TICKS } from "../core/sim";
import { createSimDriver } from "../core/runtime";
import { assertDeterministic } from "../core/determinism";
import { PLAYFIELD_W, PLAYFIELD_H, DT } from "../core/playfield";
import { Shape } from "../api";
import { createKeyboardInput } from "./keyboard";
import { DEMO_BOSS } from "./patterns/boss";
import { SHOWCASE } from "./patterns/showcase";
import { DEFAULT_PLAYER_CONFIG } from "../touhou/player";
import type { BossScript, ScenePattern } from "../api";
import type { InputFrame } from "../core/input";

const CSS_SCALE = 1.6;
const SEED = 0x1a9e;
// Run rules the demo plays under. The sim accepts this as construction input (like
// seed/dt) — the values feed deterministic state, the object itself is out of the hash.
const RUN_CONFIG = DEFAULT_PLAYER_CONFIG;

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

// The demo scene is the boss (an emitter-of-emitters). A reassignable binding so a
// hot-reload can swap in edited boss code (see the HMR hook below). No pattern
// cycle is used in the boss scene, so `patterns` is empty.
const patterns: readonly ScenePattern[] = [];
let boss: BossScript = DEMO_BOSS;

// The determinism run holds shoot and weaves so it drains HP and spans the boss's
// phases (including the retarget spell) — exercising the multi-emitter scheduler,
// child-spawn, and retarget, which is the new machinery the guard most needs to cover.
const scripted: InputFrame[] = [];
const GUARD_TICKS = 1300;
for (let i = 0; i < GUARD_TICKS; i++) {
  scripted.push({
    dx: (i >> 3) % 2 ? 1 : -1,
    dy: 0,
    shoot: true,
    focus: i % 120 < 30,
    bomb: false,
  });
}

// Continuous determinism guard: same seed + scripted input + boss, twice, must hash
// identically. Runs on every (re)load so any nondeterminism regression trips
// immediately (Hard Rule 2).
const det = assertDeterministic(SEED, scripted, DT, patterns, boss);
console.info(
  `[higan] determinism OK (boss) — hash 0x${det.hashA.toString(16).padStart(8, "0")} over ${det.ticks} ticks`,
);

// The boss exercises linear/accelerate/home/curve/lasers but not wave, delay, or
// ramp's speed-change leg — so a second guard runs the full showcase pattern set
// (not the demo scene, just behavior-vocabulary coverage) to keep those update-loop
// branches under the continuous determinism net. A full cycle + headroom.
const showcaseScript: InputFrame[] = [];
for (let i = 0; i < PATTERN_TICKS * (SHOWCASE.length + 2); i++) {
  showcaseScript.push({
    dx: ((i >> 4) % 3) - 1,
    dy: ((i >> 5) % 3) - 1,
    shoot: (i & 8) !== 0,
    focus: i % 120 < 30,
    bomb: false,
  });
}
assertDeterministic(SEED, showcaseScript, DT, SHOWCASE);

// Sim is recreated on backward-scrub / hot-reload, so it's a reassignable binding
// the driver callbacks close over.
let sim = createSimulation(SEED, DT, patterns, RUN_CONFIG, boss);
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

// The focus hitbox indicator — a small bright dot at the true hitbox radius, shown
// only while focus is held (Touhou convention: focus reveals the pinprick hitbox).
// Cosmetic, out of the sim/hash — it just reads the player state.
const hitboxMarker: Overlay = {
  x: 0,
  y: 0,
  radius: RUN_CONFIG.hitboxRadius,
  color: [1.0, 0.3, 0.3],
  sprite: Shape.Orb,
};

function render(): void {
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const { system, player } = sim;
  playerMarker.x = player.x;
  playerMarker.y = player.y;
  hitboxMarker.x = player.x;
  hitboxMarker.y = player.y;

  // Cosmetic overlays (out of the sim/hash): the player marker, blinked off on
  // alternate windows while invulnerable (the i-frame flash); plus the tiny hitbox
  // dot whenever focus is held.
  const overlays: Overlay[] = [];
  const invulnBlink = player.invulnTicks > 0 && Math.floor(driver.tick / 4) % 2 === 1;
  if (!invulnBlink) overlays.push(playerMarker);
  if (player.focused) overlays.push(hitboxMarker);

  // Beams first (behind the bullet glow); both draw additively.
  const beams = laserRenderer.draw(sim.lasers.lasers);
  const drawn = renderer.draw(system.store, system.alive, system.highWater, overlays);

  const stateLabel = ["alive", "dying", "respawn", "GAME OVER"][player.state];
  // Boss/spell gauges read sim state every frame and keep no counters of their own
  // (the sim is the single source of truth). HP + timer are the gate's "gauges".
  let bossLines = "";
  const boss = sim.boss;
  if (boss) {
    if (boss.defeated) {
      bossLines = `\nboss    ✦ DEFEATED ✦`;
    } else if (boss.active) {
      const pct = boss.hpMax > 0 ? Math.max(0, boss.hp / boss.hpMax) : 0;
      const bars = 18;
      const filled = Math.round(pct * bars);
      const gauge = "#".repeat(filled) + "-".repeat(bars - filled);
      bossLines =
        `\nspell   ${boss.name}${boss.isSpell ? "  ✦" : ""}` +
        `\nhp      [${gauge}] ${Math.ceil(boss.hp)}` +
        `\ntimer   ${(boss.timeLeft / 60).toFixed(1)}s` +
        `\ncapture ${player.spellCapturedNoMiss ? "intact (shoot to capture)" : "missed"}`;
    }
  }
  hud.textContent =
    `tick    ${driver.tick}\n` +
    `phase   ${sim.patternName}\n` +
    `bullets ${system.liveCount}\n` +
    `beams   ${beams}\n` +
    `drawn   ${drawn}\n` +
    `lives   ${player.lives}\n` +
    `bombs   ${player.bombs}\n` +
    `graze   ${player.graze}\n` +
    `state   ${stateLabel}${player.invulnTicks > 0 ? ` (inv ${player.invulnTicks})` : ""}` +
    bossLines +
    `\nhash    0x${sim.hash().toString(16).padStart(8, "0")}\n` +
    `speed   ${driver.speed}x${driver.paused ? "   ❚❚ PAUSED" : ""}`;
}

const driver = createSimDriver({
  dt: DT,
  seed: SEED,
  sampleInput: (tick) => keyboard.sample(tick),
  step: (input) => sim.step(input),
  rebuild: (seed) => {
    sim = createSimulation(seed, DT, patterns, RUN_CONFIG, boss);
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

// Hot-reload: when the boss module is edited, swap in the new code, re-check
// determinism against it (the purity invariant's edit-time tripwire), then
// rebuild + replay to the current tick so the scene continues with the new code.
if (import.meta.hot) {
  import.meta.hot.accept("./patterns/boss", (mod) => {
    if (!mod) return;
    boss = (mod as unknown as { DEMO_BOSS: BossScript }).DEMO_BOSS;
    assertDeterministic(SEED, scripted, DT, patterns, boss);
    driver.resync();
    console.info("[higan] boss hot-reloaded");
  });
}
