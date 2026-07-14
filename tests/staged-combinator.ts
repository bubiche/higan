// The staged-behavior combinator (ObjMove_AddPattern generalization).
//
// The determinism finding that shapes this (verified against sim.ts ~817): the bullet
// hash folds bp0, bp1 AND behavior per live bullet. For a staged bullet bp0 = the
// program id, so program identity is folded DIRECTLY into the hash. That makes structural
// interning load-bearing: if a rebuild ever assigned a different id to the same logical
// program, the hash would diverge even with identical trajectories. So this harness
// checks three things:
//
//  1. Rebuild-and-replay reproduces the FULL trajectory — run well past the program's
//     fixed timeline and deep into the continuous (curve→freeze→ramp) tail, fold the
//     per-tick hash exactly as the determinism guard does, and assert it reproduces.
//     Driven through a real SimDriver.loadRecording (the production rebuild path, like
//     replay-continue) so the end-state check exercises the actual load wiring, not just a re-build.
//     Teeth: a structurally-different program yields a different hash (so the test would
//     catch a program/id mix-up), through both the fold and the driver path.
//
//  2. Structural interning is correct and load-bearing — identical structures share a
//     key and intern to ONE id; different structures get different keys/ids; clear()
//     resets the table. This is what keeps the hashed programId deterministic.
//
//  3. The `ticks: N` boundary the hash CANNOT see. An off-by-one in the segment
//     boundary reproduces identically in record and replay, so the trajectory-hash test
//     passes regardless — only a direct position assertion pins it. A `{ ticks: N }`
//     segment then `set: { speed: 0 }`: the bullet must be moving on updates 1..N-1 and
//     stopped from update N on (delay-consistent).

import { createStageSim, type Simulation } from "../src/core/sim";
import { createSimDriver } from "../src/core/runtime";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import { createBulletSystem, Behavior } from "../src/bullets/system";
import { normalizeStaged } from "../src/bullets/staged";
import {
  curve,
  ramp,
  staged,
  Shape,
  type BulletBehavior,
  type EmitterScript,
  type StageScript,
  type StageDef,
} from "../src/api";
import type { InputFrame } from "../src/core/input";

