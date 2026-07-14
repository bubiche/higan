// The sim-side SFX event spine (the determinism-risky part of the audio work; no sound
// yet). Proves headlessly:
//
//  1. The pinned pre-audio determinism baseline is BIT-IDENTICAL — event emission added
//     zero RNG draws and touched no hashed field. (configurable-bomb re-checks all three
//     pinned hashes; this re-anchors the stage hash so this file stands alone too.)
//  2. Events actually FIRE and carry the right shape — a spine that silently emitted
//     nothing would still pass a hash check, so a positive test is required.
//  3. Reading `sim.events` has ZERO effect on the trajectory hash — the same fixture
//     folded WITH vs WITHOUT reading events every tick matches (audio is presentation).
//  4. The player-death branch (Pichuun) fires and stays deterministic — the branch the
//     baseline input windows are least likely to exercise, hence an explicit positive test.
//  5. `sim.events` reflects exactly ONE tick (cleared at step start): a Shoot on a firing
//     tick is gone after the next non-firing tick, and nothing is emitted at construction.

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { PlayerState } from "../src/touhou/player";
import { SfxId, type SfxEvent } from "../src/core/events";
import { Shape } from "../src/api";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";
import type { StageDef, StageScript, BossScript, EmitterScript } from "../src/api";

// Baseline bumped for the homing player-shot feature (see difficulty-scaling.ts for why).
const BASELINE_STAGE = 0x3dcb45ae; // re-pinned 2026-07-14: stage-1 boss gained the survival phase after the prior pin

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const stage = demoGame.stages[0]!;
const charSpread = demoGame.characters[0]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  if (!pass) failures++;
};

// The same 8000-tick window configurable-bomb pins the stage baseline against.
const noBomb: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  noBomb.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

// ── 1: the pinned stage baseline is bit-identical (emission is hash-neutral) ──────
const stageRun = checkDeterministic(stage, STAGE_SEED, noBomb, DT, charSpread, NORMAL, demoGame.config);
check("stage baseline bit-identical", stageRun.hashA === BASELINE_STAGE, `${hex(stageRun.hashA)} vs ${hex(BASELINE_STAGE)}`);

