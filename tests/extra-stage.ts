// Extra-stage verification — the headless proof for the standalone Extra stage.
//
// The Extra stage is authored entirely in the game layer and reached only as a STANDALONE
// single-stage run (never the campaign chain). This fixture proves the two things the browser
// can't show cheaply:
//
//   1. The Extra content is DETERMINISTIC at all four ranks (run-twice bit-identical), and the
//      NORMAL run is pinned — a regression in the new stage/boss/midboss scripts surfaces. It
//      is driven by a high-DPS test character (a legitimate, fully-deterministic run parameter)
//      so the bot blows through the waves + midboss and actually reaches — and fells — the
//      moving headline boss within a bounded window.
//   2. The moving headline boss (the Crimson Shorekeeper) runs AS CONTENT: it is reached (a
//      phase with hp >= 900, above the midboss's ceiling) and its body MOVES (the between-phase
//      glides sweep x), confirming the boss-movement capability works from authored content.
//
// It also asserts the run-controller wiring for a standalone Extra run vs the main campaign
// (isMainCampaign / hasNextStage / the starting stage index) — the meta the run-end gates read.

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { createRunController } from "../src/app/run";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { Shape } from "../src/api";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";
import type { CharacterDef, StageDef } from "../src/api";

// Pinned after the first green run (fill 0 → the printed hash, then confirm PASS).
const BASELINE_EXTRA_NORMAL: number = 0xf1e5d9d2;

const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;
let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Extra stage — standalone determinism + moving headline boss\n`);

const extraIndex = demoGame.stages.findIndex((s) => s.extra);
const extraStage: StageDef = demoGame.stages[extraIndex]!;
const EXTRA_SEED = mixSeed(demoGame.seed, extraIndex); // the standalone run's per-stage seed

// High-DPS test character (deterministic run parameter): fells the midboss + headline boss fast
// so a bounded window reaches the moving finale.
const focus = demoGame.characters[1]!;
const TEST_CHAR: CharacterDef = {
  id: "TestDPS",
  config: { ...focus.config, lives: 8 },
  shot: { ...focus.shot!, damage: 220, sprite: Shape.Star, color: [1, 0.9, 0.4] },
  bomb: focus.bomb,
};

// A bot that drifts + shoots for the whole window — long enough to grind all the fixed wave
// time + the midboss + the four boss phases at this DPS, so the stage actually CLEARS.
const inputs: InputFrame[] = [];
for (let i = 0; i < 5200; i++) {
  inputs.push({ dx: (i >> 4) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 50, bomb: false });
}

// ── 1: deterministic at every rank; NORMAL pinned ────────────────────────────────────
let normalHash = 0;
for (let rank = 0; rank < demoGame.difficulties!.length; rank++) {
  const r = checkDeterministic(extraStage, EXTRA_SEED, inputs, DT, TEST_CHAR, rank, demoGame.config);
  check(`Extra runs deterministically at rank ${rank} (run x2)`, r.ok, `${hex(r.hashA)} vs ${hex(r.hashB)}`);
  if (rank === NORMAL) normalHash = r.hashA;
}
if (BASELINE_EXTRA_NORMAL === 0) {
  console.log(`      → set BASELINE_EXTRA_NORMAL = ${hex(normalHash)}`);
} else {
  check("Extra NORMAL hash matches baseline", normalHash === BASELINE_EXTRA_NORMAL, `${hex(normalHash)} vs ${hex(BASELINE_EXTRA_NORMAL)}`);
}

// ── 2: the moving headline boss is reached and moves ─────────────────────────────────
const sim = createStageSim(extraStage, EXTRA_SEED, TEST_CHAR, NORMAL, demoGame.config, DT);
let minX = Infinity;
let maxX = -Infinity;
let maxHpMax = 0;
let sawHeadlineDamage = false;
let cleared = false;
let clearedAt = 0;
for (let i = 0; i < inputs.length; i++) {
  sim.step(inputs[i]!);
  if (sim.boss !== null) {
    minX = Math.min(minX, sim.bossBody.x);
    maxX = Math.max(maxX, sim.bossBody.x);
    maxHpMax = Math.max(maxHpMax, sim.boss.hpMax);
    // Headline-boss phases start at hp 900+ (above the midboss's 820 ceiling).
    if (sim.boss.hpMax >= 900 && sim.boss.active && sim.boss.hp < sim.boss.hpMax) sawHeadlineDamage = true;
  }
  if (sim.stageComplete && !cleared) {
    cleared = true;
    clearedAt = i;
  }
}
check("Extra stage is COMPLETABLE (bot clears it)", cleared, cleared ? `at tick ${clearedAt}` : "not cleared in window");
check("headline boss reached (a phase with hp >= 900)", maxHpMax >= 900, `maxHpMax ${maxHpMax}`);
check("headline boss body moves (x-span from glides)", maxX - minX > 30, `span ${(maxX - minX).toFixed(1)}px`);
check("headline boss takes damage at its live position", sawHeadlineDamage, `sawDamage=${sawHeadlineDamage}`);

// ── 3: run-controller wiring — standalone Extra vs main campaign ──────────────────────
const campaign = createRunController(demoGame, NORMAL, 0);
check("main campaign: isMainCampaign true", campaign.isMainCampaign === true);
check("main campaign: starts at the first non-extra stage", campaign.currentStageIndex === 0, `idx=${campaign.currentStageIndex}`);
check("main campaign: has a next stage (will advance)", campaign.hasNextStage === true);

const extraRun = createRunController(demoGame, NORMAL, 0, [extraIndex]);
check("standalone Extra: isMainCampaign false", extraRun.isMainCampaign === false);
check("standalone Extra: starts at the extra stage index", extraRun.currentStageIndex === extraIndex, `idx=${extraRun.currentStageIndex}`);
check("standalone Extra: has NO next stage (single stage)", extraRun.hasNextStage === false);

console.log(failures === 0 ? "\n✓ EXTRA PASS\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
