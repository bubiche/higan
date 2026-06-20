// Throwaway bullet stress driver.
//
// Floods the real engine modules — the bullet system (spawn / cull / free-list /
// update loop) and the instanced renderer — to a steady-state target and reports
// the on-screen frame cadence. It exercises despawn, off-field culling, and
// free-list reuse — the paths a fixed contiguous range never touches — to
// confirm the CPU floor still holds once those are in the loop.
//
// Not part of the engine or the playable demo. The HUD here is dev
// instrumentation only.

import { startAnimationLoop } from "../core/loop";
import { createGL } from "../render/gl";
import { createBulletRenderer } from "../render/bullets";
import { createBulletSystem } from "../bullets/system";
import { Rng } from "../core/prng";
import { MAX_BULLETS } from "../bullets/store";
import { PLAYFIELD_W, PLAYFIELD_H, DT } from "../core/playfield";

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
  refill();
  // Linear bullets ignore the target; centre is fine.
  system.update(DT, PLAYFIELD_W / 2, PLAYFIELD_H / 2);
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

startAnimationLoop((dtSeconds) => {
  const t0 = performance.now();
  acc += dtSeconds;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    step();
    acc -= DT;
    steps++;
  }
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawn = renderer.draw(system.store, system.alive, system.highWater);
  const cpu = performance.now() - t0;

  // dtSeconds is 0 on an anomalous frame (tab resume / long stall); drop it from
  // the cadence sample so it can't poison avg/p99.
  if (dtSeconds > 0) pushSample(dtSeconds * 1000, cpu);

  if (++hudThrottle % 10 === 0) {
    const fr = stats(intervalMs, sampleLen);
    const cp = stats(cpuMs, sampleLen);
    const fps = fr.avg > 0 ? 1000 / fr.avg : 0;
    const verdict = fr.p99 <= 16.6 ? "pass" : "fail";
    hud.innerHTML =
      `live      ${system.liveCount.toLocaleString().padStart(7)}  / target ${target.toLocaleString()}\n` +
      `drawn     ${drawn.toLocaleString().padStart(7)}\n` +
      `highWater ${system.highWater.toLocaleString().padStart(7)}\n` +
      `cadence   avg ${fr.avg.toFixed(2)}ms   p99 <span class="${verdict}">${fr.p99.toFixed(2)}ms</span>\n` +
      `fps       ${fps.toFixed(1)}\n` +
      `cpu work  avg ${cp.avg.toFixed(3)}ms   (update + marshal + submit)`;
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") target = Math.min(MAX_BULLETS, target + 5_000);
  else if (e.key === "-" || e.key === "_") target = Math.max(0, target - 5_000);
});
