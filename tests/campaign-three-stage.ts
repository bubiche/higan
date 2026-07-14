// Headless proof of the FULL three-stage campaign (Stage 1 → Stage 2 → Stage 3).
//
// campaign-two-stage proved the two-stage chain; this proves the whole authored campaign, so
// Stage 3's own waves/midboss and its MOVING final boss (`delay` + between-phase glides)
// fold into a bit-identical multi-stage replay, AND the final-stage clear reaches the ending path
// (`!hasNextStage`). One assembled-through-the-real-controller blob spans two advance
// boundaries and a continue:
//   seg0 — stage 0 (Stage 1), CLEARED → advance (0→1), carrying run-economy forward
//   seg1 — stage 1 (Stage 2), played with that carry-in, bled to GAME-OVER
//   seg2 — stage 1 (Stage 2), CONTINUE (reset) → CLEARED → advance (1→2), carrying forward
//   seg3 — stage 2 (Stage 3), CLEARED → final-stage clear (the ending keys on !hasNextStage)
// exercising: both advance boundaries, both carry-in branches (+1 advance / 0 continue), the
// carried economy landing in each next stage, and Stage 3 (moving boss included) being clearable.
//
// Fixture: the same test-only high-DPS Focus-based character that multistage-foundation and
// campaign-two-stage use, but with MORE lives — Stage 3 is a harder final stage, and the
// blind ping-pong bot (it doesn't dodge) needs the headroom to survive its waves+midboss to
// reach and melee the boss. Lives + damage
// are legitimate deterministic run-parameters (not hash perturbations), exactly as before.

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

// Test-only high-DPS, high-life character (both legitimate deterministic run-parameters).
const focus = demoGame.characters[1]!;
const TEST_CHAR: CharacterDef = {
  id: "TestDPS",
  config: { ...focus.config, lives: 24 },
  shot: { ...focus.shot!, damage: 80, sprite: Shape.Star, color: [1, 0.9, 0.4] },
  bomb: focus.bomb,
};

