// Headless proof — the multi-stage run foundation (stage-advance carry-in + replay across
// the boundary).
//
// Extends the full-run-replay fold to a MULTI-STAGE run (Stage 1 chained twice — a headless def
// with `stages: [stage1, stage1]`). It exercises the whole matrix the foundation exists to
// prove, in ONE assembled-through-the-real-controller blob:
//   seg0 — stage 0, CLEARED → stage-ADVANCE (stageIndex 0→1), carrying run-economy forward
//   seg1 — stage 1, played with that carry-in, bled to GAME-OVER
//   seg2 — stage 1, CONTINUE (same index → carry-in reset to a fresh full-resource start)
// so both replay-reconstruction branches fire: +1 (advance → carry) and 0 (continue → reset).
//
// It then serializes → deserializes → folds the trajectory hash across the stage boundary
// and asserts (a) bit-identical replay across all three segments, (b) the reconstructed
// carry-in equals the LIVE carry-in (reconstruction == live progression), and (c) the
// carried state actually lands in stage 2's opening player state (a non-default score/lives).
//
// Fixture: a test-only high-DPS, high-life character (damage 80, lives 5 — legit
// deterministic run-parameters). The reactive ping-pong bot clears stage 1 on Easy with it
// (probed: t≈1357), and a sit-still play bleeds the carried lives to game-over (t≈1893).

import { createStageSim, type Simulation } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { SfxId } from "../src/core/events";
import { PlayerState, readCarryIn, type CarryIn } from "../src/touhou/player";
import { createRunController, type RunController } from "../src/app/run";
import { defineGame, type CharacterDef } from "../src/api/game";
import { Shape } from "../src/render/shapes";
import {
  serializeRunReplay,
  deserializeRunReplay,
  type RunReplay,
  type ReplaySegment,
} from "../src/touhou/replay";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const RANK = Rank.Easy;

// A test-only high-DPS, high-life character (both legitimate deterministic run-parameters).
const focus = demoGame.characters[1]!;
const TEST_CHAR: CharacterDef = {
  id: "TestDPS",
  config: { ...focus.config, lives: 5 },
  shot: { ...focus.shot!, damage: 80, sprite: Shape.Star, color: [1, 0.9, 0.4] },
  bomb: focus.bomb,
};

