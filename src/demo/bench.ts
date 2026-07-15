// Throwaway bullet stress driver.
//
// Floods the real engine modules — the bullet system (spawn / cull / free-list /
// update loop) and the instanced renderer — to a steady-state target and reports
// the on-screen frame cadence. It exercises despawn, off-field culling, and
// free-list reuse — the paths a fixed contiguous range never touches — to
// confirm the CPU floor still holds once those are in the loop.
//
// It also layers the REAL player + collision modules (the same `stepCollision`,
// `stepPlayerMovement`, `stepPlayerLifecycle` the playable sim runs — not a
// bench-local copy) over the flood, so the measurement covers the integrated
// per-tick cost, not just the bare bullet update. Collision is a SECOND O(N) pass
// over the same live slots, and its cost is independent of the player's position
// and lifecycle state (the per-slot graze distance test runs for every live bullet
// with no early-out — see collision.ts), so the moving input here is for
// observability (watch graze climb), not to manufacture a worst case. Press `c` to
// toggle the player + collision passes off and read the bare-bullet baseline in the
// same session. The boss/scheduler is deliberately excluded: it is O(1) + O(emitters)
// and never coexists with tens of thousands of bullets, so it is not part of this floor.
//
// Not part of the engine or the playable demo. The HUD here is dev
// instrumentation only.

import { startAnimationLoop } from "../core/loop";
import { createGL } from "../render/gl";
import { createBulletRenderer, INSTANCE_FLOATS, FLARE } from "../render/bullets";
import { createBulletSystem } from "../bullets/system";
import { createLaserSystem } from "../touhou/laser";
import {
  createPlayer,
  stepPlayerMovement,
  stepPlayerLifecycle,
  PlayerState,
  DEFAULT_PLAYER_CONFIG,
} from "../touhou/player";
import { DEFAULT_SCORING } from "../touhou/score";
import { stepCollision } from "../touhou/collision";
import { Rng } from "../core/prng";
import { MAX_BULLETS } from "../bullets/store";
import { PLAYFIELD_W, PLAYFIELD_H, DT } from "../core/playfield";
import type { InputFrame } from "../core/input";

const CSS_SCALE = 1.6;
const MARGIN = 16;
const SEED = 0x1a9e;
// Cap spawns per tick so the field ramps up smoothly instead of in one burst,
// and self-regulates at the target (steady-state refill only replaces what culled).
const SPAWN_PER_TICK = 400;
const SPEED_MIN = 70;
const SPEED_MAX = 150;

const PALETTE: readonly [number, number, number][] = [
  [1.0, 0.3, 0.4],
  [0.4, 0.75, 1.0],
  [1.0, 0.85, 0.35],
  [0.8, 0.5, 1.0],
];

let target = 30_000;

