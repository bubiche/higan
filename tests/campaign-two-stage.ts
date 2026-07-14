// Headless proof of the REAL two-stage campaign (Stage 1 → Stage 2).
//
// multistage-foundation proved the multi-stage machinery against a stub (`stages: [stage1,
// stage1]`). This proves it against the actual authored content: the demo's real
// `[stage-1, stage-2]` main
// chain, so Stage 2's own waves/midboss/boss (and its new ramp/wave behaviours) are folded
// into a bit-identical multi-stage replay. One assembled-through-the-real-controller blob:
//   seg0 — stage 0 (Stage 1), CLEARED → stage-ADVANCE (0→1), carrying run-economy forward
//   seg1 — stage 1 (Stage 2), played WITH that carry-in, bled to GAME-OVER
//   seg2 — stage 1 (Stage 2), CONTINUE (reset) → CLEARED (the final-stage clear the ending keys on)
// so it exercises: the real advance boundary, both carry-in branches (+1 advance / 0 continue),
// the carried economy landing in Stage 2's opening state, AND Stage 2 being clearable.
//
// Fixture: the same test-only high-DPS, high-life character multistage-foundation used (a
// legit deterministic run-parameter) so the reactive bot beats each multi-phase boss inside
// a bounded budget.

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

// The REAL Stage 1 → Stage 2 sub-chain. Pinned to the first TWO authored stages via
// `slice(0, 2)` so this stays a valid 2-stage-campaign proof (and its `0xb964236b` baseline
// holds) even as the demo grows a third stage — campaign-three-stage proves the full 3-stage chain.
const def = defineGame({
  title: "two-stage campaign test",
  seed: demoGame.seed,
  stages: demoGame.stages.slice(0, 2),
  characters: [TEST_CHAR],
  difficulties: demoGame.difficulties,
  config: demoGame.config,
});

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${detail}`);
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

// Reactive bot. "melee": ping-pong + shoot + focus (clears). "die": sit still (bleeds
// carried lives to game-over without ever clearing).
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
// = same index → reset).
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

// ═══ Assemble the real two-stage run through the REAL controller ══════════════════
console.log(`\n⟐ Two-stage campaign — real Stage 1 → Stage 2 (char=TestDPS, rank=Easy)\n`);

check("the demo main chain has two stages", def.stages.map((s) => s.id).join(",") === "stage-1,stage-2", def.stages.map((s) => s.id).join(","));

const run = createRunController(def, RANK, 0);
check("a fresh run has a next stage (Stage 1 will ADVANCE, not end)", run.hasNextStage);

// seg0 — clear Stage 1.
const sim0 = buildCurrent(run);
const seg0 = playBot(sim0, 8000, "melee");
const carry0 = readCarryIn(sim0.player);
console.log(
  `segment 0 (stage-1): ${seg0.frames.length}f, cleared=${seg0.cleared}, ` +
    `end lives=${carry0.lives} score=${carry0.score.toLocaleString("en-US")}`,
);
check("segment 0 CLEARED Stage 1", seg0.cleared);

// Advance — hand seg0's end-state to Stage 2 (no continue spent).
run.advanceStage({ stageIndex: 0, frames: seg0.frames } satisfies ReplaySegment, carry0);
check("advance moved the run to stage index 1", run.currentStageIndex === 1, `idx=${run.currentStageIndex}`);
check("advance spent NO continue", run.continuesUsed === 0);
check("advance stashed the carry-in", carryEq(run.carryIn, carry0));
check("on Stage 2 there is NO next stage (final → clear rolls the ending)", !run.hasNextStage);

// seg1 — play Stage 2 WITH the carry-in; bleed to game-over.
const sim1 = buildCurrent(run);
const seg1Start = readCarryIn(sim1.player);
check("Stage 2 STARTS from the carried run-economy", carryEq(seg1Start, carry0), `score=${seg1Start.score.toLocaleString("en-US")}`);
check("carried score is non-default (>0)", seg1Start.score > 0);
const seg1 = playBot(sim1, 8000, "die");
console.log(`segment 1 (stage-2): ${seg1.frames.length}f, gameOver=${seg1.gameOver} (played with carry-in)`);
check("segment 1 bled to game-over on Stage 2", seg1.gameOver);

// Continue — same stage, reset to a fresh start.
run.recordContinue({ stageIndex: 1, frames: seg1.frames } satisfies ReplaySegment);
check("continue spent a continue", run.continuesUsed === 1);
check("continue reset the carry-in to null", run.carryIn === null);
check("continue kept the stage index (1)", run.currentStageIndex === 1);

// seg2 — the continued play (fresh full resources at Stage 2) → CLEAR the final stage.
const sim2 = buildCurrent(run);
check("continued Stage 2 starts fresh (score 0)", sim2.player.score === 0, `score=${sim2.player.score}`);
check("continued Stage 2 restores full lives", sim2.player.lives === TEST_CHAR.config.lives, `lives=${sim2.player.lives}`);
const seg2 = playBot(sim2, 8000, "melee");
console.log(`segment 2 (stage-2): ${seg2.frames.length}f, cleared=${seg2.cleared} (continued play)\n`);
check("segment 2 CLEARED Stage 2 (the final-stage clear)", seg2.cleared);
check("final clear on a run with no next stage → the ending path (not advance)", seg2.cleared && !run.hasNextStage);

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

// ═══ Bit-identical multi-stage replay across the REAL boundary (the spine) ════════
const hAssembled = foldRun(replay);
const hLoaded = foldRun(loaded);
const hAgain = foldRun(loaded);
check("multi-stage replay bit-identical (assembled == blob)", hAssembled.hash === hLoaded.hash, `${hex(hAssembled.hash)} vs ${hex(hLoaded.hash)}`);
check("determinism holds (blob folded twice, same hash)", hLoaded.hash === hAgain.hash, hex(hLoaded.hash));

// ═══ Carry-in reconstruction == live progression on the real content ══════════════
check("reconstructed carry-in for seg1 == live seg0 end-state (advance)", carryEq(hLoaded.reconstructed[1]!, carry0));
check("reconstructed carry-in for seg2 == null (continue reset)", hLoaded.reconstructed[2] === null);
check("Stage 2 replay STARTS from the carried economy", carryEq(hLoaded.startStates[1]!, carry0), `score=${hLoaded.startStates[1]!.score.toLocaleString("en-US")}`);
check("continued replay STARTS fresh (score 0, full lives)", hLoaded.startStates[2]!.score === 0 && hLoaded.startStates[2]!.lives === TEST_CHAR.config.lives);

// ═══ The replay reproduces the run, not just a matching number ═══════════════════
check("replay re-fires a spell capture (Stage 2 spells run)", hLoaded.events.has(SfxId.SpellCapture));

console.log(
  failures === 0
    ? `\n✓ TWO-STAGE CAMPAIGN PASS — real Stage 1 → Stage 2 replays bit-identical across the advance boundary, hash ${hex(hAssembled.hash)}\n`
    : `\n✗ ${failures} FAILURE(S)\n`,
);
if (failures > 0) process.exitCode = 1;