const RUN_SEED = demoGame.seed;
const STAGE_SEED = mixSeed(RUN_SEED, 0);
const character = demoGame.characters[0]!;
const GREEN: readonly [number, number, number] = [0.5, 1.0, 0.6];
const ZERO: InputFrame = { dx: 0, dy: 0, shoot: false, focus: false, bomb: false };
const hex = (h: number): string => `0x${(h >>> 0).toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  if (!pass) failures++;
};

// A deterministic, slightly varied input stream so the player (and thus the aimPlayer
// target) moves — exercising the staged aim edit against a moving target.
function mkFrames(n: number): InputFrame[] {
  const f: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    f.push({
      dx: (i >> 3) % 2 ? 1 : -1,
      dy: (i % 3) - 1,
      shoot: (i & 1) !== 0,
      focus: i % 120 < 30,
      bomb: false,
    });
  }
  return f;
}

// A stage that subs one emitter firing staged rings of `prog` — a focused staged scene.
function stagedStage(id: string, prog: BulletBehavior): StageDef {
  const pattern: EmitterScript = function* (ctx) {
    let phase = 0;
    while (true) {
      ctx.ring({
        count: 14,
        speed: 90,
        angle: phase,
        radius: 5,
        color: GREEN,
        sprite: Shape.BigOrb,
        behavior: prog,
      });
      phase += 0.3;
      yield 18;
    }
  };
  const script: StageScript = function* (ctx) {
    ctx.sub(pattern);
    yield 1_000_000; // idle; the sub-emitter does the work
  };
  return { id, script };
}

const buildSim = (stageDef: StageDef, stageSeed: number, difficulty: number): Simulation =>
  createStageSim(stageDef, stageSeed, character, difficulty, demoGame.config, DT);

// Folded per-tick trajectory hash, matching the determinism guard — so a program/id
// divergence over the WHOLE play (not just the end state) is what's compared.
function trajHash(stageDef: StageDef, difficulty: number, frames: readonly InputFrame[]): number {
  const sim = buildSim(stageDef, STAGE_SEED, difficulty);
  let acc = 0x811c9dc5;
  for (let i = 0; i < frames.length; i++) {
    sim.step(frames[i]!);
    acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
  }
  return acc >>> 0;
}

// End-of-replay state hash for a fresh build (the reference a driver load must land on).
function referenceEndHash(stageDef: StageDef, frames: readonly InputFrame[]): number {
  const sim = buildSim(stageDef, STAGE_SEED, Rank.Normal);
  for (let i = 0; i < frames.length; i++) sim.step(frames[i]!);
  return sim.hash() >>> 0;
}

// End-of-replay state hash THROUGH a real SimDriver.loadRecording — the production
// rebuild path the in-game screen uses (rebuild-from-seed + replay), as in replay-continue.
function driverEndHash(stageDef: StageDef, frames: readonly InputFrame[]): number {
  let sim = buildSim(stageDef, STAGE_SEED, Rank.Normal);
  const driver = createSimDriver({
    dt: DT,
    seed: RUN_SEED,
    sampleInput: () => ZERO,
    step: (frame) => sim.step(frame),
    rebuild: (seed) => {
      sim = buildSim(stageDef, mixSeed(seed, 0), Rank.Normal); // the driver's per-stage mix
    },
  });
  driver.loadRecording({ seed: RUN_SEED, frames });
  return sim.hash() >>> 0;
}

// ── 1: rebuild-and-replay reproduces the full trajectory + tail; structure-sensitive ──
{
  const FRAMES = mkFrames(400); // past the 64-tick fixed timeline, deep into the ramp tail
  const A: BulletBehavior = staged([
    { ticks: 40, motion: curve(1.6) }, // drift + curve
    { ticks: 24, set: { speed: 0 } }, // freeze
    { set: { aimPlayer: true, speed: 220 }, motion: ramp(120, 0) }, // re-aim + accelerate, forever
  ]);
  // B differs by ONE number (final snap speed) — a structurally-different program.
  const B: BulletBehavior = staged([
    { ticks: 40, motion: curve(1.6) },
    { ticks: 24, set: { speed: 0 } },
    { set: { aimPlayer: true, speed: 260 }, motion: ramp(120, 0) },
  ]);
  const stageA = stagedStage("stagedA", A);
  const stageB = stagedStage("stagedB", B);

  const refA = trajHash(stageA, Rank.Normal, FRAMES);
  const reA = trajHash(stageA, Rank.Normal, FRAMES); // rebuild from seed
  const hB = trajHash(stageB, Rank.Normal, FRAMES);
  check("full trajectory reproduces", reA === refA, `${hex(reA)} == ${hex(refA)}`);
  check("different program → different hash", hB !== refA, `${hex(hB)} != ${hex(refA)}`);

  const endRefA = referenceEndHash(stageA, FRAMES);
  const endDrvA = driverEndHash(stageA, FRAMES);
  const endDrvB = driverEndHash(stageB, FRAMES);
  check("driver load reproduces end state", endDrvA === endRefA, `${hex(endDrvA)} == ${hex(endRefA)}`);
  check("driver + wrong program desyncs", endDrvB !== endRefA, `${hex(endDrvB)} != ${hex(endRefA)}`);
}

// ── 2: structural interning is correct AND load-bearing ─────────────────────────────
{
  const mk = (snap: number): BulletBehavior["program"] =>
    normalizeStaged([
      { ticks: 40, motion: curve(1.6) },
      { ticks: 24, set: { speed: 0 } },
      { set: { aimPlayer: true, speed: snap }, motion: ramp(120, 0) },
    ]);
  const progA1 = mk(220)!;
  const progA2 = mk(220)!; // structurally identical to A1
  const progB = mk(260)!; // differs by the snap speed

  check("identical structure → same key", progA1.key === progA2.key, "keys match");
  check("different structure → different key", progA1.key !== progB.key, "keys differ");

  const sys = createBulletSystem({ width: 400, height: 480, margin: 40 }, 64);
  const idA1 = sys.registerProgram(progA1);
  const idA2 = sys.registerProgram(progA2); // same structure → must collapse to one id
  const idB = sys.registerProgram(progB);
  check("same structure interns to one id", idA1 === idA2, `${idA1} == ${idA2}`);
  check("different structure → new id", idB !== idA1, `${idB} != ${idA1}`);

  sys.clear();
  const idAfterClear = sys.registerProgram(progB);
  check("clear() resets the table", idAfterClear === 0, `id after clear = ${idAfterClear}`);
}

// ── 3: the `ticks: N` boundary the hash can't see — moving 1..N-1, stopped from N ───
{
  const N = 10;
  // Segment 0: launch (default linear); segment 1 @t=N: freeze (speed 0).
  const prog = normalizeStaged([{ ticks: N }, { set: { speed: 0 } }])!;
  // Tall field so the downward bullet is never culled during the test.
  const sys = createBulletSystem({ width: 400, height: 100_000, margin: 50 }, 16);
  const id = sys.registerProgram(prog);
  const SPEED = 120;
  // Launch downward (angle = +PI/2 → vx=0, vy>0), as emit() would for segment 0.
  const slot = sys.spawn(200, 50, 0, SPEED, Math.PI / 2, 5, 0.5, 1, 0.6, Shape.BigOrb, Behavior.Staged, id, 0);

  const yAt: number[] = [sys.store.y[slot]!]; // y after update 0 (= spawn position)
  for (let u = 1; u <= N + 2; u++) {
    sys.update(DT, 200, 50);
    yAt.push(sys.store.y[slot]!);
  }

  // Moving on updates 1..N-1: each step strictly advances y.
  let movedThroughBoundary = true;
  for (let u = 1; u <= N - 1; u++) if (!(yAt[u]! > yAt[u - 1]!)) movedThroughBoundary = false;
  check(`moving on updates 1..${N - 1}`, movedThroughBoundary, `y: ${yAt[0]!.toFixed(2)} → ${yAt[N - 1]!.toFixed(2)}`);

  // Stopped from update N on: y frozen at its update-(N-1) value.
  const stoppedAtN = yAt[N] === yAt[N - 1];
  const staysStopped = yAt[N + 1] === yAt[N] && yAt[N + 2] === yAt[N];
  check(`stopped from update ${N}`, stoppedAtN, `y[${N - 1}]=${yAt[N - 1]!.toFixed(2)} y[${N}]=${yAt[N]!.toFixed(2)}`);
  check("stays stopped after the boundary", staysStopped, `y[${N + 1}]=${yAt[N + 1]!.toFixed(2)}`);

  // The terminal-linear fast-path reclaim fired, and bp0/bp1 stayed stable (still hashed).
  check("downgraded to Linear at terminal segment", sys.store.behavior[slot] === Behavior.Linear, `beh=${sys.store.behavior[slot]}`);
  check("bp0/bp1 retained (programId, last segment)", sys.store.bp0[slot] === id && sys.store.bp1[slot] === 1, `bp0=${sys.store.bp0[slot]} bp1=${sys.store.bp1[slot]}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