const canvas = document.getElementById("playfield") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const gl = createGL(canvas);

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${PLAYFIELD_W * CSS_SCALE}px`;
  canvas.style.height = `${PLAYFIELD_H * CSS_SCALE}px`;
  canvas.width = Math.round(PLAYFIELD_W * CSS_SCALE * dpr);
  canvas.height = Math.round(PLAYFIELD_H * CSS_SCALE * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
window.addEventListener("resize", resize);

const system = createBulletSystem(
  { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: MARGIN },
  MAX_BULLETS,
);
const renderer = createBulletRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, MAX_BULLETS);
const rng = new Rng(SEED);

// The real player + collision passes, layered over the flood. The laser pool stays
// empty (collision still iterates it — a cheap, realistic call path; the floor is
// the bullet N-vs-1). `config` is the shipped defaults; the player is allowed to
// take hits and run out of lives — the collision scan costs the same in every
// lifecycle state — and with `bomb: false` below the lifecycle never clears the
// field, so the flood holds steady at the target.
const PLAYER_CONFIG = DEFAULT_PLAYER_CONFIG;
const START_X = PLAYFIELD_W / 2;
const START_Y = PLAYFIELD_H * 0.8;
const player = createPlayer(PLAYER_CONFIG, START_X, START_Y, DEFAULT_SCORING.pivBase);
const lasers = createLaserSystem(64);
let collisionOn = true;
// Spawn-flash stress. The natural flood ages bullets past the flash almost immediately, so
// only a sliver ever flares — no stress on the flare path. With this on, every live bullet's
// age is pinned to 0 each frame so the WHOLE field flares at once: the strict worst case, both
// for instance count (glow stream doubles → 2× target) and for additive overdraw (each flare
// is a maxScale× quad). This is what the V1 gate must survive. NOTE the cpu-work p99 below only
// sees CPU (marshal + upload + draw submission); the flare's dominant cost is GPU fill-rate,
// which lands on the CADENCE fps line, not the CPU verdict — judge the flare gate on cadence.
let flareStress = false;

// Tick-driven moving input (no wall-clock). Its only job is observability: a moving
// player makes graze climb and occasionally takes a hit, proving the player +
// collision passes ran. `bomb: false` keeps the lifecycle from ever clearing the
// flood; `shoot` is inert here (no boss to damage).
function inputFor(tk: number): InputFrame {
  return {
    dx: (tk >> 5) & 1 ? 1 : -1,
    dy: (tk >> 6) & 1 ? 1 : -1,
    shoot: true,
    focus: tk % 120 < 30,
    bomb: false,
  };
}

let tick = 0;

// A moving emitter on a Lissajous path (driven by tick, not wall-clock) firing
// radial spreads. Straight-line bullets only — velocity-bending controllers are
// a later layer; here we just need dense spawn/cull churn.
function refill(): void {
  const simTime = tick * DT;
  const ex = PLAYFIELD_W / 2 + Math.sin(simTime * 0.7) * PLAYFIELD_W * 0.28;
  const ey = PLAYFIELD_H * 0.32 + Math.cos(simTime * 0.9) * PLAYFIELD_H * 0.18;

  let budget = SPAWN_PER_TICK;
  while (budget > 0 && system.liveCount < target) {
    const a = rng.range(0, Math.PI * 2);
    const speed = rng.range(SPEED_MIN, SPEED_MAX);
    const c = PALETTE[rng.u32() % PALETTE.length]!;
    // Straight-line bullets (Behavior.Linear = 0, no params) — this driver
    // measures the common-case branch + age write the widened loop adds.
    if (
      system.spawn(
        ex,
        ey,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        a,
        rng.range(2.2, 4.5),
        c[0],
        c[1],
        c[2],
        0, // sprite
        0, // behavior: Linear
        0, // bp0
        0, // bp1
      ) < 0
    ) {
      break; // store full
    }
    budget--;
  }
}

function step(): void {
  const input = inputFor(tick);
  // Mirror the sim's per-tick order: player movement → scene (here, the flood) →
  // bullet update → laser update → collision → death/bomb lifecycle.
  if (collisionOn) stepPlayerMovement(player, input, PLAYER_CONFIG, DT, PLAYFIELD_W, PLAYFIELD_H);
  refill();
  // Linear bullets ignore the homing target; the player position is fine.
  system.update(DT, player.x, player.y);
  if (collisionOn) {
    lasers.update(DT);
    const { hit } = stepCollision(player, system, lasers, PLAYER_CONFIG);
    // `bomb: false` means clearField is always false here, so the flood is never
    // wiped — the steady-state target holds while collision runs at full cost.
    stepPlayerLifecycle(player, input, PLAYER_CONFIG, hit, START_X, START_Y);
  }
  tick++;
}

// ── Cadence + CPU sampling ─────────────────────────────────────────────────
const WINDOW = 300;
const intervalMs = new Float64Array(WINDOW);
const cpuMs = new Float64Array(WINDOW);
let sampleIdx = 0;
let sampleLen = 0;

function pushSample(interval: number, cpu: number): void {
  intervalMs[sampleIdx] = interval;
  cpuMs[sampleIdx] = cpu;
  sampleIdx = (sampleIdx + 1) % WINDOW;
  if (sampleLen < WINDOW) sampleLen++;
}
function stats(buf: Float64Array, len: number): { avg: number; p99: number } {
  if (len === 0) return { avg: 0, p99: 0 };
  const tmp = buf.slice(0, len);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += tmp[i];
  tmp.sort();
  return { avg: sum / len, p99: tmp[Math.min(len - 1, Math.floor(len * 0.99))] };
}

let acc = 0;
let drawn = 0;
let hudThrottle = 0;

// The bench fires only glow-`Shape` bullets, so the custom-image split never routes here:
// the image-layer resolver always returns -1 (never "ready"), so `marshalBullets` writes
// nothing to this buffer. It exists to exercise the SAME partition path the game runs — the
// per-bullet high-bit test is the one thing that could regress the 50k hot loop, so the gate
// must measure it, not a bypass.
const benchImageInstances = new Float32Array(MAX_BULLETS * INSTANCE_FLOATS);
const noImageLayer = (): number => -1;

startAnimationLoop((dtSeconds) => {
  const t0 = performance.now();
  acc += dtSeconds;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    step();
    acc -= DT;
    steps++;
  }
  // Worst-case the spawn flash: pin every live bullet to age 0 so the whole field flares.
  // Bench-only mutation (the flood is straight-line bullets that ignore age); not the sim.
  if (flareStress) {
    const { age } = system.store;
    for (let i = 0; i < system.highWater; i++) if (system.alive[i]) age[i] = 0;
  }
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const counts = renderer.draw(
    system.store,
    system.alive,
    system.highWater,
    benchImageInstances,
    noImageLayer,
  );
  drawn = counts.glow + counts.image;
  const cpu = performance.now() - t0;

  // dtSeconds is 0 on an anomalous frame (tab resume / long stall); drop it from
  // the cadence sample so it can't poison avg/p99.
  if (dtSeconds > 0) pushSample(dtSeconds * 1000, cpu);

  if (++hudThrottle % 10 === 0) {
    const fr = stats(intervalMs, sampleLen);
    const cp = stats(cpuMs, sampleLen);
    const fps = fr.avg > 0 ? 1000 / fr.avg : 0;
    // The gate is a p99 CPU-budget claim, so the pass/fail rides on cpu-work p99.
    // Cadence p99 is the rAF frame interval — vsync-bound (≈8.3ms on a 120Hz
    // display), so it stays green regardless and is only a "are we dropping frames"
    // signal. And cpu-work AVG understates the per-tick cost: at 120Hz the
    // fixed-step accumulator runs a sim step only every other frame, so half the
    // samples are draw-only and dilute the mean; p99 captures the step-bearing
    // frames — the honest per-tick cost — which is what must fit 16.6ms.
    const verdict = cp.p99 <= 16.6 ? "pass" : "fail";
    const stateLabel =
      player.state === PlayerState.Alive
        ? "alive"
        : player.state === PlayerState.Dying
          ? "dying"
          : player.state === PlayerState.Respawning
            ? "respawn"
            : "game over";
    const playerLine = collisionOn
      ? `${stateLabel}  lives ${player.lives}  graze ${player.graze.toLocaleString()}`
      : "—";
    const cpuNote = collisionOn ? "update + collision + marshal + submit" : "update + marshal + submit";
    hud.innerHTML =
      `live      ${system.liveCount.toLocaleString().padStart(7)}  / target ${target.toLocaleString()}\n` +
      `drawn     ${drawn.toLocaleString().padStart(7)}  (incl. spawn flares)\n` +
      `highWater ${system.highWater.toLocaleString().padStart(7)}\n` +
      `collision ${collisionOn ? "ON  (press c to compare baseline)" : "off (bare bullets, press c)"}\n` +
      `flare     ${flareStress ? "STRESS (whole field, press f)" : "natural (press f to flood)"}  ticks ${FLARE.ticks} [ ]  scale ${FLARE.maxScale.toFixed(1)} , .\n` +
      `player    ${playerLine}\n` +
      `cpu work  avg ${cp.avg.toFixed(3)}ms   p99 <span class="${verdict}">${cp.p99.toFixed(3)}ms</span>   (${cpuNote})\n` +
      `cadence   avg ${fr.avg.toFixed(2)}ms   p99 ${fr.p99.toFixed(2)}ms   fps ${fps.toFixed(1)}  (flare gate rides HERE, not cpu)`;
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") target = Math.min(MAX_BULLETS, target + 5_000);
  else if (e.key === "-" || e.key === "_") target = Math.max(0, target - 5_000);
  else if (e.key === "c" || e.key === "C") collisionOn = !collisionOn;
  else if (e.key === "f" || e.key === "F") flareStress = !flareStress;
  // Live flare tuning (no rebuild) — the two knobs to reach for if cadence sags.
  else if (e.key === "[") FLARE.ticks = Math.max(1, FLARE.ticks - 1);
  else if (e.key === "]") FLARE.ticks = Math.min(60, FLARE.ticks + 1);
  else if (e.key === ",") FLARE.maxScale = Math.max(1, FLARE.maxScale - 0.25);
  else if (e.key === ".") FLARE.maxScale = Math.min(6, FLARE.maxScale + 0.25);
});
