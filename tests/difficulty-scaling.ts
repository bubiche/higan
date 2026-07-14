// Difficulty-scaling verification — difficulty as a run-parameter.
//
// Proves four things headlessly (the select screen is the only live-only piece):
//  1. NORMAL is the anchor: the demo stage's trajectory hash at NORMAL is bit-identical
//     to the pre-difficulty baseline (0x456669b5) — so threading difficulty + centring every
//     scaling formula on NORMAL was a no-op for the reference rank.
//  2. Each rank is independently reproducible (A==B), and Easy/Hard/Lunatic each yield a
//     DIFFERENT hash from NORMAL and from each other — content genuinely branches on it.
//  3. Difficulty-invariant content (the showcase set, which never reads ctx.difficulty)
//     is unaffected: its hash equals the baseline at every rank.
//  4. The scene's density actually changes with rank (peak live bullets + peak enemies
//     climb Easy → Lunatic) — the numeric stand-in for the visual live-check.
// Plus the stream-isolation engine self-test still holds under the new signature.

import { assertDeterministic, checkDeterministic } from "../src/core/determinism";
import { assertStreamIsolation } from "../src/core/isolation";
import { createStageSim, PATTERN_TICKS } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank, NORMAL } from "../games/demo/difficulty";
import { showcaseStage } from "../games/demo/showcase";
import type { InputFrame } from "../src/core/input";
import type { StageDef } from "../src/api";

// Baselines bumped for the homing player-shot feature: `Shot.homing` joined the shot
// hash block (a new per-shot behaviour field, hashed like a bullet's bp0/bp1), which
// shifts every hash even for characters with no homing shots (they spawn `homing: 0`,
// still part of the hashed array). Confirmed a pure rebaseline, not a regression: the
// bomb litmus deltas, replay round-trips, and A==B reproducibility below are unchanged.
const BASELINE_STAGE = 0x3dcb45ae; // re-pinned 2026-07-14: stage-1 boss gained the survival phase after the prior pin
const BASELINE_SHOWCASE = 0x59525dd8; // re-pinned 2026-07-14: showcase gained the ember pattern after the prior pin

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const stage = demoGame.stages[0]!;
const character = demoGame.characters[0]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// The boot guard's scripted window (mirrors games/demo/main.ts).
const scripted: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  scripted.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
  if (!pass) failures++;
};

// ── 1 + 2: per-rank stage hashes ───────────────────────────────────────────────
const ranks = [Rank.Easy, Rank.Normal, Rank.Hard, Rank.Lunatic];
const stageHash: Record<number, number> = {};
for (const r of ranks) {
  const d = checkDeterministic(stage, STAGE_SEED, scripted, DT, character, r, demoGame.config);
  stageHash[r] = d.hashA;
  check(`stage rank ${r} reproducible`, d.ok, `${hex(d.hashA)} (${d.ticks}t)`);
}
check("NORMAL anchors to baseline", stageHash[NORMAL] === BASELINE_STAGE, `${hex(stageHash[NORMAL]!)} vs ${hex(BASELINE_STAGE)}`);
const distinct = new Set(ranks.map((r) => stageHash[r]));
check("all four ranks distinct", distinct.size === 4, `${distinct.size}/4 unique hashes`);

// ── 3: difficulty-invariant content is unchanged at every rank ──────────────────
const showcaseStageDef: StageDef = { id: "showcase", script: showcaseStage };
const showcaseScript: InputFrame[] = [];
for (let i = 0; i < PATTERN_TICKS * 13; i++) {
  showcaseScript.push({ dx: ((i >> 4) % 3) - 1, dy: ((i >> 5) % 3) - 1, shoot: (i & 8) !== 0, focus: i % 120 < 30, bomb: false });
}
const showcaseHashes = ranks.map(
  (r) => assertDeterministic(showcaseStageDef, STAGE_SEED, showcaseScript, DT, character, r, demoGame.config).hashA,
);
// The real invariant: the showcase reads no ctx.difficulty, so its hash is identical at
// every rank. (The baseline constant just freezes that value; it moves whenever the
// showcase set legitimately changes — e.g. adding a pattern.)
check("showcase rank-invariant", new Set(showcaseHashes).size === 1, `all ranks == ${hex(showcaseHashes[0]!)}`);
check("showcase anchors to baseline", showcaseHashes[0] === BASELINE_SHOWCASE, `${hex(showcaseHashes[0]!)} vs ${hex(BASELINE_SHOWCASE)}`);

// ── 4: density actually climbs with rank ────────────────────────────────────────
// Two signals: the integral (Σ live per tick) captures every scaled emission over the
// run, and the instantaneous peak captures the climax. The peak USED to be rank-flat
// (691 at every rank) because Spiral Veil — the densest, continuous stream — was
// unscaled; scaling its fire interval (Normal-centred) makes the peak scale too.
function density(difficulty: number): { bulletTicks: number; enemyTicks: number; peakBullets: number } {
  const sim = createStageSim(stage, STAGE_SEED, character, difficulty, demoGame.config, DT);
  let bulletTicks = 0;
  let enemyTicks = 0;
  let peakBullets = 0;
  for (let i = 0; i < scripted.length; i++) {
    sim.step(scripted[i]!);
    bulletTicks += sim.system.liveCount;
    enemyTicks += sim.enemies.liveCount;
    if (sim.system.liveCount > peakBullets) peakBullets = sim.system.liveCount;
  }
  return { bulletTicks, enemyTicks, peakBullets };
}
const dens = ranks.map((r) => ({ r, ...density(r) }));
for (const d of dens) console.log(`      density  rank ${d.r}:  ${d.bulletTicks} bullet-ticks  ${d.enemyTicks} enemy-ticks  peak ${d.peakBullets}`);
const monotonic = dens.every((d, i) => i === 0 || (d.bulletTicks > dens[i - 1]!.bulletTicks && d.enemyTicks >= dens[i - 1]!.enemyTicks));
check("density climbs with rank", monotonic, `bullet-ticks ${dens[0]!.bulletTicks}→${dens[3]!.bulletTicks}`);
// After scaling Spiral Veil's interval, the instantaneous peak should differ across ranks
// too (it was rank-flat at 691 before).
check("peak differs across ranks", new Set(dens.map((d) => d.peakBullets)).size > 1, `peaks ${dens.map((d) => d.peakBullets).join("/")}`);

// ── stream isolation still holds under the new createStageSim signature ─────────
const iso = assertStreamIsolation(STAGE_SEED, DT);
check("stream isolation", iso.ok, `boss stable over ${iso.ticks}t (enemies ${iso.finalEnemiesShoot} vs ${iso.finalEnemiesQuiet})`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
