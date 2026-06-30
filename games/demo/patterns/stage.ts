// Stage scripts — authored against the public stage API.
//
// A stage is the scene root: a coroutine that orchestrates the whole stage in the
// same idiom as the boss. It `yield`s to wait, `spawnEnemy`s waves over time, and
// `yield* ctx.boss(...)`s each boss encounter — PAUSING on the boss and resuming the
// next wave when it falls. Stage 1 runs opening waves → a midboss → more waves → the
// final boss; the run ends when this coroutine RETURNS (after the final boss), not
// when any single boss is beaten, so a midboss falling just resumes the stage.

import { type StageScript, type StageContext, type EmitterScript, Shape } from "../../../src/api";
import { PLAYFIELD_W } from "../../../src/core/playfield";
import { scale } from "../difficulty";
import { MIDBOSS } from "./midboss";

const AMBER: readonly [number, number, number] = [1, 0.75, 0.3];
const TEAL: readonly [number, number, number] = [0.5, 0.9, 0.85];
const ROSE: readonly [number, number, number] = [1, 0.6, 0.8];

// ── Enemy AI (each an emitter the sim binds to a hittable enemy slot) ───────────
// An enemy's `ctx.x/y` IS its position — the sim publishes it to the struct each tick
// — and `ctx.aimed/ring` fire its danmaku on the enemy stream. All pure of (rng, tick,
// target). They end by returning (flew their course), dying (hp 0), or off-field cull.

/** Popcorn: dives in to a hover line, fires a few aimed fans at the player, then dives
 *  off the bottom (the field cull frees it). */
const popcorn: EmitterScript = function* (ctx) {
  for (let i = 0; i < 36; i++) {
    ctx.y += 2.4;
    yield 1;
  }
  for (let i = 0; i < 3; i++) {
    // Difficulty scales the fan's bullet count (visible density change per rank).
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.5, speed: 150, sprite: Shape.Rice, color: [1, 0.55, 0.55] });
    yield 36;
  }
  for (let i = 0; i < 120; i++) {
    ctx.y += 4;
    yield 1;
  }
};

/** Side-sweeper: enters from one edge at a fixed height, glides across the top band
 *  firing aimed pairs, and exits the far side (culled off-field). `dir` +1 = left→right,
 *  -1 = right→left. */
const sweeper = (dir: number): EmitterScript =>
  function* (ctx) {
    for (let i = 0; i < 240; i++) {
      ctx.x += dir * 2.4;
      if (i % 45 === 30) {
        ctx.aimed({ count: scale(ctx.difficulty, 2, 1), spread: 0.28, speed: 135, sprite: Shape.Rice, color: TEAL });
      }
      yield 1;
    }
  };

/** Turret: dives to a hover point, fires a handful of slow jittered rings, then
 *  retreats up off the top (culled). Tankier than popcorn — a small score anchor. */
const turret: EmitterScript = function* (ctx) {
  for (let i = 0; i < 30; i++) {
    ctx.y += 2.2;
    yield 1;
  }
  for (let i = 0; i < 4; i++) {
    ctx.ring({ count: scale(ctx.difficulty, 10, 2), speed: 70, angle: ctx.rng.range(0, Math.PI * 2), radius: 4, color: ROSE, sprite: Shape.Orb });
    yield 40;
  }
  for (let i = 0; i < 80; i++) {
    ctx.y -= 3;
    yield 1;
  }
};

/** Spawn `n` popcorn across the top on a lane stagger, `gap` ticks apart. */
function* popcornLine(ctx: StageContext, n: number, gap: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) {
    const x = (PLAYFIELD_W * (i + 1)) / (n + 1);
    ctx.spawnEnemy(popcorn, x, -12, {
      hp: 60,
      radius: 14,
      sprite: Shape.BigOrb,
      color: AMBER,
      drops: { power: 1, point: 1 },
    });
    yield gap;
  }
}

/** Stage 1: opening waves → midboss → more waves → final boss. The enemies + wave
 *  timing ride the (play-dependent) enemy stream; each boss the script runs branches
 *  onto its own protected stream. */
export const demoStage: StageScript = function* (ctx) {
  // ── Opening waves ──
  // Difficulty scales how many popcorn each line sends (visible density per rank).
  yield* popcornLine(ctx, scale(ctx.difficulty, 5, 1), 40);
  yield 70;
  ctx.spawnEnemy(sweeper(1), -12, 90, {
    hp: 90,
    radius: 14,
    sprite: Shape.BigOrb,
    color: TEAL,
    drops: { power: 2, point: 2 },
  });
  ctx.spawnEnemy(sweeper(-1), PLAYFIELD_W + 12, 140, {
    hp: 90,
    radius: 14,
    sprite: Shape.BigOrb,
    color: TEAL,
    drops: { power: 2, point: 2 },
  });
  yield 170;
  yield* popcornLine(ctx, scale(ctx.difficulty, 4, 1), 36);
  yield 130;

  // ── Midboss ── awaited: the stage pauses here and the waves below resume when it falls.
  yield* ctx.boss(MIDBOSS);
  yield 90;

  // ── Post-midboss waves ──
  // The tanky turrets are the stage's item anchors — one yields a life, the other a
  // full-power, so a full clear shows every item type.
  ctx.spawnEnemy(turret, PLAYFIELD_W * 0.3, -12, {
    hp: 150,
    radius: 16,
    sprite: Shape.BigOrb,
    color: ROSE,
    drops: { power: 3, point: 4, bomb: 1, life: 1 },
  });
  ctx.spawnEnemy(turret, PLAYFIELD_W * 0.7, -12, {
    hp: 150,
    radius: 16,
    sprite: Shape.BigOrb,
    color: ROSE,
    drops: { power: 3, point: 4, fullPower: 1 },
  });
  yield 210;
  yield* popcornLine(ctx, scale(ctx.difficulty, 6, 1), 30);
  yield 150;

  // ── Final boss ── the stage RETURNS when it falls → run ends "clear".
  yield* ctx.boss();
};
