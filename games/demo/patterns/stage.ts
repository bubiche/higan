// Stage scripts — authored against the public stage API.
//
// A stage is the scene root: a coroutine that orchestrates the whole stage in the
// same idiom as the boss. It `yield`s to wait, `sub`s emitters, and calls
// `ctx.spawnBoss()` when the boss's turn comes. Enemy waves + a midboss precede the
// boss in a full stage (those land with the enemy system); for now the stage's job
// is simply to bring on the boss.

import { type StageScript, type EmitterScript, Shape } from "../../../src/api";
import { PLAYFIELD_W } from "../../../src/core/playfield";
import { SHOWCASE } from "./showcase";

/** A popcorn enemy: dives in from the top, fires a few aimed spreads at the player,
 *  then dives off the bottom (the field cull frees it). Its `ctx.x/y` IS the enemy's
 *  position — the sim publishes it to the hittable struct each tick — and `ctx.aimed`
 *  fires its danmaku on the enemy stream. Pure of (rng, tick, target). */
const popcorn: EmitterScript = function* (ctx) {
  // Dive in to a hover line.
  for (let i = 0; i < 36; i++) {
    ctx.y += 2.4;
    yield 1;
  }
  // Attack: three aimed three-bullet fans.
  for (let i = 0; i < 3; i++) {
    ctx.aimed({ count: 3, spread: 0.5, speed: 150, sprite: Shape.Rice, color: [1, 0.55, 0.55] });
    yield 36;
  }
  // Dive off the bottom; the off-field cull frees it once it clears the field.
  for (let i = 0; i < 120; i++) {
    ctx.y += 4;
    yield 1;
  }
};

/** Stage 1: a small opening wave of popcorn, then the boss. Five enemies sweep in
 *  across the top on a stagger (enemies + wave timing ride the enemy stream); after a
 *  beat the stage spawns the boss, which runs on its own protected stream. (A full
 *  stage — denser waves + a midboss + dialogue — is the next content checkpoint.) */
export const demoStage: StageScript = function* (ctx) {
  const lanes = 5;
  for (let i = 0; i < lanes; i++) {
    const x = (PLAYFIELD_W * (i + 1)) / (lanes + 1);
    ctx.spawnEnemy(popcorn, x, -12, { hp: 60, radius: 14, sprite: Shape.BigOrb, color: [1, 0.75, 0.3] });
    yield 40;
  }
  yield 150;
  ctx.spawnBoss();
};

/** A guard-only scene that runs every showcase pattern at once, so the continuous
 *  determinism guard covers the `wave`/`delay`/`ramp`-speed-change behavior branches
 *  the boss doesn't exercise. NOT a playable scene — the showcase emitters overflow
 *  the store when run together (deterministically), which is fine for branch
 *  coverage but would not read on screen. */
export const showcaseStage: StageScript = function* (ctx) {
  for (const p of SHOWCASE) ctx.sub(p.script);
};
