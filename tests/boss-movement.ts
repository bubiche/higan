// Moving-boss determinism fixture — the proof for the boss-movement capability.
//
// Every pinned baseline (full-run-replay, the campaign and rank fixtures, sfx-events)
// exercises a STATIONARY boss, so "movement is deterministic and its effects are captured
// downstream" was until now an untested claim. This fixture closes that gap with a boss
// that BOTH sweeps while firing (the phase body drives the shared boss position → its
// danmaku tracks it) AND repositions between phases (the boss root glides over the
// auto-cleared field). It asserts:
//
//  1. The moving-boss run is deterministic — run twice, bit-identical (the generator-re-run
//     invariant reproduces the whole movement trajectory + the bullets it shapes).
//  2. Its hash is pinned, so a regression in the moving path surfaces.
//  3. The boss ACTUALLY moved — a positive test (a hash check alone would pass a boss that
//     silently never moved): the in-phase sweep spans a wide x-range and the between-phase
//     glide changes y.
//  4. The moving hit disc is hittable — with shots on, the boss takes damage at its live
//     (moving) position, i.e. the disc centre tracks bossPos.
//  5. A stationary control boss stays pinned at the origin — the plumbing is inert unless
//     the script moves the boss (complements the real-content baseline sweep elsewhere).

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT, PLAYFIELD_W, PLAYFIELD_H } from "../src/core/playfield";
import { Shape } from "../src/api";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";
import type { StageDef, StageScript, BossScript, EmitterScript } from "../src/api";

// Pinned after the first green run (fill 0 → the printed hash, then confirm PASS).
const BASELINE_MOVE: number = 0xd5db55a8;

const ORIGIN_X = PLAYFIELD_W / 2; // 192 — where every boss spawns
const ORIGIN_Y = PLAYFIELD_H * 0.16; // ~71.68
const STAGE_SEED = mixSeed(demoGame.seed, 0);
const charSpread = demoGame.characters[0]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Moving-boss determinism — sweep-while-firing + between-phase glide\n`);

// ── The moving boss ────────────────────────────────────────────────────────────────
// Phase 0 body sweeps horizontally as it fires (moves its own ctx.x, which IS the shared
// boss position, so the body render + hit disc sweep with it and the aimed volley leaves
// the moving point). Phase 1 body holds still and fires a ring.
const sweepBody: EmitterScript = function* (ctx) {
  let t = 0;
  while (true) {
    ctx.x = ORIGIN_X + Math.sin(t * 0.06) * 80; // wide horizontal sweep
    ctx.aimed({ count: 5, spread: 0.4, speed: 150, radius: 4, color: [1, 0.4, 0.4], sprite: Shape.Rice });
    t++;
    yield 4;
  }
};
const holdBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.ring({ count: 16, speed: 80, angle: 0, radius: 4, color: [0.5, 0.8, 1], sprite: Shape.Orb });
    yield 20;
  }
};
// Between the phases the ROOT glides the boss to a new, lower spot over the cleared field —
// reading b.x/b.y (the sweep's last position, shared) and lerping from there (no snap).
const movingBoss: BossScript = function* (b) {
  yield* b.phase({ name: "sweep", hp: 400, timeLimit: 200 }, sweepBody);
  const fromX = b.x;
  const fromY = b.y;
  const toX = ORIGIN_X - 70;
  const toY = ORIGIN_Y + 55;
  for (let i = 1; i <= 40; i++) {
    b.x = fromX + (toX - fromX) * (i / 40);
    b.y = fromY + (toY - fromY) * (i / 40);
    yield 1;
  }
  yield* b.phase({ name: "hold", hp: 400, timeLimit: 200 }, holdBody);
};
const movingStageScript: StageScript = function* (ctx) {
  yield* ctx.boss(movingBoss);
};
const movingStage: StageDef = { id: "moving", script: movingStageScript };

// A control boss that never moves — same shape, no ctx.x/y writes.
const stillBoss: BossScript = function* (b) {
  yield* b.phase({ name: "still", hp: 400, timeLimit: 200 }, holdBody);
};
const stillStageScript: StageScript = function* (ctx) {
  yield* ctx.boss(stillBoss);
};
const stillStage: StageDef = { id: "still", script: stillStageScript };

// A bot that drifts + shoots, so the moving hit disc is exercised (spread shots hitting the
// swept disc drain HP). 600 ticks spans both phases + the glide (timeLimit 200 each).
const inputs: InputFrame[] = [];
for (let i = 0; i < 600; i++) {
  inputs.push({ dx: (i >> 4) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 100 < 40, bomb: false });
}

// ── 1 + 2: deterministic + pinned ────────────────────────────────────────────────────
const run = checkDeterministic(movingStage, STAGE_SEED, inputs, DT, charSpread, NORMAL, demoGame.config);
check("moving boss is deterministic (run x2)", run.ok, `${hex(run.hashA)} vs ${hex(run.hashB)} (${run.ticks}t)`);
if (BASELINE_MOVE === 0) {
  console.log(`      → set BASELINE_MOVE = ${hex(run.hashA)}`);
} else {
  check("moving-boss hash matches baseline", run.hashA === BASELINE_MOVE, `${hex(run.hashA)} vs ${hex(BASELINE_MOVE)}`);
}

// ── 3 + 4: the boss actually moved, and its moving disc took damage ──────────────────
const sim = createStageSim(movingStage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let sawDamage = false;
let hpMaxSeen = 0;
for (let i = 0; i < inputs.length; i++) {
  sim.step(inputs[i]!);
  if (sim.boss !== null) {
    const b = sim.bossBody;
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
    if (sim.boss.hpMax > 0) hpMaxSeen = Math.max(hpMaxSeen, sim.boss.hpMax);
    if (sim.boss.active && sim.boss.hp < sim.boss.hpMax) sawDamage = true;
  }
}
const xSpan = maxX - minX;
check("body sweeps horizontally (x-span)", xSpan > 100, `span ${xSpan.toFixed(1)}px [${minX.toFixed(0)}..${maxX.toFixed(0)}]`);
check("body glides vertically (y changed)", maxY - minY > 30, `span ${(maxY - minY).toFixed(1)}px [${minY.toFixed(0)}..${maxY.toFixed(0)}]`);
check("glide reaches below the origin", maxY > ORIGIN_Y + 30, `maxY ${maxY.toFixed(1)} vs origin ${ORIGIN_Y.toFixed(1)}`);
check("moving hit disc takes damage", sawDamage, `sawDamage=${sawDamage} (hpMax ${hpMaxSeen})`);

// ── 5: the stationary control stays pinned at the origin ─────────────────────────────
const ssim = createStageSim(stillStage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
let moved = false;
for (let i = 0; i < 250; i++) {
  ssim.step(inputs[i]!);
  if (ssim.boss !== null) {
    const b = ssim.bossBody;
    if (Math.abs(b.x - ORIGIN_X) > 1e-6 || Math.abs(b.y - ORIGIN_Y) > 1e-6) moved = true;
  }
}
check("stationary boss never leaves the origin", !moved, `moved=${moved}`);

console.log(failures === 0 ? "\n✓ MOVING-BOSS PASS\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
