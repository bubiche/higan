// Stage scripts — authored against the public stage API.
//
// A stage is the scene root: a coroutine that orchestrates the whole stage in the
// same idiom as the boss. It `yield`s to wait, `sub`s emitters, and calls
// `ctx.spawnBoss()` when the boss's turn comes. Enemy waves + a midboss precede the
// boss in a full stage (those land with the enemy system); for now the stage's job
// is simply to bring on the boss.

import { type StageScript } from "../../../src/api";
import { SHOWCASE } from "./showcase";

/** Stage 1: bring on the boss. (Enemy waves + a midboss arrive with the enemy
 *  system; the boss is the whole scene until then, as it was before.) */
export const demoStage: StageScript = function* (ctx) {
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
