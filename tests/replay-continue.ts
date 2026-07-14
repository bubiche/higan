// The RunController + continue-spanning (multi-segment) replay.
//
// replay-container proved the per-run container round-trips and that ONE segment reproduces
// at its captured rank. This harness adds: a run that spans a continue (more than one
// segment), the RunController that accumulates those segments across the screen rebuild,
// and the live load that replays each segment IN THE DRIVER. The key risk: the driver
// mixes the run seed per stage internally, so a load must hand `loadRecording` the RUN
// seed — handing it a per-stage seed double-mixes and reproduces the WRONG trajectory.
// A harness that builds sims directly (like replay-container's) BYPASSES `loadRecording` and
// so is blind to exactly that bug. So this harness drives a real `SimDriver.loadRecording` with
// the same rebuild closure the in-game screen uses, and asserts the post-load state hash
// matches a reference — and that the double-mixed seed MISMATCHES, proving the test bites.
//
// Coverage:
//  1. RunController accumulates: recordContinue appends a segment AND spends a continue
//     together; assembleReplay = priorSegments + the live play, stamped with run-params.
//  2. The assembled multi-segment blob round-trips through the wire format.
//  3. Driver-path reproduction (the gap-closer): each segment loaded via a real
//     SimDriver.loadRecording({seed: RUN seed}) reproduces the reference state hash; the
//     double-mixed (per-stage) seed desyncs — so passing the wrong seed would be caught.
//  4. Rank adopt across BOTH segments: each segment's full trajectory (folded per-tick,
//     as the determinism guard does) reproduces at the captured rank; the wrong rank
//     desyncs — the cross-rank guarantee, now over a continue-spanning run.

import { createRunController, CHARACTER_INDEX } from "../src/app/run";
import { computeConfigId } from "../src/app/replay-compat";
import { serializeRunReplay, deserializeRunReplay, type ReplaySegment } from "../src/touhou/replay";
import { createStageSim, type Simulation } from "../src/core/sim";
import { createSimDriver } from "../src/core/runtime";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const stage = demoGame.stages[0]!;
const character = demoGame.characters[CHARACTER_INDEX]!;
const RUN_SEED = demoGame.seed;
const hex = (h: number): string => `0x${(h >>> 0).toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(36)} ${detail}`);
  if (!pass) failures++;
};

// A deterministic, salt-varied input stream so two segments differ (a stand-in for the
// distinct play of each continue — bit-identity doesn't depend on an in-sim death).
function mkFrames(n: number, salt: number): InputFrame[] {
  const f: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    f.push({
      dx: (((i + salt) >> 3) % 2 ? 1 : -1),
      dy: ((i + salt) % 3) - 1,
      shoot: ((i + salt) & 1) !== 0,
      focus: (i + salt) % 120 < 30,
      bomb: false,
    });
  }
  return f;
}

function framesEqual(a: readonly InputFrame[], b: readonly InputFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.dx !== y.dx || x.dy !== y.dy || x.shoot !== y.shoot || x.focus !== y.focus || x.bomb !== y.bomb) return false;
  }
  return true;
}

// Build a stage sim at the given STAGE seed + rank (the engine's createStageSim contract).
const buildAt = (stageSeed: number, difficulty: number): Simulation =>
  createStageSim(stage, stageSeed, character, difficulty, demoGame.config, DT);

// Reference end-of-replay state hash: build at the correctly-mixed stage seed, step every
// frame, take the final sim hash. This is what a driver load must land on.
function referenceStateHash(runSeed: number, difficulty: number, frames: readonly InputFrame[]): number {
  const sim = buildAt(mixSeed(runSeed, 0), difficulty);
  for (let i = 0; i < frames.length; i++) sim.step(frames[i]!);
  return sim.hash() >>> 0;
}

// The end-of-replay state hash THROUGH a real SimDriver, exactly as the in-game screen
// loads a segment: the driver's rebuild mixes the seed it is given per stage, so feeding
// `loadRecording` the RUN seed mixes once (correct); feeding a pre-mixed seed mixes twice.
function driverStateHash(seedFedToLoad: number, difficulty: number, frames: readonly InputFrame[]): number {
  let sim = buildAt(mixSeed(RUN_SEED, 0), difficulty);
  const driver = createSimDriver({
    dt: DT,
    seed: RUN_SEED,
    sampleInput: () => ({ dx: 0, dy: 0, shoot: false, focus: false, bomb: false }),
    step: (frame) => sim.step(frame),
    rebuild: (seed) => {
      sim = buildAt(mixSeed(seed, 0), difficulty); // buildSim's internal per-stage mix
    },
  });
  driver.loadRecording({ seed: seedFedToLoad, frames });
  return sim.hash() >>> 0;
}