// The REAL full campaign — the demo's authored [stage-1, stage-2, stage-3] (single test char).
const def = defineGame({
  title: "three-stage campaign test",
  seed: demoGame.seed,
  stages: demoGame.stages,
  characters: [TEST_CHAR],
  difficulties: demoGame.difficulties,
  config: demoGame.config,
});

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(62)} ${detail}`);
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

// Reactive bot. "melee": ping-pong + shoot + focus (clears). "die": sit still (bleeds to game-over).
function playBot(
  sim: Simulation,
  maxTicks: number,
  mode: "melee" | "die",
): { frames: InputFrame[]; cleared: boolean; gameOver: boolean } {
  const frames: InputFrame[] = [];
  for (let t = 0; t < maxTicks; t++) {
    const f: InputFrame =
      mode === "die"
        ? { dx: 0, dy: 0, shoot: false, focus: false, bomb: false }
        : { dx: Math.floor(t / 16) % 2 === 0 ? 1 : -1, dy: 0, shoot: true, focus: true, bomb: false };
    frames.push(f);
    sim.step(f);
    if (sim.player.state === PlayerState.GameOver || sim.stageComplete) break;
  }
  return { frames, cleared: sim.stageComplete, gameOver: sim.player.state === PlayerState.GameOver };
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

// ═══ Assemble the real three-stage run through the REAL controller ════════════════
console.log(`\n⟐ Three-stage campaign — real Stage 1 → Stage 2 → Stage 3 (char=TestDPS, rank=Easy)\n`);

check("the demo main chain has three stages", def.stages.filter((s) => !s.extra).map((s) => s.id).join(",") === "stage-1,stage-2,stage-3", def.stages.filter((s) => !s.extra).map((s) => s.id).join(","));
check("the demo has one standalone extra stage", def.stages.filter((s) => s.extra).map((s) => s.id).join(",") === "extra", def.stages.filter((s) => s.extra).map((s) => s.id).join(","));

const run = createRunController(def, RANK, 0);

// seg0 — clear Stage 1 → advance.
const sim0 = buildCurrent(run);
const seg0 = playBot(sim0, 10000, "melee");
const carry0 = readCarryIn(sim0.player);
console.log(`segment 0 (stage-1): ${seg0.frames.length}f, cleared=${seg0.cleared}, end score=${carry0.score.toLocaleString("en-US")}`);
check("segment 0 CLEARED Stage 1", seg0.cleared);
run.advanceStage({ stageIndex: 0, frames: seg0.frames } satisfies ReplaySegment, carry0);
check("advance moved to stage index 1", run.currentStageIndex === 1);
check("Stage 2 still has a next stage (not final)", run.hasNextStage);

// seg1 — play Stage 2 with carry-in; bleed to game-over.
const sim1 = buildCurrent(run);
check("Stage 2 STARTS from the carried economy", carryEq(readCarryIn(sim1.player), carry0), `score=${readCarryIn(sim1.player).score.toLocaleString("en-US")}`);
const seg1 = playBot(sim1, 10000, "die");
console.log(`segment 1 (stage-2): ${seg1.frames.length}f, gameOver=${seg1.gameOver} (played with carry-in)`);
check("segment 1 bled to game-over on Stage 2", seg1.gameOver);
run.recordContinue({ stageIndex: 1, frames: seg1.frames } satisfies ReplaySegment);
check("continue reset the carry-in to null", run.carryIn === null);
check("continue kept the stage index (1)", run.currentStageIndex === 1);

// seg2 — continued Stage 2 (fresh) → clear → advance to Stage 3.
const sim2 = buildCurrent(run);
check("continued Stage 2 starts fresh (score 0, full lives)", sim2.player.score === 0 && sim2.player.lives === TEST_CHAR.config.lives);
const seg2 = playBot(sim2, 10000, "melee");
const carry2 = readCarryIn(sim2.player);
console.log(`segment 2 (stage-2): ${seg2.frames.length}f, cleared=${seg2.cleared}, end score=${carry2.score.toLocaleString("en-US")} lives=${carry2.lives}`);
check("segment 2 CLEARED continued Stage 2", seg2.cleared);
run.advanceStage({ stageIndex: 1, frames: seg2.frames } satisfies ReplaySegment, carry2);
check("advance moved to stage index 2 (final)", run.currentStageIndex === 2);
check("on Stage 3 there is NO next stage (final → clear rolls the ending)", !run.hasNextStage);
check("advance stashed the carry-in", carryEq(run.carryIn, carry2));

// seg3 — play Stage 3 (final) with carry-in → CLEAR (the ending path).
const sim3 = buildCurrent(run);
check("Stage 3 STARTS from the carried Stage-2 economy", carryEq(readCarryIn(sim3.player), carry2), `score=${readCarryIn(sim3.player).score.toLocaleString("en-US")}`);
const seg3 = playBot(sim3, 12000, "melee");
console.log(`segment 3 (stage-3): ${seg3.frames.length}f, cleared=${seg3.cleared} (final, moving boss)`);
check("segment 3 CLEARED Stage 3 (the final-stage clear)", seg3.cleared);
check("final clear on a run with no next stage → the ending path (not advance)", seg3.cleared && !run.hasNextStage);

const replay: RunReplay = run.assembleReplay({ stageIndex: 2, frames: seg3.frames });
check(
  "run has 4 segments, stage indices [0,1,1,2]",
  replay.segments.map((s) => s.stageIndex).join(",") === "0,1,1,2",
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

// ═══ Bit-identical multi-stage replay across BOTH real boundaries (the spine) ═════
const hAssembled = foldRun(replay);
const hLoaded = foldRun(loaded);
const hAgain = foldRun(loaded);
check("multi-stage replay bit-identical (assembled == blob)", hAssembled.hash === hLoaded.hash, `${hex(hAssembled.hash)} vs ${hex(hLoaded.hash)}`);
check("determinism holds (blob folded twice, same hash)", hLoaded.hash === hAgain.hash, hex(hLoaded.hash));

// ═══ Carry-in reconstruction == live progression across both boundaries ═══════════
check("reconstructed carry-in seg1 == live seg0 end (advance 0→1)", carryEq(hLoaded.reconstructed[1]!, carry0));
check("reconstructed carry-in seg2 == null (continue reset)", hLoaded.reconstructed[2] === null);
check("reconstructed carry-in seg3 == live seg2 end (advance 1→2)", carryEq(hLoaded.reconstructed[3]!, carry2));
check("Stage 3 replay STARTS from the carried Stage-2 economy", carryEq(hLoaded.startStates[3]!, carry2), `score=${hLoaded.startStates[3]!.score.toLocaleString("en-US")}`);

// ═══ The replay reproduces the run, not just a matching number ═══════════════════
check("replay re-fires a spell capture (Stage 3 spells run)", hLoaded.events.has(SfxId.SpellCapture));

console.log(
  failures === 0
    ? `\n✓ THREE-STAGE CAMPAIGN PASS — real Stage 1 → Stage 2 → Stage 3 replays bit-identical across both advance boundaries, hash ${hex(hAssembled.hash)}\n`
    : `\n✗ ${failures} FAILURE(S)\n`,
);
if (failures > 0) process.exitCode = 1;