// Stage 1 chained twice — a genuine multi-stage main chain (two non-extra stages).
const stage1 = demoGame.stages[0]!;
const def = defineGame({
  title: "multi-stage test",
  seed: demoGame.seed,
  stages: [stage1, stage1],
  characters: [TEST_CHAR],
  difficulties: demoGame.difficulties,
  config: demoGame.config,
});

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${detail}`);
  if (!pass) failures++;
};
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;
const carryEq = (a: CarryIn | null, b: CarryIn | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.lives === b.lives &&
    a.bombs === b.bombs &&
    a.power === b.power &&
    a.score === b.score &&
    a.piv === b.piv &&
    a.nextExtendIndex === b.nextExtendIndex &&
    a.graze === b.graze &&
    a.pointItemsCollected === b.pointItemsCollected);

// Build a stage sim exactly as the in-game screen does (RUN seed mixed per stage index,
// the controller's current carry-in applied).
const buildCurrent = (run: RunController): Simulation =>
  createStageSim(
    def.stages[run.currentStageIndex]!,
    mixSeed(run.runSeed, run.currentStageIndex),
    def.characters[run.character]!,
    run.difficulty,
    def.config,
    DT,
    run.carryIn ?? undefined,
  );

// Reactive bot. "melee": ping-pong + shoot + focus (clears / partial-plays). "die": sit
// still (bleeds carried lives to game-over without ever clearing).
function playBot(
  sim: Simulation,
  maxTicks: number,
  mode: "melee" | "die",
): { frames: InputFrame[]; events: Set<number>; cleared: boolean; gameOver: boolean } {
  const frames: InputFrame[] = [];
  const events = new Set<number>();
  for (let t = 0; t < maxTicks; t++) {
    const f: InputFrame =
      mode === "die"
        ? { dx: 0, dy: 0, shoot: false, focus: false, bomb: false }
        : { dx: Math.floor(t / 16) % 2 === 0 ? 1 : -1, dy: 0, shoot: true, focus: true, bomb: false };
    frames.push(f);
    sim.step(f);
    for (const e of sim.events) events.add(e.id);
    if (sim.player.state === PlayerState.GameOver || sim.stageComplete) break;
  }
  return { frames, events, cleared: sim.stageComplete, gameOver: sim.player.state === PlayerState.GameOver };
}

// Fold the whole multi-stage run's trajectory hash, reconstructing each segment's carry-in
// from the priors exactly as the in-game replay loader does (advance = +1 → carry, continue
// = same index → reset). Records each segment's reconstructed start-state so the assertions
// can prove the carry-in landed.
function foldRun(blob: RunReplay): {
  hash: number;
  events: Set<number>;
  startStates: CarryIn[];
  reconstructed: (CarryIn | null)[];
} {
  let acc = 0x811c9dc5 >>> 0;
  const events = new Set<number>();
  const startStates: CarryIn[] = [];
  const reconstructed: (CarryIn | null)[] = [null]; // segment 0 always starts fresh
  let carry: CarryIn | null = null;
  blob.segments.forEach((seg, si) => {
    const sim = createStageSim(
      def.stages[seg.stageIndex]!,
      mixSeed(blob.runSeed, seg.stageIndex),
      def.characters[blob.character]!,
      blob.difficulty,
      def.config,
      DT,
      carry ?? undefined,
    );
    startStates.push(readCarryIn(sim.player));
    for (const f of seg.frames) {
      sim.step(f);
      for (const e of sim.events) events.add(e.id);
      acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
    }
    const next = blob.segments[si + 1];
    if (next) {
      carry = next.stageIndex === seg.stageIndex + 1 ? readCarryIn(sim.player) : null;
      reconstructed.push(carry);
    }
  });
  return { hash: acc >>> 0, events, startStates, reconstructed };
}

const framesEqual = (a: readonly InputFrame[], b: readonly InputFrame[]): boolean =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i]!;
    return f.dx === g.dx && f.dy === g.dy && f.shoot === g.shoot && f.focus === g.focus && f.bomb === g.bomb;
  });

// ═══ Assemble the multi-stage run through the REAL controller ════════════════════
console.log(`\n⟐ Multi-stage foundation (Stage 1 chained twice, char=TestDPS, rank=Easy)\n`);

// Guard the stage-ordering invariants the reconstruction rule depends on (negative paths,
// so they're executed not just reasoned): a main stage after an extra one, and an all-extra
// game, must both be rejected at defineGame.
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const extra1 = { ...stage1, extra: true };
check("defineGame rejects a main stage after an extra one", throws(() => defineGame({ ...def, stages: [stage1, extra1, stage1] })));
check("defineGame rejects an all-extra game", throws(() => defineGame({ ...def, stages: [extra1] })));
check("defineGame accepts main…extra ordering", !throws(() => defineGame({ ...def, stages: [stage1, extra1] })));

const run = createRunController(def, RANK, 0);

// seg0 — clear stage 0.
const sim0 = buildCurrent(run);
const seg0 = playBot(sim0, 8000, "melee");
const carry0 = readCarryIn(sim0.player);
console.log(
  `segment 0 (stage ${0}): ${seg0.frames.length}f, cleared=${seg0.cleared}, ` +
    `end lives=${carry0.lives} score=${carry0.score.toLocaleString("en-US")}`,
);
check("segment 0 CLEARED stage 0", seg0.cleared);

// Advance — hand seg0's end-state to stage 1 (no continue spent).
run.advanceStage({ stageIndex: 0, frames: seg0.frames } satisfies ReplaySegment, carry0);
check("advance moved the run to stage index 1", run.currentStageIndex === 1, `idx=${run.currentStageIndex}`);
check("advance spent NO continue", run.continuesUsed === 0, `continuesUsed=${run.continuesUsed}`);
check("advance stashed the carry-in", carryEq(run.carryIn, carry0));

// seg1 — play stage 1 with the carry-in; bleed to game-over.
const sim1 = buildCurrent(run);
const seg1Start = readCarryIn(sim1.player);
check("stage 1 STARTS from the carried run-economy", carryEq(seg1Start, carry0), `score=${seg1Start.score.toLocaleString("en-US")}`);
check("carried score is non-default (>0)", seg1Start.score > 0);
const seg1 = playBot(sim1, 8000, "die");
console.log(`segment 1 (stage 1): ${seg1.frames.length}f, gameOver=${seg1.gameOver} (played with carry-in)`);
check("segment 1 bled to game-over", seg1.gameOver);

// Continue — same stage, reset to a fresh start.
run.recordContinue({ stageIndex: 1, frames: seg1.frames } satisfies ReplaySegment);
check("continue spent a continue", run.continuesUsed === 1, `continuesUsed=${run.continuesUsed}`);
check("continue reset the carry-in to null", run.carryIn === null);
check("continue kept the stage index (1)", run.currentStageIndex === 1);

// seg2 — the continued play (fresh full resources at stage 1).
const sim2 = buildCurrent(run);
check("continued stage 1 starts fresh (score 0)", sim2.player.score === 0, `score=${sim2.player.score}`);
check("continued stage 1 restores full lives", sim2.player.lives === TEST_CHAR.config.lives, `lives=${sim2.player.lives}`);
const seg2 = playBot(sim2, 600, "melee");
console.log(`segment 2 (stage 1): ${seg2.frames.length}f (continued play)\n`);

const replay: RunReplay = run.assembleReplay({ stageIndex: 1, frames: seg2.frames });
check(
  "run has 3 segments, stage indices [0,1,1]",
  replay.segments.map((s) => s.stageIndex).join(",") === "0,1,1",
  `[${replay.segments.map((s) => s.stageIndex).join(",")}]`,
);

// ═══ Blob round-trip ═════════════════════════════════════════════════════════════
const bytes = serializeRunReplay(replay);
const loaded = deserializeRunReplay(bytes);
check(
  "blob round-trips (segments + frames)",
  loaded.segments.length === replay.segments.length &&
    loaded.segments.every(
      (s, i) => s.stageIndex === replay.segments[i]!.stageIndex && framesEqual(s.frames, replay.segments[i]!.frames),
    ),
  `${bytes.length} bytes`,
);

// ═══ Bit-identical multi-stage replay (the spine) ════════════════════════════════
const hAssembled = foldRun(replay);
const hLoaded = foldRun(loaded);
const hAgain = foldRun(loaded);
check("multi-stage replay bit-identical (assembled == blob)", hAssembled.hash === hLoaded.hash, `${hex(hAssembled.hash)} vs ${hex(hLoaded.hash)}`);
check("determinism holds (blob folded twice, same hash)", hLoaded.hash === hAgain.hash, hex(hLoaded.hash));

// ═══ Carry-in reconstruction == live progression ═════════════════════════════════
// The loader re-runs prior segments to reconstruct each segment's carry-in. Assert both
// branches: segment 1 (advance) reconstructs to seg0's LIVE end-state; segment 2 (continue)
// reconstructs to null (reset). And the reconstructed START state lands in the sim.
check("reconstructed carry-in for seg1 == live seg0 end-state (advance)", carryEq(hLoaded.reconstructed[1]!, carry0));
check("reconstructed carry-in for seg2 == null (continue reset)", hLoaded.reconstructed[2] === null);
check("stage-1 replay STARTS from the carried economy", carryEq(hLoaded.startStates[1]!, carry0), `score=${hLoaded.startStates[1]!.score.toLocaleString("en-US")}`);
check("continued replay STARTS fresh (score 0, full lives)", hLoaded.startStates[2]!.score === 0 && hLoaded.startStates[2]!.lives === TEST_CHAR.config.lives);

// ═══ The replay reproduces the run, not just a matching number ═══════════════════
check("replay re-fires a spell capture", hLoaded.events.has(SfxId.SpellCapture));
check("replay reproduces the stage-1 game-over", hLoaded.startStates.length === 3 && seg1.gameOver);

console.log(
  failures === 0
    ? `\n✓ PASS — multi-stage run replays bit-identical across the boundary, hash ${hex(hAssembled.hash)}\n`
    : `\n✗ ${failures} FAILURE(S)\n`,
);
if (failures > 0) process.exitCode = 1;