// ── 2: events fire + carry shape ─────────────────────────────────────────────────
const sim = createStageSim(stage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
check("no events before first step", sim.events.length === 0, `len ${sim.events.length}`);

const seen = new Set<SfxId>();
let shootSample: SfxEvent | null = null;
let sawBatched = false;
for (let i = 0; i < noBomb.length; i++) {
  sim.step(noBomb[i]!);
  for (const e of sim.events) {
    seen.add(e.id);
    if (e.id === SfxId.Shoot && shootSample === null) shootSample = e;
    if (e.n !== undefined && e.n > 1) sawBatched = true;
  }
}
console.log(`      ids seen: ${[...seen].map((id) => SfxId[id]).sort().join(", ")}`);
check("Shoot fires", seen.has(SfxId.Shoot), `seen=${seen.has(SfxId.Shoot)}`);
check("Shoot carries player x (pan)", shootSample !== null && typeof shootSample.x === "number", `x=${shootSample?.x}`);
// The demo stage runs enemies + a boss with spell cards, so these must all fire in-window.
check("EnemyHit fires", seen.has(SfxId.EnemyHit), `seen=${seen.has(SfxId.EnemyHit)}`);
check("EnemyDeath fires", seen.has(SfxId.EnemyDeath), `seen=${seen.has(SfxId.EnemyDeath)}`);
check("SpellDeclare fires", seen.has(SfxId.SpellDeclare), `seen=${seen.has(SfxId.SpellDeclare)}`);
check("Cancel fires (batched, one/clear)", seen.has(SfxId.Cancel), `seen=${seen.has(SfxId.Cancel)}`);
check("some event batches (n>1)", sawBatched, `sawBatched=${sawBatched}`);

// ── 3: reading sim.events has no effect on the hash ──────────────────────────────
// Fold two fresh runs of the same window; one iterates sim.events every tick, one never
// touches it. Equal folds ⇒ the getter/read is side-effect-free (events are presentation).
const foldRun = (readEvents: boolean): number => {
  const s = createStageSim(stage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
  let acc = 0x811c9dc5;
  for (let i = 0; i < noBomb.length; i++) {
    s.step(noBomb[i]!);
    if (readEvents) {
      // Force a full read/iteration (what the audio layer will do).
      let sink = 0;
      for (const e of s.events) sink += e.id + (e.x ?? 0) + (e.n ?? 0);
      if (sink === -1) throw new Error("unreachable"); // keep `sink` observably live
    }
    acc = Math.imul(acc ^ s.hash(), 0x01000193) >>> 0;
  }
  return acc;
};
const readFold = foldRun(true);
const skipFold = foldRun(false);
check("reading events doesn't change hash", readFold === skipFold, `${hex(readFold)} vs ${hex(skipFold)}`);
check("read-fold anchors to baseline", readFold === BASELINE_STAGE, `${hex(readFold)} vs ${hex(BASELINE_STAGE)}`);

// ── 4: player-death branch — Pichuun fires + the fixture is deterministic ─────────
// Parked player (no move/shoot/bomb) under a boss firing an aimed volley straight at it →
// the player is hit, the deathbomb window lapses unbombed, a life is lost (Pichuun). The
// phase never ends (huge hp/time), so no phase-clear muddies the branch.
const deathBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.aimed({ count: 5, spread: 0.35, speed: 180, radius: 4, color: [1, 0.3, 0.3], sprite: Shape.Orb });
    yield 6;
  }
};
const deathBoss: BossScript = function* (b) {
  yield* b.phase({ name: "reaper", hp: 10_000_000, timeLimit: 10_000_000 }, deathBody);
};
const deathStageScript: StageScript = function* (ctx) {
  yield* ctx.boss(deathBoss);
};
const deathStage: StageDef = { id: "death", script: deathStageScript };

const parked: InputFrame[] = [];
for (let i = 0; i < 3000; i++) parked.push({ dx: 0, dy: 0, shoot: false, focus: false, bomb: false });

// Collect events + track the player's death from one run.
const dsim = createStageSim(deathStage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
const deathSeen = new Set<SfxId>();
let reachedGameOver = false;
for (let i = 0; i < parked.length; i++) {
  dsim.step(parked[i]!);
  for (const e of dsim.events) deathSeen.add(e.id);
  if (dsim.player.state === PlayerState.GameOver) reachedGameOver = true;
}
check("death fixture reaches game over", reachedGameOver, `state=${dsim.player.state}`);
check("Pichuun fires on a life-loss", deathSeen.has(SfxId.Pichuun), `seen=${deathSeen.has(SfxId.Pichuun)}`);
const deathDet = checkDeterministic(deathStage, STAGE_SEED, parked, DT, charSpread, NORMAL, demoGame.config);
check("death fixture is deterministic", deathDet.ok, `${hex(deathDet.hashA)} (${deathDet.ticks}t)`);

// ── 5: sim.events reflects exactly one tick (cleared at step start) ───────────────
// Step firing ticks until a Shoot lands this tick, then step one NON-firing tick and
// confirm the Shoot is gone (the buffer holds only the current tick's events).
const tsim = createStageSim(stage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
let sawShootThisTick = false;
for (let i = 0; i < 8 && !sawShootThisTick; i++) {
  tsim.step({ dx: 0, dy: 0, shoot: true, focus: false, bomb: false });
  sawShootThisTick = tsim.events.some((e) => e.id === SfxId.Shoot);
}
check("Shoot present on a firing tick", sawShootThisTick, `sawShootThisTick=${sawShootThisTick}`);
tsim.step({ dx: 0, dy: 0, shoot: false, focus: false, bomb: false });
check("Shoot gone on a non-firing tick", !tsim.events.some((e) => e.id === SfxId.Shoot), `len ${tsim.events.length}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
