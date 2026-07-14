// Homing player-shot verification (the third demo character, "Homing"): tracking
// amulets mixed with a straight needle while unfocused, switching to a stronger
// straight-only column when focused. Proves headlessly:
//
//  1. Determinism: the Homing character's trajectory (over the real demo stage, so
//     real enemies are present as homing targets) is bit-identical run to run.
//  2. Amulets actually steer: some alive homing shot's velocity changes between two
//     consecutive ticks while a live target exists — the load-bearing behavioral
//     claim (`stepShotHoming` is doing something, not a no-op).
//  3. Straight shots never bend: every alive non-homing shot's velocity is EXACTLY
//     (bit-identical) unchanged tick to tick, for the whole run — homing steering
//     cannot leak onto the shots that are supposed to fly straight.
//  4. Focus gating: a fully-focused-from-the-start run spawns zero homing shots,
//     ever — the amulet stream is unfocused-only, and the straight stream's damage
//     switches from `damage` to `focusDamage`.

import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const stage = demoGame.stages[0]!;
const homingChar = demoGame.characters[2]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  if (!pass) failures++;
};

check("Homing is the 3rd character", homingChar.id === "Homing", `id=${homingChar.id}`);

// ── 1: determinism over the real stage (real enemies present as targets) ────────
const TICKS = 600;
const scripted: InputFrame[] = [];
for (let i = 0; i < TICKS; i++) {
  scripted.push({ dx: (i >> 4) % 2 ? 1 : -1, dy: (i >> 5) % 2 ? 1 : -1, shoot: true, focus: false, bomb: false });
}
const simA = createStageSim(stage, STAGE_SEED, homingChar, NORMAL, demoGame.config, DT);
const simB = createStageSim(stage, STAGE_SEED, homingChar, NORMAL, demoGame.config, DT);
for (const input of scripted) simA.step(input);
for (const input of scripted) simB.step(input);
check("Homing run reproducible (A==B)", simA.hash() === simB.hash(), `${hex(simA.hash())} vs ${hex(simB.hash())}`);

// ── 2 & 3: steering vs. straight, tracked tick-by-tick ───────────────────────────
const sim = createStageSim(stage, STAGE_SEED, homingChar, NORMAL, demoGame.config, DT);
const cap = sim.shots.shots.length;
// Full double precision (NOT Float32Array) — these compare against `Shot.vx/vy`,
// which are plain `number` fields, so a Float32Array would inject its own rounding
// error into the diff and manufacture false "it moved" noise.
const prevVX = new Float64Array(cap);
const prevVY = new Float64Array(cap);
const prevAlive = new Uint8Array(cap);
const prevHoming = new Float64Array(cap);
let homingBent = false;
let straightShotsSeen = 0;
let homingShotsSeen = 0;
let straightBendViolations = 0;
let worstStraightDelta = 0;
for (let t = 0; t < TICKS; t++) {
  sim.step(scripted[t]!);
  const shots = sim.shots.shots;
  for (let i = 0; i < cap; i++) {
    const s = shots[i]!;
    if (s.alive) {
      if (s.homing !== 0) homingShotsSeen++;
      else straightShotsSeen++;
    }
    if (prevAlive[i] && s.alive) {
      const changed = s.vx !== prevVX[i] || s.vy !== prevVY[i];
      if (prevHoming[i] !== 0) {
        if (changed) homingBent = true;
      } else if (changed) {
        // A straight shot's velocity must be EXACTLY unchanged — no float tolerance:
        // nothing in the update loop touches a non-homing shot's vx/vy after spawn.
        straightBendViolations++;
        const d = Math.max(Math.abs(s.vx - prevVX[i]!), Math.abs(s.vy - prevVY[i]!));
        if (d > worstStraightDelta) worstStraightDelta = d;
      }
    }
    prevVX[i] = s.vx;
    prevVY[i] = s.vy;
    prevAlive[i] = s.alive ? 1 : 0;
    prevHoming[i] = s.homing;
  }
}
check("both streams fired (unfocused mixes homing + straight)", homingShotsSeen > 0 && straightShotsSeen > 0, `homing-ticks=${homingShotsSeen} straight-ticks=${straightShotsSeen}`);
check("some homing shot's heading actually bent", homingBent, `${homingBent}`);
check("straight shots never bend (exact, no float tolerance)", straightBendViolations === 0, `${straightBendViolations} violations, worst Δ=${worstStraightDelta}`);

// ── 4: focus gating — zero amulets, ever, when focused from tick 0 ──────────────
const focusedScripted: InputFrame[] = [];
for (let i = 0; i < 400; i++) {
  focusedScripted.push({ dx: (i >> 4) % 2 ? 1 : -1, dy: 0, shoot: true, focus: true, bomb: false });
}
const focusedSim = createStageSim(stage, STAGE_SEED, homingChar, NORMAL, demoGame.config, DT);
let sawHomingWhileFocused = false;
let sawFocusDamage = false;
let sawBaseDamage = false;
for (const input of focusedScripted) {
  focusedSim.step(input);
  for (const s of focusedSim.shots.shots) {
    if (!s.alive) continue;
    if (s.homing !== 0) sawHomingWhileFocused = true;
    // Damage is set once at spawn and never mutated over a shot's life, so any alive
    // shot's current `damage` is its spawn-time damage — no age gating needed.
    if (s.damage === 26) sawFocusDamage = true;
    if (s.damage === 7) sawBaseDamage = true;
  }
}
check("no homing shots ever spawn while focused", !sawHomingWhileFocused, `${sawHomingWhileFocused}`);
check("focused straight shots use focusDamage (26)", sawFocusDamage, `${sawFocusDamage}`);
check("focused run never fires the base (unfocused) damage (7)", !sawBaseDamage, `${sawBaseDamage}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