// Folded per-tick trajectory hash, matching the determinism guard, so rank divergence
// over the WHOLE play (not just the end state) is what's compared.
function trajectoryHash(runSeed: number, difficulty: number, frames: readonly InputFrame[]): number {
  const sim = buildAt(mixSeed(runSeed, 0), difficulty);
  let acc = 0x811c9dc5;
  for (let i = 0; i < frames.length; i++) {
    sim.step(frames[i]!);
    acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
  }
  return acc >>> 0;
}

// ── 1: RunController accumulates segments + spends continues together ────────────
{
  const run = createRunController(demoGame, Rank.Lunatic);
  const initialOk =
    run.continuesUsed === 0 &&
    run.priorSegments.length === 0 &&
    run.difficulty === Rank.Lunatic &&
    run.character === CHARACTER_INDEX &&
    run.runSeed === RUN_SEED &&
    run.configId === computeConfigId(demoGame);
  check("fresh controller", initialOk, `rank ${run.difficulty} char ${run.character} cfg ${hex(run.configId)}`);

  const seg0: ReplaySegment = { stageIndex: 0, frames: mkFrames(900, 1) };
  const seg1: ReplaySegment = { stageIndex: 0, frames: mkFrames(1100, 2) };
  run.recordContinue(seg0);
  run.recordContinue(seg1);
  const accumOk =
    run.continuesUsed === 2 &&
    run.priorSegments.length === 2 &&
    run.priorSegments[0] === seg0 &&
    run.priorSegments[1] === seg1;
  check("recordContinue accumulates", accumOk, `${run.continuesUsed} continues, ${run.priorSegments.length} priors`);

  const live: ReplaySegment = { stageIndex: 0, frames: mkFrames(1500, 3) };
  const blob = run.assembleReplay(live);
  const assembleOk =
    blob.segments.length === 3 &&
    blob.segments[0] === seg0 &&
    blob.segments[1] === seg1 &&
    blob.segments[2] === live &&
    blob.runSeed === RUN_SEED &&
    blob.difficulty === Rank.Lunatic &&
    blob.character === CHARACTER_INDEX &&
    blob.configId === computeConfigId(demoGame);
  check("assembleReplay = priors + live", assembleOk, `${blob.segments.length} segments (2 continues)`);

  // ── 2: the multi-segment blob round-trips through the wire format ──────────────
  const back = deserializeRunReplay(serializeRunReplay(blob));
  const rtOk =
    back.segments.length === 3 &&
    back.runSeed === blob.runSeed &&
    back.difficulty === blob.difficulty &&
    back.character === blob.character &&
    back.configId === blob.configId &&
    back.segments.every((s, i) => s.stageIndex === 0 && framesEqual(s.frames, blob.segments[i]!.frames));
  check("multi-segment round-trip", rtOk, `${back.segments.map((s) => `${s.frames.length}f`).join(" + ")}`);
}

// A continue-spanning run: two distinct plays of stage 0 at Lunatic.
const SEG_A = mkFrames(2600, 11);
const SEG_B = mkFrames(3100, 47);

// ── 3: driver-path reproduction — the RUN-seed load reproduces, the double-mix doesn't ─
{
  for (const [name, frames] of [["segment A", SEG_A] as const, ["segment B", SEG_B] as const]) {
    const ref = referenceStateHash(RUN_SEED, Rank.Lunatic, frames);
    const right = driverStateHash(RUN_SEED, Rank.Lunatic, frames); // what the screen feeds
    const wrong = driverStateHash(mixSeed(RUN_SEED, 0), Rank.Lunatic, frames); // the double-mix bug
    check(`${name}: run-seed load reproduces`, right === ref, `${hex(right)} == ${hex(ref)}`);
    check(`${name}: per-stage seed desyncs`, wrong !== ref, `${hex(wrong)} != ${hex(ref)}`);
  }
}

// ── 4: rank adopt across BOTH segments (full trajectory, folded per-tick) ────────
{
  const blob = deserializeRunReplay(
    serializeRunReplay({
      runSeed: RUN_SEED,
      difficulty: Rank.Lunatic,
      character: CHARACTER_INDEX,
      configId: computeConfigId(demoGame),
      segments: [
        { stageIndex: 0, frames: SEG_A },
        { stageIndex: 0, frames: SEG_B },
      ],
    }),
  );
  for (let s = 0; s < blob.segments.length; s++) {
    const frames = blob.segments[s]!.frames;
    const trueLunatic = trajectoryHash(RUN_SEED, Rank.Lunatic, frames);
    const adopted = trajectoryHash(RUN_SEED, blob.difficulty, frames); // load adopts blob.difficulty
    const wrongRank = trajectoryHash(RUN_SEED, Rank.Normal, frames);
    check(`segment ${s + 1}: adopt rank reproduces`, adopted === trueLunatic, `${hex(adopted)} == ${hex(trueLunatic)}`);
    check(`segment ${s + 1}: wrong rank desyncs`, wrongRank !== trueLunatic, `${hex(wrongRank)} != ${hex(trueLunatic)}`);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
